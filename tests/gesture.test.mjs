import assert from 'node:assert/strict';

import {CrossDetector} from '../gesture.js';

const STEP_MS = 25;

function move(detector, from, to, duration, time, jitter = 0) {
    const steps = Math.max(1, Math.round(duration / STEP_MS));
    for (let i = 1; i <= steps; i++) {
        const progress = i / steps;
        const x = from.x + (to.x - from.x) * progress +
            Math.sin(i * 1.7) * jitter;
        const y = from.y + (to.y - from.y) * progress +
            Math.cos(i * 2.1) * jitter;
        time += duration / steps;
        detector.addSample(x, y, time);
    }
    return time;
}

function rest(detector, duration, time, position) {
    const steps = Math.ceil(duration / STEP_MS);
    for (let i = 0; i < steps; i++) {
        time += STEP_MS;
        detector.addSample(position.x, position.y, time);
    }
    return time;
}

function makeDetector(required = 3, windowSeconds = 8) {
    const events = {crosses: [], triggers: 0};
    const detector = new CrossDetector({
        requiredCrosses: required,
        windowSeconds,
        onCross: (count, total) => events.crosses.push({count, total}),
        onTrigger: () => events.triggers++,
    });
    return {detector, events};
}

function drawPlus(detector, cx, cy, time, pauseAfter = 350) {
    move(detector, {x: cx, y: cy - 90}, {x: cx, y: cy + 90}, 500, time, 0.8);
    time += 500;
    time = rest(detector, 200, time, {x: cx, y: cy + 90});
    move(detector, {x: cx - 90, y: cy}, {x: cx + 90, y: cy}, 500, time, 0.8);
    time += 500;
    time = rest(detector, pauseAfter, time, {x: cx + 90, y: cy});
    return time;
}

function drawFreeCross(detector, cx, cy, time, {
    verticalAngle = 0,
    horizontalAngle = 0,
    length = 160,
    jitter = 1,
    pauseAfter = 350,
} = {}) {
    const half = length / 2;
    const verticalRadians = verticalAngle * Math.PI / 180;
    const horizontalRadians = horizontalAngle * Math.PI / 180;

    const vx = Math.sin(verticalRadians) * half;
    const vy = Math.cos(verticalRadians) * half;
    move(detector, {x: cx - vx, y: cy - vy}, {x: cx + vx, y: cy + vy},
        500, time, jitter);
    time += 500;
    time = rest(detector, 180, time, {x: cx + vx, y: cy + vy});

    const hx = Math.cos(horizontalRadians) * half;
    const hy = Math.sin(horizontalRadians) * half;
    move(detector, {x: cx - hx, y: cy - hy}, {x: cx + hx, y: cy + hy},
        500, time, jitter);
    time += 500;
    time = rest(detector, pauseAfter, time, {x: cx + hx, y: cy + hy});
    return time;
}

function drawContinuousCrosses(detector, cx, cy, time, count, pauseAfter = 300) {
    for (let i = 0; i < count; i++) {
        // Start at the top of the upright, go down, across to the left
        // shoulder, then all the way across the crossbar.
        move(detector, {x: cx, y: cy - 85}, {x: cx, y: cy + 85},
            500, time, 1);
        time += 500;
        move(detector, {x: cx, y: cy + 85}, {x: cx - 85, y: cy},
            300, time, 1);
        time += 300;
        move(detector, {x: cx - 85, y: cy}, {x: cx + 85, y: cy},
            500, time, 1);
        time += 500;

        if (i < count - 1) {
            // Travel straight back to the top for the next cross without
            // giving the detector a rest between them.
            move(detector, {x: cx + 85, y: cy}, {x: cx, y: cy - 85},
                400, time, 1);
            time += 400;
        }
    }
    time = rest(detector, pauseAfter, time, {x: cx + 85, y: cy});
    return time;
}

