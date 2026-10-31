import * as THREE from 'three';
import { sinkCutters, sinkFacesChange } from '../core/modeling';
import { growOutline, prepareOutline } from '../core/outline';
import type { Piece, Vec3 } from '../core/piece';
import { createPieceObject, disposeObject } from '../render/meshes';
import type { ModelScene } from '../scene';

/** Cierra si el punto repite el primero; en pantalla, main lo ajusta al primero cuando el cursor está cerca. */
const CLOSE_EPS = 1e-6;
const ACCENT = 0xffb020;
const CLOSE_COLOR = 0x40e0a0;
const GROW_COLOR = 0xb58cff;

/**
 * Hace crecer o hundir solo la figura que se marca sobre una superficie: los puntos (que se pegan a vértices, aristas
 * prolongadas y vértices virtuales como en Cortar y Rellenar) dibujan un contorno, y ese contorno sube o baja
 * en perpendicular a la cara donde se marcó. Un clic sobre el primer punto, o Enter, confirma.
 */
export class OutlineTool {
  private points: Vec3[] = [];
  private hover: Vec3 | null = null;
  private overlay = new THREE.Group();
  private redoStack: Vec3[] = [];

  /** Se llama al cambiar el estado, para que el panel muestre los botones que tocan. */
  onPhaseChange: () => void = () => {};

  constructor(
    scene: THREE.Scene,
    private model: ModelScene,
    /** Hundir en vez de crecer. */
    private isSink: () => boolean,
    /** Cuánto sube o baja, dada la normal de la superficie (el selector "Cuánto" de Crecer). */
    private distanceFor: (normal: Vec3) => number,
    private setStatus: (message: string) => void,
    /** Añade las imágenes en espejo cuando hay simetría activa. */
    private expand: (pieces: Piece[]) => Piece[] = (pieces) => pieces,
  ) {
    scene.add(this.overlay);
  }

  get hasPoints(): boolean {
    return this.points.length > 0;
  }

  get hasRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get firstPoint(): Vec3 | null {
    return this.points[0] ?? null;
  }

  get pointCount(): number {
    return this.points.length;
  }

  undoPoint(): void {
    const last = this.points.pop();
    if (last) this.redoStack.push(last);
    this.refresh();
  }

  redoPoint(): void {
    const point = this.redoStack.pop();
    if (point) this.points.push(point);
    this.refresh();
  }

  activate(): void {
    this.points = [];
    this.redoStack = [];
    this.refresh();
  }

  deactivate(): void {
    this.points = [];
    this.clearOverlay();
    this.setStatus('');
  }

  setHover(point: Vec3 | null): void {
    this.hover = point;
    this.refresh();
  }

  /** Vuelve a dibujar con la cantidad o el sentido que haya ahora en el panel. */
  update(): void {
    this.refresh();
  }

  addPoint(point: Vec3): void {
    if (this.points.length >= 3 && dist(point, this.points[0]) < CLOSE_EPS) {
      this.apply();
      return;
    }
    if (this.points.some((p) => dist(p, point) < 1e-9)) return;
    this.points.push(point);
    this.redoStack = [];
    this.refresh();
  }

  cancel(): void {
    this.points = [];
    this.redoStack = [];
    this.refresh();
  }

  apply(): void {
    const outline = prepareOutline(this.points, this.model.all());
    if ('error' in outline) {
      this.setStatus(outline.error);
      return;
    }
    const distance = this.distanceFor(outline.normal);
    if (this.isSink()) {
      const change = sinkFacesChange(outline.faces, this.model.editable(), distance);
      if (change.removed.length === 0) {
        this.setStatus('No hay nada que hundir ahí');
        return;
      }
      this.model.apply(change);
    } else {
      this.model.apply({ added: this.expand(growOutline(outline, distance)), removed: [] });
    }
    this.points = [];
    this.redoStack = [];
    this.refresh();
  }

  private hint(): string {
    const n = this.points.length;
    const verb = this.isSink() ? 'hundir' : 'crecer';
    if (n === 0) return `Figura: marca los puntos de la figura que quieres ${verb}, sobre una cara`;
    if (n < 3) return `Punto ${n}. Hacen falta al menos 3 puntos en un mismo plano`;
    return `Punto ${n}. Clic en el primero (o Enter) para ${verb} la figura · Esc: cancelar`;
  }

  private clearOverlay(): void {
    for (const child of [...this.overlay.children]) {
      this.overlay.remove(child);
      disposeObject(child);
    }
  }

  private refresh(): void {
    this.clearOverlay();
    this.setStatus(this.hint());
    this.onPhaseChange();
    this.points.forEach((p, i) => this.overlay.add(marker(p, false, i === 0 && this.points.length >= 3)));
    if (this.hover) this.overlay.add(marker(this.hover, true, false));
    if (this.points.length >= 3) this.preview();
    else if (this.points.length >= 1) this.outlineLine();
  }

  private preview(): void {
    const outline = prepareOutline(this.points, this.model.all());
    if ('error' in outline) {
      this.outlineLine();
      return;
    }
    const distance = this.distanceFor(outline.normal);
    if (this.isSink()) {
      for (const cutter of sinkCutters(outline.faces, distance)) this.overlay.add(createPieceObject(cutter, true));
    } else {
      for (const piece of growOutline(outline, distance)) {
        piece.color = GROW_COLOR;
        for (const copy of this.expand([piece])) this.overlay.add(createPieceObject(copy, true));
      }
    }
    this.outlineLine();
  }

  /** El contorno de los puntos marcados, cerrado si ya hay tres. */
  private outlineLine(): void {
    const list = this.hover && this.points.length < 3 ? [...this.points, this.hover] : this.points;
    if (list.length < 2) return;
    const coords: number[] = [];
    const count = list.length >= 3 ? list.length : list.length - 1;
    for (let i = 0; i < count; i++) coords.push(...list[i], ...list[(i + 1) % list.length]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false }));
    line.renderOrder = 10;
    this.overlay.add(line);
  }
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function marker(p: Vec3, preview: boolean, closeTarget: boolean): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: closeTarget ? CLOSE_COLOR : ACCENT,
    transparent: true,
    opacity: preview ? 0.55 : 1,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(closeTarget ? 0.11 : 0.06, 16, 12), material);
  mesh.position.set(p[0], p[1], p[2]);
  mesh.renderOrder = 10;
  return mesh;
}
