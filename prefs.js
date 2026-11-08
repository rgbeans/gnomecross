// SPDX-License-Identifier: MIT

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function spinRow(title, subtitle, settings, key, lower, upper, step) {
    const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: step * 2,
    });
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment,
        climb_rate: 1,
        digits: 0,
    });

    row.value = settings.get_int(key);
    row.connect('notify::value', () => {
        settings.set_int(key, Math.round(row.value));
    });
    return row;
}

function bindSwitch(title, subtitle, settings, key) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function normalizeTrack(text) {
    const value = text.trim();
    if (/^spotify:track:[A-Za-z0-9]+$/.test(value))
        return value;
    if (/^(?:https?:\/\/)?open\.spotify\.com\/track\/[A-Za-z0-9]+(?:[?#].*)?$/.test(value))
        return value;
    if (/^[A-Za-z0-9]{22}$/.test(value))
        return value;
    return null;
}

export default class SignOfTheCrossPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const gesture = new Adw.PreferencesGroup({
            title: 'Gesture',
            description: 'Draw a cross with the pointer: one stroke down, then one across it. Each stroke must be at least 200 px.',
        });
        page.add(gesture);

        gesture.add(bindSwitch(
            'Watch for the gesture', null, settings, 'gesture-enabled'));
        gesture.add(spinRow(
            'Crosses needed', 'How many crosses trigger playback',
            settings, 'crosses-required', 1, 12, 1));
        gesture.add(spinRow(
            'Time between crosses', 'Seconds allowed after each cross for the next one',
            settings, 'cross-timeout', 1, 10, 1));
        gesture.add(spinRow(
            'Minimum stroke length', 'Shortest stroke, in pixels',
            settings, 'min-stroke-length', 200, 600, 10));

        const spotifast = new Adw.PreferencesGroup({
            title: 'Spotifast',
            description: 'What to open and play when the third cross is drawn.',
        });
        page.add(spotifast);

        const trackRow = new Adw.EntryRow({
            title: 'Spotify track link or URI',
        });
        trackRow.text = settings.get_string('track-uri');
        trackRow.connect('changed', () => {
            if (normalizeTrack(trackRow.text)) {
                trackRow.remove_css_class('error');
                settings.set_string('track-uri', trackRow.text.trim());
            } else {
                trackRow.add_css_class('error');
            }
        });
        spotifast.add(trackRow);

        const commandRow = new Adw.EntryRow({
            title: 'Spotifast command',
        });
        commandRow.text = settings.get_string('spotifast-command');
        commandRow.connect('changed', () => {
            const value = commandRow.text.trim();
            if (value) {
                commandRow.remove_css_class('error');
                settings.set_string('spotifast-command', value);
            } else {
                commandRow.add_css_class('error');
            }
        });
        spotifast.add(commandRow);

        const feedback = new Adw.PreferencesGroup({
            title: 'Feedback',
        });
        page.add(feedback);

        feedback.add(bindSwitch(
            'Show the cross counter', 'Show a short on-screen count after each cross',
            settings, 'show-feedback'));

        const help = new Adw.PreferencesGroup();
        help.add(new Adw.ActionRow({
            title: 'Tip',
            subtitle: 'You can draw a plus sign or the traditional forehead–chest–shoulders sign. ' +
                'Keep each stroke long and fairly straight, and pause briefly between crosses.',
        }));
        page.add(help);
    }
}