function drawBlessing(detector, cx, cy, time, pauseAfter = 350) {
    // Forehead -> chest -> left shoulder -> right shoulder.
    move(detector, {x: cx, y: cy - 100}, {x: cx, y: cy + 30}, 450, time, 0.8);
    time += 450;
    move(detector, {x: cx, y: cy + 30}, {x: cx - 80, y: cy - 25}, 350, time, 0.8);
    time += 350;
    move(detector, {x: cx - 80, y: cy - 25}, {x: cx + 80, y: cy - 25}, 450, time, 0.8);
    time += 450;
    time = rest(detector, pauseAfter, time, {x: cx + 80, y: cy - 25});
    return time;
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    for (let i = 0; i < 3; i++)
        time = drawPlus(detector, 500, 400, time);
    assert.equal(events.triggers, 1, 'three plus signs trigger once');
    assert.deepEqual(events.crosses.map(e => e.count), [1, 2]);
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    for (let i = 0; i < 3; i++)
        time = drawBlessing(detector, 500, 400, time);
    assert.equal(events.triggers, 1, 'three blessing gestures trigger once');
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    for (let i = 0; i < 3; i++) {
        time = drawFreeCross(detector, 500, 400, time, {
            verticalAngle: 30,
            horizontalAngle: 30,
        });
    }
    assert.equal(events.triggers, 1,
        'a cross rotated 30 degrees still triggers');
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    for (let i = 0; i < 3; i++) {
        time = drawFreeCross(detector, 500, 400, time, {
            verticalAngle: -30,
            horizontalAngle: 30,
            jitter: 4,
        });
    }
    assert.equal(events.triggers, 1,
        'sloppy strokes within 30 degrees of each axis still trigger');
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    for (let i = 0; i < 3; i++) {
        // The upright stops at the crossbar, making a T rather than a plus.
        move(detector, {x: 500, y: 280}, {x: 500, y: 400}, 450, time);
        time += 450;
        time = rest(detector, 180, time, {x: 500, y: 400});
        move(detector, {x: 400, y: 400}, {x: 600, y: 400}, 500, time);
        time += 500;
        time = rest(detector, 350, time, {x: 600, y: 400});
    }
    assert.equal(events.triggers, 1,
        'a T-junction at the crossbar still counts');
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    time = drawPlus(detector, 500, 400, time);
    time = drawPlus(detector, 700, 500, time);
    assert.equal(events.triggers, 0, 'two crosses are not enough');
    assert.equal(events.crosses.length, 2);
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    // Three crosses drawn over more than the time window.
    for (let i = 0; i < 3; i++) {
        time = drawPlus(detector, 300 + i * 150, 300, time);
        time = rest(detector, 3000, time, {x: 300 + i * 150 + 90, y: 300});
    }
    assert.equal(events.triggers, 0, 'crosses outside the window do not fire');
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    time = drawContinuousCrosses(detector, 500, 400, time, 2);
    assert.equal(events.crosses.length, 2,
        'two crosses drawn back to back are both counted');
    assert.equal(events.triggers, 0);
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    time = drawContinuousCrosses(detector, 500, 400, time, 3);
    assert.equal(events.triggers, 1,
        'three continuous crosses trigger without rests between them');
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    // A plus drawn with four separately paused strokes.
    move(detector, {x: 500, y: 300}, {x: 500, y: 400}, 300, time);
    time += 300;
    time = rest(detector, 200, time, {x: 500, y: 400});
    move(detector, {x: 500, y: 400}, {x: 500, y: 500}, 300, time);
    time += 300;
    time = rest(detector, 200, time, {x: 500, y: 400});
    move(detector, {x: 400, y: 400}, {x: 500, y: 400}, 300, time);
    time += 300;
    time = rest(detector, 200, time, {x: 500, y: 400});
    move(detector, {x: 500, y: 400}, {x: 600, y: 400}, 300, time);
    time += 300;
    time = rest(detector, 500, time, {x: 600, y: 400});
    assert.ok(events.crosses.length <= 1,
        `one four-stroke plus counts once, got ${events.crosses.length}`);
    assert.equal(events.triggers, 0);
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    // Random-ish ordinary pointer movement: no long, straight, crossing pairs.
    const points = [
        [200, 200], [320, 260], [410, 210], [470, 330], [640, 380],
        [700, 250], [820, 300], [900, 440], [760, 520], [620, 470],
        [500, 580], [350, 540], [250, 620], [180, 480], [300, 400],
    ];
    for (let round = 0; round < 3; round++) {
        for (let i = 1; i < points.length; i++) {
            const from = {x: points[i - 1][0] + round * 20, y: points[i - 1][1]};
            const to = {x: points[i][0] + round * 20, y: points[i][1]};
            time = move(detector, from, to, 180, time, 2.5);
            time = rest(detector, 80, time, {x: points[i][0] + round * 20, y: points[i][1]});
        }
    }
    assert.equal(events.triggers, 0, 'ordinary movement does not trigger');
}

{
    const {detector, events} = makeDetector();
    let time = 1000;
    // An L shape is not a cross.
    for (let i = 0; i < 3; i++) {
        move(detector, {x: 500, y: 300}, {x: 500, y: 450}, 450, time);
        time += 450;
        move(detector, {x: 500, y: 450}, {x: 650, y: 450}, 450, time);
        time += 450;
        time = rest(detector, 300, time, {x: 650, y: 450});
    }
    assert.equal(events.triggers, 0, 'an L shape does not trigger');
}

console.log('gesture tests passed');
