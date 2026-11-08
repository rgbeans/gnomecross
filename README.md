# Sign of the Cross

A GNOME Shell extension that watches the mouse pointer for the sign of the
cross. Draw it three times, and Spotifast opens and plays the track configured
in the extension settings.

The default track is
[Crux Sacra sit mihi lux](https://open.spotify.com/track/6tDBqLL9ucSov84kZH6V1Z)
(`spotify:track:6tDBqLL9ucSov84kZH6V1Z`).

## Gesture

Draw a cross with the pointer:

1. a long vertical stroke, then
2. a horizontal (or shoulder-to-shoulder) stroke across it.

A plus sign and the traditional forehead–chest–left–right sign both work. Each
stroke needs to be relatively straight, at least 200 px long, and within 30
degrees of horizontal or vertical.

After each cross is recognized, you have **2 seconds to draw the next one**.
The timer starts again after every cross, so each cross gets its own 2-second
window. If it expires, the sequence resets to zero. Draw three crosses in a row
to trigger playback. They can be drawn back to back; the detector splits
strokes at sharp corners and brief pauses.

Crosses are only counted; the pointer is never grabbed, clicked, or blocked.

## Requirements

- GNOME Shell 50 (tested on 50.1)
- [Spotifast](https://github.com/crmne/spotifast) installed and signed in, with
  `spotifast` on `PATH` (or an absolute path configured in the preferences)

## Install

### From this directory

```sh
make install
make enable
```

Then log out and back in. On Wayland, a newly installed extension cannot be
loaded into the running Shell; it becomes active at the next login. After
logging in, check it with:

```sh
gnome-extensions info gnomecross@deanp
```

### From the zip

```sh
gnome-extensions install --force gnomecross@deanp.shell-extension.zip
```

Log out and back in afterwards.

## Configure

```sh
gnome-extensions prefs gnomecross@deanp
```

or open the Extensions app and choose **Sign of the Cross**.

Settings include:

- the number of crosses (default 3) and the time between crosses (default
  2 seconds)
- the minimum stroke length
- the Spotify track link or URI
- the Spotifast executable
- the on-screen counter feedback

## How it works

`extension.js` polls the compositor pointer position at 40 Hz. `gesture.js`
splits pointer paths into straight strokes at sharp corners and whenever the
pointer rests. It then looks for a horizontal and a vertical stroke that cross
each other. All non-overlapping pairs are counted, so several crosses in one
continuous path are all recognized. After each cross, a 2-second timer starts
for the next one; the timer resets after every cross. Once enough crosses are
seen, the extension runs:

```sh
spotifast play-uri spotify:track:...
spotifast show
```

If Spotifast is not running yet, it starts it with the track link and retries
the command until the app is ready.

## Development

The gesture detector is plain JavaScript and has a Node test suite:

```sh
make test
```

`GNOMECROSS_DEBUG=1` makes the extension log strokes and cross detections to
the GNOME Shell log.

## Uninstall

```sh
make uninstall
```

Then log out and back in, or remove it from the Extensions app.
