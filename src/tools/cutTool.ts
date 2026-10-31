import * as THREE from 'three';
import { guideVertices, type Guides } from '../core/guides';
import { intersectionPoints } from '../core/intersections';
import { candidatePoints } from '../core/vertexCandidates';
import { crossesPlane, cutPieces, flipPlane, planeOfPolygon, projectToPlane, regionTouchesPiece, triangulateRegion } from '../core/cut';
import { clipPiece, planeFromPoints, type Piece, type Plane, type Vec3 } from '../core/piece';
import { reflections, type Symmetry } from '../core/symmetry';
import { createPieceObject, disposeObject } from '../render/meshes';
import type { ModelScene } from '../scene';
import type { Selection } from '../selection';

const SNAP_XZ = 0.5;
const SNAP_Y = 1 / 4;
const VERTEX_RADIUS = 0.2;
/** Cierra la región si el punto repite el primero; en pantalla, main lo ajusta al primero cuando el cursor está cerca. */
const CLOSE_EPS = 1e-6;
const INTERSECTION_MARGIN = 0.5;
const REMOVED_COLOR = 0xff4040;
const ACCENT = 0xffb020;

/** Opciones del ajuste de puntos. */
export interface SnapOptions {
  /** Libre sobre la arista más cercana (Alt), en vez de solo vértices, puntos medios y centros de cara. */
  edge?: boolean;
  /** Recibe las aristas prolongadas y los vértices virtuales de la zona, para dibujarlos. */
  onGuides?: (guides: Guides) => void;
  /** En cuántas partes se divide cada arista y el lado de cada cara para ofrecer más puntos (0 o 1: sin subdivisiones). */
  divisions?: number;
  /** Si se da, solo cuentan los puntos para los que devuelve verdadero (los que no quedan tapados por una cara). */
  isVisible?: (point: Vec3) => boolean;
}

const EDGE_RADIUS = 0.15;
/** Hasta dónde (celdas) se ofrecen los puntos de la rejilla de marcado alrededor del cursor. */
const GRID_REACH = 0.9;

/**
 * Elige el candidato más cercano: un vértice, el punto medio de una arista, el centro de una cara, un punto de referencia
 * o un punto donde las aristas de una pieza cruzan la cara de otra (el vértice que tendría la unión). Con `edge`, también
 * el punto más cercano sobre una arista. También los vértices virtuales: donde se cruzan las aristas prolongadas de las piezas
 * apoyadas en un mismo plano (un cubo pequeño sobre la pared de otro). Si no hay ninguno cerca, ajusta a media celda en X/Z y media placa en Y.
 */
