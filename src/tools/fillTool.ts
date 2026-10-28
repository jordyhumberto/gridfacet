import * as THREE from 'three';
import { convexHull } from '../core/hull';
import { makePiece, type Piece, type Vec3 } from '../core/piece';
import { createPieceObject, disposeObject } from '../render/meshes';
import type { ModelScene } from '../scene';

/** Cierra si el punto repite el primero; en pantalla, main lo ajusta al primero cuando el cursor está cerca. */
const CLOSE_EPS = 1e-6;
const ACCENT = 0xffb020;
const CLOSE_COLOR = 0x40e0a0;

/**
 * Rellena con una pieza sólida el volumen que encierran los puntos marcados (su casco convexo).
 * Un clic sobre el primer punto, o Enter, confirma.
 */
export class FillTool {
  private points: Vec3[] = [];
  private hover: Vec3 | null = null;
  private overlay = new THREE.Group();

  /** Se llama al cambiar el estado, para que el panel muestre los botones que tocan. */
  onPhaseChange: () => void = () => {};

  constructor(
    scene: THREE.Scene,
    private model: ModelScene,
    private getColor: () => number,
    private setStatus: (message: string) => void,
    /** Añade las imágenes en espejo cuando hay simetría activa. */
    private expand: (pieces: Piece[]) => Piece[] = (pieces) => pieces,
  ) {
    scene.add(this.overlay);
  }

  /** Puntos quitados con `undoPoint` que se pueden reponer. */
  private redoStack: Vec3[] = [];

  get hasPoints(): boolean {
    return this.points.length > 0;
  }

  /** Quita el último punto marcado. */
  undoPoint(): void {
    const last = this.points.pop();
    if (last) this.redoStack.push(last);
    this.refresh();
  }

  get hasRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Repone el último punto quitado con `undoPoint`. */
  redoPoint(): void {
    const point = this.redoStack.pop();
    if (point) this.points.push(point);
    this.refresh();
  }

  /** Primer punto marcado, para cerrar. */
  get firstPoint(): Vec3 | null {
    return this.points[0] ?? null;
  }

  get pointCount(): number {
    return this.points.length;
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

  addPoint(point: Vec3): void {
    if (this.points.length >= 4 && dist(point, this.points[0]) < CLOSE_EPS) {
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
    const piece = this.build();
    if (!piece) {
      this.setStatus('Los puntos están en un mismo plano; marca al menos uno fuera de él para dar volumen');
      return;
    }
    this.model.apply({ added: this.expand([piece]), removed: [] });
    this.points = [];
    this.refresh();
  }

  private build(): Piece | null {
    const faces = convexHull(this.points);
    return faces ? makePiece(faces, this.getColor()) : null;
  }

  private hint(): string {
    const n = this.points.length;
    if (n === 0) return 'Rellenar: marca los puntos del volumen que quieres llenar';
    if (n < 4) return `Punto ${n}. Hacen falta al menos 4 puntos que no estén en un mismo plano`;
    return `Punto ${n}. Clic en el primero (o Enter) para rellenar · Esc: cancelar`;
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
    this.points.forEach((p, i) => this.overlay.add(marker(p, false, i === 0 && this.points.length >= 4)));
    if (this.hover) this.overlay.add(marker(this.hover, true, false));
    const preview = this.build();
    if (preview) for (const piece of this.expand([preview])) this.overlay.add(createPieceObject(piece, true));
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
