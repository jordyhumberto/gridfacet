import * as THREE from 'three';
import type { Piece, Vec3 } from '../core/piece';
import { candidatePoints, type Edge } from '../core/vertexCandidates';
import type { ModelScene } from '../scene';

/** Divisiones por arista que se pueden elegir con los botones de más / menos puntos. */
const LEVELS = [2, 4, 6, 8, 12];
const DEFAULT_LEVEL = 1;
/** Distancia en pantalla (px) a la que el cursor "agarra" un punto candidato. */
const PICK_RADIUS = 14;
const MAX_TARGETS = 200;
const CANDIDATE_COLOR = 0xffd34d;
const HOVER_COLOR = 0x40e0ff;

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Añade puntos de referencia (vértices sueltos) a las piezas elegidas. Solo se pueden poner en posiciones válidas:
 * subdivisiones de las aristas, una cuadrícula opcional en las caras y los cruces con otras piezas; con Alt, en
 * cualquier punto de una arista.
 */
export class VertexTool {
  faces = false;

  private level = DEFAULT_LEVEL;
  private candidates: Vec3[] = [];
  private edges: Edge[] = [];
  private hover: Vec3 | null = null;
  private active = false;
  private overlay = new THREE.Group();
  /** Solo cuentan (y se dibujan) los candidatos que esta función da por visibles; null: todos. */
  private isVisible: ((p: Vec3) => boolean) | null = null;
  private visible = new Set<Vec3>();
  private visibleKey = '';

  /** Se llama al cambiar el estado, para que el panel muestre la densidad actual. */
  onPhaseChange: () => void = () => {};

  constructor(
    scene: THREE.Scene,
    private model: ModelScene,
    private getTargets: () => Piece[],
    private setStatus: (message: string) => void,
    /** Añade las imágenes en espejo cuando hay simetría activa. */
    private expand: (points: Vec3[]) => Vec3[] = (points) => points,
  ) {
    scene.add(this.overlay);
  }

  get divisions(): number {
    return LEVELS[this.level];
  }

  /** Comprueba que hay piezas elegidas antes de entrar en la herramienta. */
  canStart(): boolean {
    const targets = this.getTargets();
    if (targets.length === 0) {
      this.setStatus('Elige primero (S) la pieza a la que quieres añadir vértices');
      return false;
    }
    if (targets.length > MAX_TARGETS) {
      this.setStatus(`Hay demasiadas piezas elegidas (${targets.length}); elige menos de ${MAX_TARGETS}`);
      return false;
    }
    return true;
  }

  activate(): void {
    this.active = true;
    this.level = DEFAULT_LEVEL;
    this.recompute();
  }

  deactivate(): void {
    this.active = false;
    this.hover = null;
    this.clearOverlay();
    this.setStatus('');
  }

  morePoints(): void {
    this.level = Math.min(LEVELS.length - 1, this.level + 1);
    this.recompute();
  }

  fewerPoints(): void {
    this.level = Math.max(0, this.level - 1);
    this.recompute();
  }

  setFaces(on: boolean): void {
    this.faces = on;
    this.recompute();
  }

  /** Busca el punto candidato bajo el cursor; con `free`, el punto más cercano sobre cualquier arista. */
  hoverAt(cursor: ScreenPoint, ray: THREE.Ray, screenOf: (p: Vec3) => ScreenPoint | null, free: boolean, isVisible: ((p: Vec3) => boolean) | null = null, viewKey = ''): void {
    // Las comprobaciones de visibilidad cuestan un rayo por punto: se rehacen solo cuando la cámara o los candidatos cambian.
    const key = `${viewKey}|${this.candidates.length}`;
    if (isVisible && key !== this.visibleKey) {
      this.visible = new Set(this.candidates.filter(isVisible));
      this.visibleKey = key;
    }
    this.isVisible = isVisible;
    let best: Vec3 | null = null;
    let bestDist = PICK_RADIUS;
    const consider = (p: Vec3) => {
      if (isVisible && !free && !this.visible.has(p)) return;
      if (isVisible && free && !isVisible(p)) return;
      const s = screenOf(p);
      if (!s) return;
      const dist = Math.hypot(s.x - cursor.x, s.y - cursor.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    };
    if (free) {
      const onRay = new THREE.Vector3();
      const onEdge = new THREE.Vector3();
      for (const edge of this.edges) {
        ray.distanceSqToSegment(new THREE.Vector3(...edge.a), new THREE.Vector3(...edge.b), onRay, onEdge);
        consider([onEdge.x, onEdge.y, onEdge.z]);
      }
    } else {
      for (const p of this.candidates) consider(p);
    }
    this.hover = best;
    this.refresh();
  }

  clearHover(): void {
    this.hover = null;
    this.refresh();
  }

  click(): void {
    if (!this.hover) return;
    this.model.apply({ added: [], removed: [], marksAdded: this.expand([this.hover]) });
    this.refresh();
  }

  private recompute(): void {
    if (!this.active) return;
    const targets = this.getTargets();
    const result = candidatePoints(targets, this.model.all(), { divisions: this.divisions, faces: this.faces });
    this.candidates = result.points;
    this.visibleKey = '';
    this.edges = result.edges;
    this.hover = null;
    this.refresh();
    this.onPhaseChange();
  }

  private clearOverlay(): void {
    for (const child of [...this.overlay.children]) {
      this.overlay.remove(child);
      if (child instanceof THREE.Points || child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  private refresh(): void {
    this.clearOverlay();
    if (!this.active) return;
    this.setStatus(
      `Añadir vértice a ${this.getTargets().length} pieza(s): clic en un punto amarillo · Alt: libre sobre la arista · Esc: salir`,
    );

    const shown = this.isVisible ? this.candidates.filter((p) => this.visible.has(p)) : this.candidates;
    const geometry = new THREE.BufferGeometry().setFromPoints(shown.map((p) => new THREE.Vector3(...p)));
    const dots = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: CANDIDATE_COLOR, size: 6, sizeAttenuation: false, depthTest: false }),
    );
    dots.renderOrder = 12;
    dots.raycast = () => {};
    this.overlay.add(dots);

    if (this.hover) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 16, 12),
        new THREE.MeshBasicMaterial({ color: HOVER_COLOR, depthTest: false }),
      );
      marker.position.set(...this.hover);
      marker.renderOrder = 13;
      marker.raycast = () => {};
      this.overlay.add(marker);
    }
  }
}
