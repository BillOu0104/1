import * as THREE from 'three';
import { MAX_TRAIL_YEARS, TRAIL_CAPACITY } from '../physics/trajectory';
import { UNITS_PER_YEAR } from '../physics/types';
/** Timestamped mirrored ring. Retention is bounded by capacity, visibility by simulation time.
 * Changing the window can reveal retained history without a reset or new physics work.
 */
export class Trail {
  readonly line: THREE.Line;
  private readonly points: Float32Array;
  private readonly times: Float64Array;
  private readonly attribute: THREE.BufferAttribute;
  private head = 0;
  private count = 0;
  private dirtyStart = 0;
  private dirtyCount = 0;
  constructor(
    color: string,
    private readonly capacity = TRAIL_CAPACITY,
  ) {
    this.points = new Float32Array(capacity * 2 * 3);
    this.times = new Float64Array(capacity);
    this.attribute = new THREE.BufferAttribute(this.points, 3).setUsage(THREE.DynamicDrawUsage);
    // A hidden line may skip GPU upload for many frames: retain all dirty ranges until acknowledged.
    this.attribute.onUpload(() => {
      this.dirtyCount = 0;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.attribute);
    geometry.setDrawRange(0, 0);
    this.line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    this.line.frustumCulled = false;
  }
  push(position: readonly number[], time: number): void {
    this.pushXYZ(time, position[0]!, position[1]!, position[2]!);
  }
  pushXYZ(time: number, x: number, y: number, z: number): void {
    if (this.count && time <= this.times[(this.head + this.capacity - 1) % this.capacity]!) return;
    const index = this.head * 3,
      mirror = (this.head + this.capacity) * 3;
    this.points[index] = this.points[mirror] = x;
    this.points[index + 1] = this.points[mirror + 1] = y;
    this.points[index + 2] = this.points[mirror + 2] = z;
    this.times[this.head] = time;
    if (this.dirtyCount === 0) this.dirtyStart = this.head;
    this.dirtyCount = Math.min(this.capacity, this.dirtyCount + 1);
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }
  setWindow(time: number, years: number): void {
    const start = this.count === this.capacity ? this.head : 0;
    const cutoff = time - Math.max(0.1, Math.min(MAX_TRAIL_YEARS, years)) * UNITS_PER_YEAR;
    const boundary = (value: number, inclusive: boolean): number => {
      let low = 0,
        high = this.count;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const timestamp = this.times[(start + middle) % this.capacity]!;
        if (timestamp < value || (inclusive && timestamp === value)) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    const first = boundary(cutoff, false),
      end = boundary(time, true);
    this.line.geometry.setDrawRange(start + first, Math.max(0, end - first));
    if (!this.dirtyCount) return;
    this.attribute.clearUpdateRanges();
    const add = (offset: number, count: number) => {
      if (!count) return;
      this.attribute.addUpdateRange(offset * 3, count * 3);
      this.attribute.addUpdateRange((offset + this.capacity) * 3, count * 3);
    };
    if (this.dirtyCount >= this.capacity) add(0, this.capacity);
    else {
      const first = Math.min(this.dirtyCount, this.capacity - this.dirtyStart);
      add(this.dirtyStart, first);
      add(0, this.dirtyCount - first);
    }
    this.attribute.needsUpdate = true;
  }
  clear(): void {
    this.head = this.count = this.dirtyCount = 0;
    this.attribute.clearUpdateRanges();
    this.line.geometry.setDrawRange(0, 0);
  }
  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}