export function snapPoint(hit: THREE.Vector3, model: ModelScene, options: SnapOptions = {}): Vec3 {
  let best: Vec3 | null = null;
  let bestDist = VERTEX_RADIUS;
  const near: Piece[] = [];
  const consider = (p: Vec3, limit = Infinity) => {
    const dist = Math.hypot(p[0] - hit.x, p[1] - hit.y, p[2] - hit.z);
    // La comprobación de visibilidad cuesta un rayo: solo se hace a los que mejorarían el resultado.
    if (dist < bestDist && dist < limit && (!options.isVisible || options.isVisible(p))) {
      bestDist = dist;
      best = p;
    }
  };
  // Los puntos de referencia cuentan como vértices.
  for (const v of model.points()) consider(v);
  for (const piece of model.all()) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const face of piece.faces) {
      for (const v of face) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], v[i]);
          max[i] = Math.max(max[i], v[i]);
        }
        consider(v);
      }
    }
    const c = [hit.x, hit.y, hit.z];
    if (c.every((value, i) => value >= min[i] - INTERSECTION_MARGIN && value <= max[i] + INTERSECTION_MARGIN)) near.push(piece);
  }
  // Puntos medios y centros solo en las piezas cercanas, para no recorrer toda la escena.
  for (const piece of near) {
    for (const face of piece.faces) {
      const center: Vec3 = [0, 0, 0];
      for (let i = 0; i < face.length; i++) {
        const p = face[i];
        const q = face[(i + 1) % face.length];
        consider([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
        for (let k = 0; k < 3; k++) center[k] += p[k] / face.length;
        if (options.edge) consider(closestOnSegment(hit, p, q), EDGE_RADIUS);
      }
      consider(center);
    }
  }
  // Gana el candidato más cercano al cursor.
  if (near.length >= 2) for (const p of intersectionPoints(near)) consider(p);
  const guides = guideVertices([hit.x, hit.y, hit.z], model.all());
  // Más puntos por cara: subdivisiones de las aristas y cuadrícula dentro de las caras de las piezas cercanas.
  if ((options.divisions ?? 0) >= 2 && near.length > 0) {
    const reach = GRID_REACH;
    guides.grid = candidatePoints(near, near, { divisions: options.divisions!, faces: true })
      .points.filter((p) => Math.hypot(p[0] - hit.x, p[1] - hit.y, p[2] - hit.z) < reach);
    for (const p of guides.grid) consider(p);
  }
  options.onGuides?.(guides);
  for (const p of guides.points) consider(p);
  if (best) {
    const b: Vec3 = best;
    return [b[0], b[1], b[2]];
  }
  return [
    Math.round(hit.x / SNAP_XZ) * SNAP_XZ,
    Math.round(hit.y / SNAP_Y) * SNAP_Y,
    Math.round(hit.z / SNAP_XZ) * SNAP_XZ,
  ];
}

/** Punto del segmento p→q más cercano a `point`. */
export function closestOnSegment(point: { x: number; y: number; z: number }, p: Vec3, q: Vec3): Vec3 {
  const d: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (len2 === 0) return [p[0], p[1], p[2]];
  const t = Math.max(0, Math.min(1, ((point.x - p[0]) * d[0] + (point.y - p[1]) * d[1] + (point.z - p[2]) * d[2]) / len2));
  return [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
}

export class CutTool {
  keepBoth = false;

  private points: Vec3[] = [];
  private closed = false;
  private hover: Vec3 | null = null;
  private flipped = false;
  private overlay = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    private model: ModelScene,
    private selection: Selection,
    private setStatus: (message: string) => void,
    private getSymmetry: () => Symmetry = () => ({ x: false, y: false, z: false, center: [0, 0, 0] }),
  ) {
    scene.add(this.overlay);
  }

  /** Se llama al cambiar de fase (dibujando / región cerrada) para que el panel muestre los botones que tocan. */
  onPhaseChange: () => void = () => {};

  /** Pasos quitados con `undoPoint` que se pueden reponer. */
  private redoStack: (Vec3 | 'close')[] = [];

  get hasPoints(): boolean {
    return this.points.length > 0;
  }

  /** Retrocede un paso: primero reabre la región cerrada y después quita el último punto. */
  undoPoint(): void {
    if (this.closed) {
      this.closed = false;
      this.redoStack.push('close');
    } else {
      const last = this.points.pop();
      if (last) this.redoStack.push(last);
    }
    this.flipped = false;
    this.refresh();
  }

  get hasRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Repone lo último que quitó `undoPoint`: un punto o el cierre de la región. */
  redoPoint(): void {
    const step = this.redoStack.pop();
    if (step === 'close') this.closed = this.points.length >= 3;
    else if (step) this.points.push(step);
    this.flipped = false;
    this.refresh();
  }

  /** Primer punto de la región, para cerrarla. */
  get firstPoint(): Vec3 | null {
    return this.points[0] ?? null;
  }

  get pointCount(): number {
    return this.points.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  activate(): void {
    this.reset();
    this.refresh();
  }

  deactivate(): void {
    this.reset();
    this.clearOverlay();
    this.setStatus('');
  }

  setHover(point: Vec3 | null): void {
    this.hover = point;
    this.refresh();
  }

  /** Usa una cara existente como región y plano de corte: solo se cortan las piezas apoyadas en ella. */
  useFace(face: Vec3[]): void {
    this.redoStack = [];
    this.points = face.map((p) => [p[0], p[1], p[2]] as Vec3);
    this.flipped = false;
    this.closed = true;
    this.refresh();
  }

  /** Cada clic añade un vértice de la región; un clic sobre el primero la cierra. */
  addPoint(point: Vec3): void {
    if (this.closed) this.reset();
    if (this.points.length >= 3 && dist(point, this.points[0]) < CLOSE_EPS) {
      this.close();
      return;
    }
    if (this.points.length >= 1 && sameVec(this.points[this.points.length - 1], point)) return;
    if (this.points.length === 2 && isDegenerate(this.points[0], this.points[1], point)) {
      this.setStatus('Los 3 puntos están en línea recta; elige otro punto');
      return;
    }
    // Desde el cuarto punto la región tiene que ser plana: el punto se proyecta sobre el plano de los tres primeros.
    const next = this.points.length >= 3 ? projectToPlane(point, planeFromPoints(this.points[0], this.points[1], this.points[2])) : point;
    this.points.push(next);
    this.redoStack = [];
    this.flipped = false;
    this.refresh();
    // Un vértice que no estaba en el plano de los tres primeros se mueve a él: se avisa para que no parezca que se marcó mal.
    const moved = dist(point, next);
    if (moved > 0.01) this.setStatus(`Ese punto no estaba en el plano de los tres primeros: se movió ${Math.round(moved * 100) / 100} celdas hasta el plano`);
  }

  flip(): void {
    if (!this.closed) return;
    this.flipped = !this.flipped;
    this.refresh();
  }

  cancel(): void {
    this.reset();
    this.refresh();
  }

  /** Enter: con la forma abierta la cierra; con la forma cerrada corta. */
  apply(): void {
    if (!this.closed) {
      this.close();
      return;
    }
    const plane = this.plane();
    if (!plane) return;
    const scoped = this.selection.size > 0;
    const originals = this.targets();
    // Con simetría activa se aplica también el corte reflejado, uno tras otro sobre el resultado anterior.
    let working = originals;
    for (const image of this.images(plane)) {
      const partial = cutPieces(working, image.plane, this.keepBoth, image.region);
      const gone = new Set(partial.removed);
      working = [...working.filter((piece) => !gone.has(piece)), ...partial.added];
    }
    const before = new Set(originals);
    const after = new Set(working);
    const change = { removed: originals.filter((piece) => !after.has(piece)), added: working.filter((piece) => !before.has(piece)) };
    if (change.removed.length === 0) {
      this.setStatus(scoped ? 'La región no alcanza ninguna pieza seleccionada' : 'La región no alcanza ninguna pieza');
      return;
    }
    this.model.apply(change);
    // Tras cortar la selección, el resultado queda seleccionado para seguir trabajando con él.
    if (scoped) this.selection.set(change.added.map((piece) => piece.id));
    this.reset();
    this.refresh();
  }

  /** El corte dibujado más sus reflejos: plano y región. */
  private images(plane: Plane): { plane: Plane; region: Vec3[] }[] {
    const out = [{ plane, region: this.points }];
    for (const reflection of reflections(this.getSymmetry())) {
      const region = this.points.map(reflection.point);
      const n = reflection.dir(plane.n);
      out.push({ plane: { n, d: n[0] * region[0][0] + n[1] * region[0][1] + n[2] * region[0][2] }, region });
    }
    return out;
  }

  private close(): void {
    if (this.points.length < 3) {
      this.setStatus('Hacen falta al menos 3 puntos para cerrar la región');
      return;
    }
    this.closed = true;
    this.redoStack = [];
    this.flipped = false;
    this.refresh();
  }

  /** Con selección, el corte solo actúa sobre ella; sin selección, sobre todas las piezas. */
  private targets(): Piece[] {
    const all = this.model.editable();
    return this.selection.size > 0 ? all.filter((piece) => this.selection.has(piece.id)) : all;
  }

  private reset(): void {
    this.points = [];
    this.redoStack = [];
    this.closed = false;
    this.flipped = false;
  }

  /** Plano de la región cerrada; se conserva el lado n·p <= d y se borra el otro. */
  private plane(): Plane | null {
    if (!this.closed) return null;
    const plane = planeOfPolygon(this.points);
    return this.flipped ? flipPlane(plane) : plane;
  }

  private scopeLabel(): string {
    return this.selection.size > 0 ? `la selección (${this.selection.size})` : 'todas las piezas';
  }

  private hint(): string {
    const n = this.points.length;
    if (this.closed) return 'Región cerrada: se borra lo rojo · F: cambiar de lado · Enter: cortar · Esc: cancelar';
    if (n === 0) return `Cortar ${this.scopeLabel()}: clic en los puntos de la región, o Ctrl+clic en una cara para cortar con su plano`;
    if (n < 3) return `Punto ${n}. Sigue marcando (mínimo 3 puntos)`;
    return `Punto ${n}. Clic en el primero (o Enter) para cerrar la región`;
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

    const drawing = !this.closed && this.hover ? [...this.points, this.hover] : this.points;
    this.points.forEach((p, i) => this.overlay.add(marker(p, false, i === 0 && this.points.length >= 3 && !this.closed)));
    if (!this.closed && this.hover) this.overlay.add(marker(this.hover, true, false));
    if (drawing.length >= 2) this.overlay.add(polyline(this.closed ? [...this.points, this.points[0]] : drawing));

    const plane = this.plane();
    if (!plane) return;
    this.overlay.add(regionFill(this.points, plane));
    for (const image of this.images(plane)) {
      const opposite = flipPlane(image.plane);
      for (const piece of this.targets()) {
        if (!crossesPlane(piece, image.plane) || !regionTouchesPiece(piece, image.plane, image.region)) continue;
        const removed = clipPiece(piece, opposite);
        if (removed) this.overlay.add(createPieceObject({ ...removed, color: REMOVED_COLOR, faceColors: undefined }, true));
      }
    }
  }
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function sameVec(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9;
}

function isDegenerate(a: Vec3, b: Vec3, c: Vec3): boolean {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return Math.hypot(cross[0], cross[1], cross[2]) < 1e-6;
}

function overlayMaterial<T extends THREE.Material>(material: T): T {
  material.depthTest = false;
  return material;
}

function marker(p: Vec3, preview: boolean, closeTarget: boolean): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(closeTarget ? 0.11 : 0.06, 16, 12),
    overlayMaterial(new THREE.MeshBasicMaterial({ color: closeTarget ? 0x40e0a0 : ACCENT, transparent: true, opacity: preview ? 0.55 : 1 })),
  );
  mesh.position.set(p[0], p[1], p[2]);
  mesh.renderOrder = 10;
  return mesh;
}

function polyline(points: Vec3[]): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))),
    overlayMaterial(new THREE.LineBasicMaterial({ color: ACCENT })),
  );
  line.renderOrder = 10;
  return line;
}

/** Relleno translúcido de la región cerrada, sobre su plano. */
function regionFill(points: Vec3[], plane: Plane): THREE.Mesh {
  const vertices = triangulateRegion(points, plane).flat().map((p) => new THREE.Vector3(...p));
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry().setFromPoints(vertices),
    overlayMaterial(new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.3, side: THREE.DoubleSide })),
  );
  mesh.renderOrder = 9;
  return mesh;
}
