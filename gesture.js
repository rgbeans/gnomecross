// SPDX-License-Identifier: MIT
//
// Detects crosses drawn with the pointer.
//
// The pointer path is split into fairly straight strokes at sharp corners
// and when it comes to rest. A cross is a horizontal-ish stroke and a
// vertical-ish stroke that cross each other, close together in time. Each
// stroke may be up to 30 degrees off its axis. Drawing the sign of the cross
// (down, then across a shoulder line) produces exactly such a pair, as does
// drawing a plus sign. Several crosses can be detected in one continuous
// path.

const IDLE_COMMIT_MS = 110;
const MAX_BUFFER_MS = 7000;
const CORNER_CHECK_MS = 60;
const CORNER_ANGLE = 45 * Math.PI / 180;
const RDP_EPSILON = 10;
const MIN_STRAIGHTNESS = 0.55; // wobbly hand-drawn lines are fine
const MIN_SPEED = 20; // px/s
const MIN_STROKE_MS = 70;
const MAX_STROKE_MS = 7000;

const MAX_PAIR_GAP_MS = 2200;
const MAX_LENGTH_RATIO = 4.0;
// 30 degrees either side of an axis, plus a little room for pixel rounding
// and hand wobble at the edge of that range.
const AXIS_TOLERANCE = 32 * Math.PI / 180;
const INTERSECTION_SLOP = 0.05; // allow a small gap at an imperfect crossing
const INTERSECTION_EDGE = 0.06; // this close to an end counts as a T-junction


const MAX_STROKES = 40;

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function cross(a, b) {
    return a.x * b.y - a.y * b.x;
}

function perpendicularDistance(point, start, end) {
    const lineLength = distance(start, end);
    if (lineLength === 0)
        return distance(point, start);

    const t = ((point.x - start.x) * (end.x - start.x) +
               (point.y - start.y) * (end.y - start.y)) /
        (lineLength * lineLength);
    const clamped = Math.max(0, Math.min(1, t));
    const x = start.x + clamped * (end.x - start.x);
    const y = start.y + clamped * (end.y - start.y);
    return Math.hypot(point.x - x, point.y - y);
}

// Ramer-Douglas-Peucker, returning indices into the original point array.
function simplifyIndices(points, epsilon) {
    if (points.length <= 2)
        return points.map((_, index) => index);

    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;

    const stack = [[0, points.length - 1]];
    while (stack.length > 0) {
        const [first, last] = stack.pop();
        if (last <= first + 1)
            continue;

        let furthest = -1;
        let furthestDistance = 0;
        for (let i = first + 1; i < last; i++) {
            const d = perpendicularDistance(points[i], points[first], points[last]);
            if (d > furthestDistance) {
                furthestDistance = d;
                furthest = i;
            }
        }

        if (furthestDistance > epsilon) {
            keep[furthest] = 1;
            stack.push([first, furthest], [furthest, last]);
        }
    }

    const indices = [];
    for (let i = 0; i < keep.length; i++) {
        if (keep[i])
            indices.push(i);
    }
    return indices;
}

// Fit a line through all the points in a stroke, rather than looking only at
// its two endpoints. That keeps a wobble at the end from making a horizontal
// stroke look diagonal.
function fitAngle(points, first, last) {
    let meanX = 0;
    let meanY = 0;
    const count = last - first + 1;
    for (let i = first; i <= last; i++) {
        meanX += points[i].x;
        meanY += points[i].y;
    }
    meanX /= count;
    meanY /= count;

    let xx = 0;
    let yy = 0;
    let xy = 0;
    for (let i = first; i <= last; i++) {
        const dx = points[i].x - meanX;
        const dy = points[i].y - meanY;
        xx += dx * dx;
        yy += dy * dy;
        xy += dx * dy;
    }

    if (xx + yy === 0)
        return 0;
    return 0.5 * Math.atan2(2 * xy, xx - yy);
}

// A line counts as horizontal or vertical when it is within 30 degrees of
// that axis. Hand-drawn diagonals are therefore fine as cross strokes.
function axisOf(angle) {
    const normalized = ((angle % Math.PI) + Math.PI) % Math.PI;
    const fromHorizontal = Math.min(normalized, Math.PI - normalized);
    if (fromHorizontal <= AXIS_TOLERANCE)
        return 'horizontal';
    if (Math.abs(fromHorizontal - Math.PI / 2) <= AXIS_TOLERANCE)
        return 'vertical';
    return 'diagonal';
}

