import * as THREE from 'three';
import type { Piece, Vec3 } from '../core/piece';
import { candidatePoints, type Edge } from '../core/vertexCandidates';
import type { ModelScene } from '../scene';

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
 * Añade puntos guía (vértices de referencia sueltos) a las piezas elegidas. Solo se pueden poner en posiciones válidas:
 * subdivisiones de las aristas, una cuadrícula opcional en las caras y los cruces con otras piezas; con Alt, en
 * cualquier punto de una arista.
 */
export class VertexTool {
  faces = false;

  /** En cuántas partes se divide cada arista; es el mismo valor que «Puntos por arista» del panel (0: solo los vértices). */
  private count = 4;
  private candidates: Vec3[] = [];
  private edges: Edge[] = [];
  private hover: Vec3 | null = null;
  private active = false;
  private overlay = new THREE.Group();
  /** Solo cuentan (y se dibujan) los candidatos que esta función da por visibles; null: todos. */
  private isVisible: ((p: Vec3) => boolean) | null = null;
  private visible = new Set<Vec3>();
  private visibleKey = '';
  /** Los puntos amarillos y la marca bajo el cursor son objetos aparte: mover el cursor solo rehace la marca. */
  private dotsKey = '';
  private marker: THREE.Mesh | null = null;
  /** Estado del modelo con que se calcularon los candidatos: si cambia (deshacer, rehacer, un punto nuevo), se calculan de nuevo. */
  private modelState = '';

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
    return this.count >= 2 ? this.count : 1;
  }

  /** Comprueba que hay piezas elegidas antes de entrar en la herramienta. */
  canStart(): boolean {
    const targets = this.getTargets();
    if (targets.length === 0) {
      this.setStatus('Elige primero (S) la pieza a la que quieres añadir puntos guía');
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
    this.recompute();
  }

  deactivate(): void {
    this.active = false;
    this.hover = null;
    this.clearOverlay();
    this.setStatus('');
  }

  /** Cambia en cuántas partes se divide cada arista (0 u 1: solo los vértices). */
  setDivisions(count: number): void {
    if (count === this.count) return;
    this.count = count;
    this.recompute();
  }

  setFaces(on: boolean): void {
    this.faces = on;
    this.recompute();
  }

  /** Busca el punto candidato bajo el cursor; con `free`, el punto más cercano sobre cualquier arista. */
  hoverAt(cursor: ScreenPoint, ray: THREE.Ray, screenOf: (p: Vec3) => ScreenPoint | null, free: boolean, isVisible: ((p: Vec3) => boolean) | null = null, viewKey = ''): void {
    // Los candidatos salen de las piezas: tras deshacer, rehacer o un cambio en el modelo ya no valen.
    if (this.active && this.modelState !== this.stateOfModel()) this.recompute();
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
    const changed = best !== this.hover;
    this.hover = best;
    // Los puntos solo se dibujan de nuevo si cambió cuáles se ven; moverse entre ellos solo mueve la marca.
    if (this.dotsKey !== this.currentDotsKey()) this.refresh();
    else if (changed) this.drawHover();
  }

  clearHover(): void {
    this.hover = null;
    this.drawHover();
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
    this.modelState = this.stateOfModel();
    this.refresh();
    this.onPhaseChange();
  }

  private stateOfModel(): string {
    return `${this.model.serial}:${this.model.undoDepth}:${this.model.redoDepth}:${this.getTargets().map((piece) => piece.id).join(',')}`;
  }

  /** Qué puntos amarillos se dibujan: todos, o los que dan por visibles para esta cámara. */
  private currentDotsKey(): string {
    return `${this.isVisible ? `v${this.visibleKey}` : 'a'}|${this.candidates.length}`;
  }

  private clearOverlay(): void {
    for (const child of [...this.overlay.children]) {
      this.overlay.remove(child);
      if (child instanceof THREE.Points || child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.marker = null;
    this.dotsKey = '';
  }

  private refresh(): void {
    this.clearOverlay();
    if (!this.active) return;
    this.setStatus(
      `Punto guía en ${this.getTargets().length} pieza(s): clic en un punto amarillo · Alt: libre sobre la arista · Esc: salir`,
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
    this.dotsKey = this.currentDotsKey();
    this.drawHover();
  }

  /** La marca azul sobre el punto bajo el cursor. */
  private drawHover(): void {
    if (this.marker) {
      this.overlay.remove(this.marker);
      this.marker.geometry.dispose();
      (this.marker.material as THREE.Material).dispose();
      this.marker = null;
    }
    if (!this.active || !this.hover) return;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 16, 12),
      new THREE.MeshBasicMaterial({ color: HOVER_COLOR, depthTest: false }),
    );
    marker.position.set(...this.hover);
    marker.renderOrder = 13;
    marker.raycast = () => {};
    this.overlay.add(marker);
    this.marker = marker;
  }
}
