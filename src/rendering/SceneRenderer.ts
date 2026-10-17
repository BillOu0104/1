import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Body } from '../physics/types';
import { centerOfMass } from '../physics/vector';
import { seededRandom } from '../physics/random';
import { Trail } from './Trail';
interface BodyVisual {
  group: THREE.Group;
  trail: Trail;
}
export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(43, 1, 0.05, 1000);
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly visuals = new Map<string, BodyVisual>();
  private readonly glowTexture: THREE.CanvasTexture;
  private generation = -1;
  private lastTrailTime = -Infinity;
  private disposed = false;
  private readonly onLost = (event: Event) => {
    event.preventDefault();
    this.onError('WebGL 上下文已丢失。请点击重试恢复画面。');
  };
  constructor(
    private readonly container: HTMLElement,
    private readonly onError: (message: string) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor('#060b13');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.domElement.setAttribute('aria-label', '三体引力模拟三维场景');
    this.renderer.domElement.addEventListener('webglcontextlost', this.onLost);
    container.appendChild(this.renderer.domElement);
    this.camera.position.set(4, 8, 16);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 100;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.5;
    this.glowTexture = this.createGlow();
    this.createStars();
    this.scene.add(new THREE.AmbientLight('#b5cce9', 0.7));
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }
  private resize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);
  }
  private createGlow(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,0.75)');
    gradient.addColorStop(0.15, 'rgba(255,255,255,0.24)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.045)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }
  private createStars(): void {
    const random = seededRandom('observatory-background'),
      vertices: number[] = [],
      colors: number[] = [];
    for (let i = 0; i < 1800; i++) {
      const theta = random() * Math.PI * 2,
        y = random() * 2 - 1,
        r = 150 + random() * 150,
        s = Math.sqrt(1 - y * y);
      vertices.push(r * s * Math.cos(theta), r * y, r * s * Math.sin(theta));
      const light = 0.3 + random() * 0.6;
      colors.push(light * 0.8, light * 0.88, light);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.scene.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          size: 0.22,
          vertexColors: true,
          transparent: true,
          opacity: 0.8,
          sizeAttenuation: true,
        }),
      ),
    );
  }
  private createBody(body: Body): BodyVisual {
    const group = new THREE.Group(),
      star = body.kind === 'star';
    // Deliberately enlarged visual radii for readability; collision uses physics radius.
    const radius = star ? 0.17 * Math.cbrt(body.mass) : 0.065;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 16),
      star
        ? new THREE.MeshBasicMaterial({ color: body.color })
        : new THREE.MeshStandardMaterial({ color: body.color, roughness: 0.85, metalness: 0.05 }),
    );
    group.add(mesh);
    if (star) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: body.color,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      sprite.scale.setScalar(radius * 12);
      group.add(sprite);
      group.add(new THREE.PointLight(body.color, 5, 25, 1.5));
    }
    const trail = new Trail(body.color);
    this.scene.add(group, trail.line);
    group.userData.baseMass = body.mass;
    const visual = { group, trail };
    this.visuals.set(body.id, visual);
    return visual;
  }
  render(
    bodies: readonly Body[],
    generation: number,
    time: number,
    showTrails: boolean,
    elapsed: number,
  ): void {
    if (this.disposed) return;
    if (this.generation !== generation) {
      this.generation = generation;
      this.lastTrailTime = -Infinity;
      this.visuals.forEach((v) => v.trail.clear());
    }
    const sample = time - this.lastTrailTime >= 0.025;
    for (const body of bodies) {
      if (!body.position.every(Number.isFinite)) continue;
      const visual = this.visuals.get(body.id) ?? this.createBody(body);
      visual.group.position.set(...body.position);
      if (body.kind === 'star')
        visual.group.scale.setScalar(Math.cbrt(body.mass / Number(visual.group.userData.baseMass)));
      visual.trail.line.visible = showTrails;
      if (sample) visual.trail.push(body.position);
    }
    if (sample) this.lastTrailTime = time;
    const center = centerOfMass(bodies.filter((b) => b.kind === 'star'));
    if (center.every(Number.isFinite)) {
      const target = new THREE.Vector3(...center),
        delta = target.sub(this.controls.target).multiplyScalar(1 - Math.exp(-elapsed * 2));
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost);
    this.visuals.forEach((v) => v.trail.dispose());
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((m) => m.dispose());
      } else if (object instanceof THREE.Sprite) object.material.dispose();
    });
    this.glowTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