function segmentIntersection(a, b) {
    const p = {x: a.x1, y: a.y1};
    const r = {x: a.x2 - a.x1, y: a.y2 - a.y1};
    const q = {x: b.x1, y: b.y1};
    const s = {x: b.x2 - b.x1, y: b.y2 - b.y1};

    const denominator = cross(r, s);
    if (Math.abs(denominator) < 1e-6)
        return null;

    const qp = {x: q.x - p.x, y: q.y - p.y};
    const t = cross(qp, s) / denominator;
    const u = cross(qp, r) / denominator;

    if (t < -INTERSECTION_SLOP || t > 1 + INTERSECTION_SLOP ||
        u < -INTERSECTION_SLOP || u > 1 + INTERSECTION_SLOP)
        return null;

    // A T-junction is fine: plenty of people finish the upright at the
    // crossbar. An L, where both strokes merely meet at an end, is not.
    const tAtEnd = t <= INTERSECTION_EDGE || t >= 1 - INTERSECTION_EDGE;
    const uAtEnd = u <= INTERSECTION_EDGE || u >= 1 - INTERSECTION_EDGE;
    if (tAtEnd && uAtEnd)
        return null;

    return {
        x: p.x + t * r.x,
        y: p.y + t * r.y,
        t,
        u,
    };
}

export class CrossDetector {
    constructor(options = {}) {
        this._onCross = options.onCross ?? null;
        this._onTrigger = options.onTrigger ?? null;
        this._debug = options.debug ?? false;

        this._requiredCrosses = options.requiredCrosses ?? 3;
        this._crossTimeoutMs = (options.crossTimeoutSeconds ?? 2) * 1000;
        this._minStrokeLength = Math.max(200, options.minStrokeLength ?? 200);

        this._buffer = [];
        this._lastPoint = null;
        this._lastMovementTime = 0;
        this._lastCornerCheck = 0;
        this._strokes = [];
        this._nextStrokeId = 1;
        this._crossCount = 0;
        this._lastCrossTime = 0;

        this.reset();
    }

    configure(options = {}) {
        if (options.requiredCrosses !== undefined)
            this._requiredCrosses = Math.max(1, options.requiredCrosses);
        if (options.crossTimeoutSeconds !== undefined)
            this._crossTimeoutMs = Math.max(1, options.crossTimeoutSeconds) * 1000;
        if (options.minStrokeLength !== undefined)
            this._minStrokeLength = Math.max(200, options.minStrokeLength);
    }

    reset() {
        this._buffer = [];
        this._lastPoint = null;
        this._lastMovementTime = 0;
        this._lastCornerCheck = 0;
        this._strokes = [];
        this._crossCount = 0;
        this._lastCrossTime = 0;
    }

    _resetProgress() {
        this._crossCount = 0;
        this._lastCrossTime = 0;
        this._strokes = [];
        this._buffer = [];
    }

    addSample(x, y, timeMs) {
        if (this._crossCount > 0 &&
            timeMs - this._lastCrossTime > this._crossTimeoutMs) {
            if (this._debug)
                console.log('[gnomecross] cross sequence timed out');
            this._resetProgress();
            this._lastCornerCheck = timeMs;
        }

        const point = {x, y, t: timeMs};

        if (!this._lastPoint) {
            this._lastPoint = point;
            return;
        }

        const moved = distance(this._lastPoint, point);
        if (moved >= 1.2) {
            if (this._buffer.length === 0) {
                this._buffer.push(point);
            } else {
                const last = this._buffer[this._buffer.length - 1];
                if (distance(last, point) >= 1.2)
                    this._buffer.push(point);
                else
                    this._buffer[this._buffer.length - 1] = point;
            }

            this._lastMovementTime = timeMs;
            this._lastPoint = point;

            const first = this._buffer[0];
            if (this._buffer.length > 6000 ||
                timeMs - first.t > MAX_BUFFER_MS) {
                this._commitBuffer();
            } else if (timeMs - this._lastCornerCheck >= CORNER_CHECK_MS) {
                this._lastCornerCheck = timeMs;
                this._commitAtCorner();
            }
            return;
        }

        this._lastPoint = point;

        if (this._buffer.length > 1 &&
            timeMs - this._lastMovementTime >= IDLE_COMMIT_MS) {
            this._commitBuffer();
        }
    }

