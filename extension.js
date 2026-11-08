// SPDX-License-Identifier: MIT
//
// Draw the sign of the cross with the pointer three times, and Spotifast
// opens and plays the track configured in the extension's preferences.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {CrossDetector} from './gesture.js';

const POLL_INTERVAL_MS = 25;
const LAUNCH_RETRY_MS = 650;
const LAUNCH_ATTEMPTS = 24;
const DEFAULT_TRACK = 'spotify:track:6tDBqLL9ucSov84kZH6V1Z';
const DEBUG = GLib.getenv('GNOMECROSS_DEBUG') === '1';

function log(message) {
    if (DEBUG)
        console.log(`[gnomecross] ${message}`);
}

function parseTrack(text) {
    const value = text.trim();

    const uriMatch = /^spotify:track:([A-Za-z0-9]+)$/.exec(value);
    if (uriMatch)
        return `spotify:track:${uriMatch[1]}`;

    const urlMatch =
        /^(?:https?:\/\/)?open\.spotify\.com\/track\/([A-Za-z0-9]+)(?:[?#].*)?$/.exec(value);
    if (urlMatch)
        return `spotify:track:${urlMatch[1]}`;

    if (/^[A-Za-z0-9]{22}$/.test(value))
        return `spotify:track:${value}`;

    return null;
}

function commandPath(command) {
    if (!command)
        return null;

    const path = GLib.find_program_in_path(command);
    if (path)
        return path;

    if (GLib.path_is_absolute(command) &&
        GLib.file_test(command, GLib.FileTest.IS_EXECUTABLE)) {
        return command;
    }

    return null;
}

export default class SignOfTheCrossExtension extends Extension {
    enable() {
        this._active = true;
        this._actionInProgress = false;
        this._launchTimerId = 0;
        this._pollTimerId = 0;
        this._detector = new CrossDetector({
            requiredCrosses: 3,
            crossTimeoutSeconds: 2,
            minStrokeLength: 200,
            debug: DEBUG,
            onCross: (count, total) => this._showProgress(count, total),
            onTrigger: () => this._onTrigger(),
        });

        this._settings = this.getSettings();
        this._applySettings();
        this._settings.connectObject('changed', (settings, key) => {
            if (key === 'gesture-enabled') {
                this._detector.reset();
                this._syncPolling();
            } else {
                this._applySettings();
            }
        }, this);

        this._syncPolling();
        log('enabled');
    }

    disable() {
        this._active = false;
        this._stopPolling();
        this._cancelLaunchTimer();

        this._settings?.disconnectObject(this);
        this._settings = null;

        this._detector = null;
        this._actionInProgress = false;
        log('disabled');
    }

    _applySettings() {
        if (!this._settings)
            return;

        this._detector?.configure({
            requiredCrosses: this._settings.get_int('crosses-required'),
            crossTimeoutSeconds: this._settings.get_int('cross-timeout'),
            minStrokeLength: this._settings.get_int('min-stroke-length'),
        });
    }

    _syncPolling() {
        if (!this._settings)
            return;

        if (this._settings.get_boolean('gesture-enabled'))
            this._startPolling();
        else
            this._stopPolling();
    }

    _startPolling() {
        if (this._pollTimerId || !this._active)
            return;

        this._pollTimerId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS, () => {
                if (!this._active || !this._detector)
                    return GLib.SOURCE_CONTINUE;

                const [x, y] = global.get_pointer();
                const now = GLib.get_monotonic_time() / 1000;
                this._detector.addSample(x, y, now);
                return GLib.SOURCE_CONTINUE;
            });
        GLib.Source.set_name_by_id(
            this._pollTimerId, '[gnomecross] pointer poll');
    }

    _stopPolling() {
        if (!this._pollTimerId)
            return;

        GLib.Source.remove(this._pollTimerId);
        this._pollTimerId = 0;
        this._detector?.reset();
    }

    _showProgress(count, total) {
        if (!this._active || !this._settings.get_boolean('show-feedback'))
            return;

        this._showOsd('input-mouse-symbolic', `✝  ${count} / ${total}`);
        log(`cross ${count}/${total}`);
    }

    _showOsd(iconName, label) {
        Main.osdWindowManager.showOne(
            Main.layoutManager.primaryIndex,
            Gio.Icon.new_for_string(iconName),
            label,
            null);
    }

    _notify(title, body) {
        if (!this._active)
            return;
        Main.notify(title, body);
    }

    _onTrigger() {
        if (!this._active)
            return;

        this._detector.reset();

        if (this._actionInProgress) {
            log('trigger ignored: Spotifast launch is already in progress');
            return;
        }

        const trackText = this._settings.get_string('track-uri') || DEFAULT_TRACK;
        const uri = parseTrack(trackText);
        if (!uri) {
            this._notify('Sign of the cross',
                'The Spotify track link in the extension settings is not valid.');
            return;
        }

        const command = commandPath(
            this._settings.get_string('spotifast-command').trim());
        if (!command) {
            this._notify('Sign of the cross',
                'Spotifast could not be found. Check its command in the extension settings.');
            return;
        }

        this._actionInProgress = true;
        log(`triggered; asking ${command} to play ${uri}`);

        if (this._settings.get_boolean('show-feedback'))
            this._showOsd('media-playback-start-symbolic', 'Opening Spotifast…');

        this._attemptPlay(command, uri, 0);
    }

    _attemptPlay(command, uri, attempt) {
        if (!this._active)
            return;

        this._run([command, 'play-uri', uri], success => {
            if (!this._active)
                return;

            if (success) {
                log('playback started');
                this._run([command, 'show'], () => {});
                if (this._settings.get_boolean('show-feedback'))
                    this._showOsd('media-playback-start-symbolic', 'Playing on Spotifast');
                this._actionInProgress = false;
                return;
            }

            if (attempt === 0) {
                // No running instance answered. Starting with the link both
                // opens Spotifast and shows the track's page.
                log('no running instance; launching Spotifast');
                if (!this._spawnDetached([command, uri])) {
                    this._failLaunch();
                    return;
                }
                this._scheduleRetry(command, uri, 1);
                return;
            }

            if (attempt < LAUNCH_ATTEMPTS) {
                this._scheduleRetry(command, uri, attempt + 1);
                return;
            }

            this._failLaunch();
        });
    }

    _scheduleRetry(command, uri, attempt) {
        this._cancelLaunchTimer();
        this._launchTimerId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, LAUNCH_RETRY_MS, () => {
                this._launchTimerId = 0;
                if (this._active)
                    this._attemptPlay(command, uri, attempt);
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelLaunchTimer() {
        if (!this._launchTimerId)
            return;

        GLib.Source.remove(this._launchTimerId);
        this._launchTimerId = 0;
    }

    _failLaunch() {
        this._actionInProgress = false;
        this._notify('Sign of the cross',
            'Spotifast did not start playing. Is it installed and signed in?');
    }

    _run(argv, callback) {
        let process;
        try {
            process = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_SILENCE |
                Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (error) {
            log(`could not run ${argv.join(' ')}: ${error.message}`);
            callback(false, error);
            return;
        }

        process.wait_check_async(null, (source, result) => {
            try {
                source.wait_check_finish(result);
                callback(true, null);
            } catch (error) {
                callback(false, error);
            }
        });
    }

    _spawnDetached(argv) {
        let process;
        try {
            process = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_SILENCE |
                Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (error) {
            log(`could not launch ${argv.join(' ')}: ${error.message}`);
            return false;
        }

        // Reap it whenever it exits, without keeping the extension waiting.
        process.wait_async(null, () => {});
        return true;
    }
}
