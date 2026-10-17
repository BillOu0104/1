import { expect, it } from 'vitest';
import { TrajectoryRecorder, TRAIL_CAPACITY } from '../src/physics/trajectory';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { Trail } from '../src/rendering/Trail';
import { UNITS_PER_YEAR, type Body } from '../src/physics/types';
const circular = (): Body[] => [
  {
    id: 'sun',
    name: 'sun',
    kind: 'star',
    mass: 1,
    radius: 1e-6,
    color: '#fff',
    position: [0, 0, 0],
    velocity: [0, 0, 0],
  },
  {
    id: 'planet',
    name: 'planet',
    kind: 'planet',
    mass: 1e-10,
    radius: 1e-7,
    color: '#fff',
    position: [1, 0, 0],
    velocity: [0, 1, 0],
  },
];
it('keeps physical curve samples dense at 20× even if rendering would only sample once per 250ms', () => {
  const recorder = new TrajectoryRecorder();
  const engine = new SimulationEngine('circle', {
    initialBodies: circular(),
    tides: { enabled: false },
    onAcceptedState: (b, t, g) => recorder.capture(b, t, g),
  });
  engine.setControls({ speed: 20, autoRestart: false });
  let points = 0,
    previousTime = -1,
    largestSagitta = 0;
  for (let frame = 0; frame < 8; frame++) {
    engine.advance(0.25);
    const batch = recorder.drain();
    for (let i = 0; i < batch.points.length; i += 5)
      if (batch.points[i] === 1) {
        const t = batch.points[i + 1]!;
        const x = batch.points[i + 2]!,
          y = batch.points[i + 3]!;
        expect(Math.hypot(x - Math.cos(t), y - Math.sin(t))).toBeLessThan(2e-7);
        if (previousTime >= 0)
          largestSagitta = Math.max(largestSagitta, 1 - Math.cos((t - previousTime) / 2));
        previousTime = t;
        points++;
      }
  }
  expect(engine.getReason()).toBeNull();
  expect(points).toBeGreaterThan(300); // old renderer: at most 8 points
  expect(largestSagitta).toBeLessThan(0.0005); // <0.5px at 1000px / AU
});
it('retains more actual integration points near eccentric periapsis and clears batches on generation change', () => {
  const recorder = new TrajectoryRecorder(),
    bodies = circular();
  bodies[1]!.position = [1.99, 0, 0];
  bodies[1]!.velocity = [0, Math.sqrt(0.01 / 1.99), 0];
  const engine = new SimulationEngine('eccentric', {
    initialBodies: bodies,
    tides: { enabled: false },
    onAcceptedState: (b, t, g) => recorder.capture(b, t, g),
  });
  engine.setControls({ speed: 20, autoRestart: false });
  let periDt = Infinity,
    apoDt = 0,
    lastTime = 0;
  for (let frame = 0; frame < 30 && engine.getTime() < 6.3; frame++) {
    engine.advance(0.025);
    const { points } = recorder.drain();
    for (let i = 0; i < points.length; i += 5)
      if (points[i] === 1) {
        const time = points[i + 1]!,
          r = Math.hypot(points[i + 2]!, points[i + 3]!);
        if (r < 0.03) periDt = Math.min(periDt, time - lastTime);
        if (r > 1) apoDt = Math.max(apoDt, time - lastTime);
        lastTime = time;
      }
  }
  expect(engine.getReason()).toBeNull();
  expect(periDt).toBeLessThan(apoDt / 100);
  engine.reset('new', circular());
  const batch = recorder.drain();
  expect(batch.generation).toBe(2);
  expect(batch.points.length).toBe(10);
  expect(batch.points[1]).toBe(0);
});
it('compresses straight accepted histories, keeps finite transport batches and no interpolated positions', () => {
  const recorder = new TrajectoryRecorder(),
    bodies = circular();
  for (let i = 0; i <= 200; i++) {
    bodies[1]!.position = [i * 0.001, 0, 0];
    bodies[1]!.velocity = [1, 0, 0];
    recorder.capture(bodies, i * 0.001, 1);
  }
  const batch = recorder.drain();
  expect(batch.points.length).toBe(20); // initial + final for each body
  expect(batch.points[batch.points.length - 4]).toBe(0.2);
  expect(recorder.drain().points.length).toBe(0);
});
it('selects a simulation-time window immediately, expands retained history and bounds CPU/GPU storage', () => {
  const trail = new Trail('#fff'),
    geometry = trail.line.geometry;
  const attribute = geometry.getAttribute('position'),
    storage = attribute.array;
  for (let i = 0; i < TRAIL_CAPACITY * 3; i++) trail.push([i, 0, 0], i * 0.01);
  const now = (TRAIL_CAPACITY * 3 - 1) * 0.01;
  trail.setWindow(now, 0.1);
  expect(geometry.drawRange.count).toBeCloseTo((0.1 * UNITS_PER_YEAR) / 0.01, -1);
  const short = geometry.drawRange.count;
  trail.setWindow(now, 2);
  expect(geometry.drawRange.count).toBeGreaterThan(short * 15);
  trail.setWindow(now, 10);
  expect(geometry.drawRange.count).toBeLessThanOrEqual(TRAIL_CAPACITY);
  expect(attribute.array).toBe(storage);
  expect(attribute.count).toBe(TRAIL_CAPACITY * 2);
  trail.clear();
  trail.push([7, 8, 9], 0);
  trail.setWindow(0, 2);
  expect(geometry.drawRange.count).toBe(1);
  expect(attribute.getX(geometry.drawRange.start)).toBe(7);
  // Only one new vertex in each mirrored half is uploaded after reset.
  expect(
    (attribute as { updateRanges: { count: number }[] }).updateRanges.map((r) => r.count),
  ).toEqual([3, 3]);
  trail.dispose();
});

it('never draws newer history ahead of the interpolated body display time', () => {
  const trail = new Trail('#fff', 32);
  for (let i = 0; i < 20; i++) trail.push([i, 0, 0], i * 0.1);
  trail.setWindow(1.05, 2);
  const { start, count } = trail.line.geometry.drawRange;
  expect(count).toBe(11);
  expect(trail.line.geometry.getAttribute('position').getX(start + count - 1)).toBe(10);
  trail.dispose();
});

it('keeps every dirty GPU range while hidden until an actual upload acknowledgment', () => {
  const trail = new Trail('#fff', 16);
  const attribute = trail.line.geometry.getAttribute('position') as import('three').BufferAttribute;
  trail.push([0, 0, 0], 0);
  trail.setWindow(0, 2);
  attribute.onUploadCallback(); // initial GPU upload
  trail.line.visible = false;
  for (let i = 1; i <= 5; i++) {
    trail.push([i, 0, 0], i);
    trail.setWindow(i, 2); // invisible objects do not receive upload acknowledgments
  }
  expect(attribute.updateRanges).toEqual([
    { start: 3, count: 15 },
    { start: 51, count: 15 },
  ]);
  trail.line.visible = true;
  attribute.onUploadCallback();
  attribute.clearUpdateRanges();
  trail.push([6, 0, 0], 6);
  trail.setWindow(6, 2);
  expect(attribute.updateRanges).toEqual([
    { start: 18, count: 3 },
    { start: 66, count: 3 },
  ]);
  trail.dispose();
});