    _commitBuffer() {
        const points = this._buffer;
        this._buffer = [];
        this._lastCornerCheck = this._lastMovementTime;
        this._processPoints(points);
    }

    _commitAtCorner() {
        if (this._buffer.length < 8)
            return;

        const points = this._buffer;
        const indices = simplifyIndices(points, RDP_EPSILON);
        if (indices.length < 3)
            return;

        for (let i = 1; i < indices.length - 1; i++) {
            const previous = indices[i - 1];
            const corner = indices[i];
            const next = indices[i + 1];

            const prev = {
                x: points[corner].x - points[previous].x,
                y: points[corner].y - points[previous].y,
            };
            const following = {
                x: points[next].x - points[corner].x,
                y: points[next].y - points[corner].y,
            };
            const prevLength = Math.hypot(prev.x, prev.y);
            const nextLength = Math.hypot(following.x, following.y);
            if (prevLength < this._minStrokeLength || nextLength < 15)
                continue;

            const angle = Math.abs(Math.atan2(
                prev.x * following.y - prev.y * following.x,
                prev.x * following.x + prev.y * following.y));
            if (angle < CORNER_ANGLE)
                continue;

            const prefix = points.slice(0, corner + 1);
            this._buffer = points.slice(corner);
            this._lastCornerCheck = this._lastMovementTime;
            this._processPoints(prefix);
            return;
        }
    }

    _processPoints(points) {
        if (points.length < 3)
            return;

        const indices = simplifyIndices(points, RDP_EPSILON);
        if (indices.length < 2)
            return;

        const newStrokes = [];
        for (let i = 0; i < indices.length - 1; i++) {
            const stroke = this._makeStroke(
                points, indices[i], indices[i + 1]);
            if (stroke)
                newStrokes.push(stroke);
        }

        if (newStrokes.length === 0)
            return;

        for (const stroke of newStrokes) {
            this._mergeOrAppend(stroke);
            if (this._debug) {
                console.log(`[gnomecross] stroke ${stroke.axis}: ` +
                    `${Math.round(stroke.length)} px, ` +
                    `${Math.round(stroke.duration)} ms, ` +
                    `straightness ${stroke.straightness.toFixed(2)}`);
            }
        }

        this._findCross();

        if (this._strokes.length > MAX_STROKES)
            this._strokes = this._strokes.slice(-MAX_STROKES);
    }

    _makeStroke(points, firstIndex, lastIndex) {
        const start = points[firstIndex];
        const end = points[lastIndex];
        const length = distance(start, end);
        if (length < this._minStrokeLength)
            return null;

        const duration = end.t - start.t;
        if (duration < MIN_STROKE_MS || duration > MAX_STROKE_MS)
            return null;

        let pathLength = 0;
        for (let i = firstIndex + 1; i <= lastIndex; i++)
            pathLength += distance(points[i - 1], points[i]);

        if (pathLength === 0)
            return null;

        const straightness = length / pathLength;
        const speed = length / duration * 1000;
        if (straightness < MIN_STRAIGHTNESS || speed < MIN_SPEED)
            return null;

        const angle = fitAngle(points, firstIndex, lastIndex);

        return {
            id: this._nextStrokeId++,
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            startTime: start.t,
            endTime: end.t,
            duration,
            length,
            pathLength,
            straightness,
            speed,
            angle,
            axis: axisOf(angle),
            used: false,
        };
    }

    _canMerge(previous, next) {
        const gap = next.startTime - previous.endTime;
        if (gap < -30 || gap > 260)
            return false;

        const dot = Math.cos(previous.angle - next.angle);
        if (dot < 0.94) // less than about 20 degrees apart
            return false;

        const connection = Math.hypot(
            next.x1 - previous.x2, next.y1 - previous.y2);
        if (connection > Math.max(28, Math.min(previous.length, next.length) * 0.35))
            return false;

        // Make sure the second stroke continues forwards rather than folding
        // back over the first one.
        const ux = Math.cos(previous.angle);
        const uy = Math.sin(previous.angle);
        const advance = (next.x2 - previous.x1) * ux +
            (next.y2 - previous.y1) * uy;
        return advance > previous.length * 0.7;
    }

