import * as THREE from 'three';
/** Mirrored ring buffer: a contiguous draw range without reallocations or array shifts. */
export class Trail {
  readonly line: THREE.Line;
  private readonly capacity = 512;
  private readonly points = new Float32Array(this.capacity * 2 * 3);
  private readonly attribute = new THREE.BufferAttribute(this.points, 3);
  private head = 0;
  private count = 0;
  constructor(color: string) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.attribute);
    geometry.setDrawRange(0, 0);
    this.line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    this.line.frustumCulled = false;
    this.attribute.setUsage(THREE.DynamicDrawUsage);
  }
  push(position: readonly number[]): void {
    for (let axis = 0; axis < 3; axis++) {
      this.points[this.head * 3 + axis] = position[axis]!;
      this.points[(this.head + this.capacity) * 3 + axis] = position[axis]!;
    }
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.attribute.needsUpdate = true;
    const start = this.count === this.capacity ? this.head : 0;
    this.line.geometry.setDrawRange(start, this.count);
  }
  clear(): void {
    this.head = 0;
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
  }
  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}
