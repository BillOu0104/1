import { expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { Trail } from '../src/rendering/Trail';
it('keeps long accelerated multi-seed sessions finite with bounded event history', () => {
  for (let seed = 0; seed < 12; seed++) {
    const engine = new SimulationEngine(`soak-${seed}`);
    engine.setControls({ speed: 10 });
    for (let frame = 0; frame < 1200; frame++) {
      engine.advance(0.1);
      if (frame % 120 === 0) {
        const snapshot = engine.snapshot();
        expect(
          snapshot.bodies.every((b) => [...b.position, ...b.velocity].every(Number.isFinite)),
        ).toBe(true);
        expect(Number.isFinite(snapshot.energy)).toBe(true);
        expect(snapshot.events.length).toBeLessThanOrEqual(60);
      }
    }
  }
}, 60000);
it('bounds trail allocation and orders wrapped points without stale restart geometry', () => {
  const trail = new Trail('#fff', 512),
    attribute = trail.line.geometry.getAttribute('position');
  const array = attribute.array;
  for (let i = 0; i < 2000; i++) trail.push([i, i + 1, i + 2], i * 0.001);
  trail.setWindow(2, 10);
  expect(attribute.array).toBe(array);
  expect(attribute.count).toBe(1024);
  const { start, count } = trail.line.geometry.drawRange;
  expect(count).toBe(512);
  expect(attribute.getX(start)).toBe(1488);
  expect(attribute.getX(start + count - 1)).toBe(1999);
  trail.clear();
  expect(trail.line.geometry.drawRange.count).toBe(0);
  trail.push([7, 8, 9], 0);
  trail.setWindow(0, 2);
  expect(trail.line.geometry.drawRange.count).toBe(1);
  expect(attribute.getX(0)).toBe(7);
  trail.dispose();
});