    _mergeOrAppend(stroke) {
        const previous = this._strokes[this._strokes.length - 1];
        if (previous && !previous.used && this._canMerge(previous, stroke)) {
            const mergedLength = Math.hypot(
                stroke.x2 - previous.x1, stroke.y2 - previous.y1);
            previous.x2 = stroke.x2;
            previous.y2 = stroke.y2;
            previous.endTime = stroke.endTime;
            previous.duration = previous.endTime - previous.startTime;
            previous.pathLength += stroke.pathLength;
            previous.length = mergedLength;
            previous.straightness = mergedLength / previous.pathLength;
            previous.speed = mergedLength / previous.duration * 1000;
            previous.angle = Math.atan2(
                previous.y2 - previous.y1, previous.x2 - previous.x1);
            return;
        }

        this._strokes.push(stroke);
    }

    _findCross() {
        const now = this._lastMovementTime;
        const recent = this._strokes.filter(stroke =>
            now - stroke.endTime <= MAX_PAIR_GAP_MS + MAX_STROKE_MS);

        // Collect every possible pairing, then match strokes greedily in path
        // order. A stroke can only belong to one cross, so two crosses drawn
        // back to back are both found, while retraced strokes do not make one
        // cross count twice.
        const candidates = [];
        for (let i = 0; i < recent.length; i++) {
            if (recent[i].used)
                continue;
            for (let j = i + 1; j < recent.length; j++) {
                if (recent[j].used)
                    continue;

                const candidate = this._crossCandidate(recent[i], recent[j]);
                if (candidate) {
                    candidate.time = Math.max(
                        candidate.first.endTime, candidate.second.endTime);
                    candidates.push(candidate);
                }
            }
        }

        candidates.sort((a, b) =>
            a.time - b.time || b.score - a.score);

        for (const candidate of candidates) {
            if (candidate.first.used || candidate.second.used)
                continue;

            candidate.first.used = true;
            candidate.second.used = true;

            if (this._registerCross(candidate))
                return;
        }
    }

    _registerCross(candidate) {
        const time = candidate.time;

        // The timeout is per cross: after each one, the next must be
        // completed within the configured time. A gap longer than that
        // starts a new sequence from this cross.
        if (this._crossCount > 0 &&
            time - this._lastCrossTime > this._crossTimeoutMs) {
            if (this._debug)
                console.log('[gnomecross] cross sequence timed out');
            this._crossCount = 0;
            this._lastCrossTime = 0;
        }

        this._crossCount += 1;
        this._lastCrossTime = time;

        if (this._debug) {
            console.log(`[gnomecross] cross at ` +
                `${Math.round(candidate.x)},${Math.round(candidate.y)} ` +
                `(${this._crossCount}/${this._requiredCrosses})`);
        }

        if (this._crossCount >= this._requiredCrosses) {
            this._crossCount = 0;
            this._lastCrossTime = 0;
            this._strokes = [];
            this._buffer = [];
            this._onTrigger?.();
            return true;
        }

        this._onCross?.(this._crossCount, this._requiredCrosses);
        return false;
    }

    _crossCandidate(first, second) {
        if (first.used || second.used)
            return null;

        const [earlier, later] = first.startTime <= second.startTime
            ? [first, second] : [second, first];

        const gap = later.startTime - earlier.endTime;
        if (gap < -80 || gap > MAX_PAIR_GAP_MS)
            return null;

        const minLength = Math.min(first.length, second.length);
        const maxLength = Math.max(first.length, second.length);
        if (maxLength / minLength > MAX_LENGTH_RATIO)
            return null;

        const crossedAxes =
            (first.axis === 'horizontal' && second.axis === 'vertical') ||
            (first.axis === 'vertical' && second.axis === 'horizontal');
        if (!crossedAxes)
            return null;

        const intersection = segmentIntersection(first, second);
        if (!intersection)
            return null;

        const score = first.length + second.length - Math.max(0, gap) * 0.05;
        return {
            first,
            second,
            x: intersection.x,
            y: intersection.y,
            score,
        };
    }
}
