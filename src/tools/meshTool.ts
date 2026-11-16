import * as THREE from 'three';
import { PLANE_XY, PLANE_XZ, PLANE_YZ, axisAllowed, lockLabel, type AxisLock } from '../core/axisLock';
import { faceNormal, type Piece, type Vec3 } from '../core/piece';
import { MIRROR_TOLERANCE, pieceKey, reflectPiece, reflections, symmetrize, type Reflection, type Symmetry } from '../core/symmetry';
import { triangulateFace } from '../core/convex';
import { collapses } from '../core/selfIntersect';
import { ringCut, bevelEdge, triangulateFaces, edgeLoop, pieceEdges, fillHoles, connectVertices, dissolveEdge, slideSegment, straightenVertices, flattenVertices, flattenWarped, warpedFaces, finFaces, flagFins, splitFacesAtCenter, addFace, deleteFaces, deleteVertices, extrudeEdge, extrudeFaces, tipVertices, facesWithin, flipFaces, mergeVertices, weldVertices, placeVertices, rotateAbout, scaleAbout, setFaceFlags, splitEdge, addMirrorPairOnFace, addVertexOnFace, taperPoint, twistPoint, bendPoint, uniqueVertices, vertexKey } from '../core/vertices';
import type { ModelScene } from '../scene';

/** Paso de la rejilla de imán, en celdas. */
export const SNAP_STEP = 0.25;
/** Distancia máxima entre dos comprobaciones al recorrer un movimiento (menor que el grosor mínimo del cuerpo), y tope de comprobaciones. */
const PATH_STEP = 0.03;
const PATH_MAX = 200;
/** Lo máximo que cambia el valor de girar, escalar o deformar entre dos comprobaciones de un mismo movimiento, y en cuántos tramos se recorre. */
const MODAL_REACH = 0.5;
const MODAL_STEPS = 48;
/** Cuánto sube una cara al extruirla (después se afina arrastrando o con las flechas). */
const EXTRUDE_DISTANCE = 0.5;
/** Distancia en pantalla (px) a la que el cursor "agarra" una arista para ponerle un vértice. */
const EDGE_RADIUS = 8;
/** Con Ctrl se empuja con pasos más finos. */
/** Distancia en pantalla (px) a la que el cursor "agarra" un vértice. */
const PICK_RADIUS = 12;
/** Tiempo máximo entre dos clics para que cuenten como doble clic. */
const DOUBLE_CLICK_MS = 400;
/** Con más vértices que estos no se dibujan todos (solo los de la selección). */
const MAX_VISIBLE = 4000;
/** Con imán, el giro avanza de 15° en 15° y la escala de 0,05 en 0,05. */
const ROTATE_STEP = Math.PI / 12;
const SCALE_STEP = 0.05;
/** Píxeles de movimiento horizontal que valen 1 al afinar o torcer. */
const DEFORM_PIXELS = 150;
/** Empujar cara: por debajo de estos píxeles por celda la normal casi apunta a la cámara y se usa el movimiento vertical (con esta escala). */
const PUSH_MIN_PIXELS = 12;
const PUSH_FALLBACK_PIXELS = 120;

export type TransformKind = 'rotate' | 'scale' | 'taper' | 'twist' | 'bend' | 'push';
/** Lo que hay que mover el cursor antes de que un clic pase a ser un arrastre. */
const DRAG_THRESHOLD = 3;
/** Distancia por defecto de «Soldar cercanos»: 2 mm con la celda en 1 (los pares casi encima de otro suelen estar a menos de 1 mm). */
export const WELD_DISTANCE = 0.002;

const NORMAL_COLOR = 0xe6e8ee;
/** Vértice sin gemelo al otro lado del espejo mientras la simetría está activa. */
const UNPAIRED_COLOR = 0xff4fd8;
const SELECTED_COLOR = 0xffd34d;
const HOVER_COLOR = 0x40e0ff;
/** Qué dice cada tecla de acción de Malla cuando no hay vértices elegidos. */
const NEEDS_SELECTION: Record<string, string> = {
  u: 'Trazar segmento (U): elige dos vértices de una misma cara',
  q: 'Quitar segmento (Q): elige los dos vértices de un segmento',
  l: 'Alinear en línea (L): elige tres o más vértices; el primero y el último marcan la línea',
  p: 'Aplanar en plano (P): elige tres o más vértices',
  f: 'Crear cara (F): no hay ningún vértice elegido; elige tres o más con Shift+clic (un clic sin Shift en vacío suelta la elección)',
  b: 'Borrar cara (B): elige todos los vértices de la cara',
  n: 'Empujar cara (N): elige todos los vértices de una o más caras',
  k: 'Tapar hueco (K): elige un vértice del borde abierto que quieres cerrar',
  i: 'Punta (I): elige los vértices de los que quieres sacar una copia para jalarla',
  r: 'Girar (R): elige los vértices que quieres girar',
  t: 'Escalar (T): elige los vértices que quieres escalar',
  delete: 'Borrar vértices (Supr): elige los vértices que quieres quitar',
  backspace: 'Borrar vértices (Supr): elige los vértices que quieres quitar',
};
/** Cuánto se acercan los vértices a la cámara al ocultar los de atrás (fracción de su distancia): al dibujarlos y al decidir si uno está tapado. */
const VERTEX_BIAS = 0.006;
/** Contorno de las caras torcidas. */
const WARN_COLOR = 0xff8a1f;

export interface MeshToolHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  domElement: HTMLElement;
  /** Órbita de la cámara: se apaga mientras se arrastra un vértice. */
  setOrbit: (enabled: boolean) => void;
  model: ModelScene;
  /** Piezas elegidas como objetos (no vértices): si hay alguna, solo se muestran sus vértices. */
  selectedPieces: () => Piece[];
  /** Una pieza oculta no ofrece vértices. */
  isHidden: (piece: Piece) => boolean;
  symmetry: () => Symmetry;
  status: (message: string) => void;
  /** Se llama cuando la herramienta se queda con un evento del puntero (no llega al resto de la aplicación): el anfitrión olvida su «pulsar» pendiente. */
  consumed?: () => void;
  /** Se llama cuando cambia la selección de vértices (para refrescar el panel). */
  onSelectionChange: () => void;
}

/** Vértices elegidos por pieza, con las claves de posición. */
type VertexSelection = Map<number, Set<string>>;

/** Una pieza que se mueve en el arrastre: su estado inicial, qué vértices lleva y cómo se transforma el desplazamiento. */
/** Un grupo de vértices de una pieza que se mueven juntos: los elegidos, o las imágenes en espejo de una reflexión. */
interface Part {
  keys: Set<string>;
  /** Todos los vértices del grupo, también los que ya cuenta otro grupo de la misma pieza (`keys` solo trae los que no se repiten). */
  full: Set<string>;
  /** Dirección del desplazamiento para estos vértices: la identidad, o el reflejo si son la imagen en espejo de los elegidos. */
  dir: (v: Vec3) => Vec3;
  /** Reflejo de un punto, si son la imagen en espejo de los elegidos; sin él, la identidad. */
  mirror?: (p: Vec3) => Vec3;
}

/**
 * Una pieza con los vértices que cambian. Aparece una sola vez aunque varios grupos la toquen (una pieza que cruza el plano de simetría
 * es imagen de sí misma): si hubiera dos entradas con la misma pieza, la segunda pisaría a la primera y los vértices se quedarían sin mover.
 */
interface Target {
  original: Piece;
  /** Todos los vértices que cambian (la unión de los de cada grupo). */
  keys: Set<string>;
  parts: Part[];
}

/** El grupo al que pertenece un vértice de la pieza (los grupos no comparten vértices). */
const partOf = (target: Target, p: Vec3): Part => target.parts.find((part) => part.keys.has(vertexKey(p))) ?? target.parts[0];
/** Los vértices que eligió la persona, sin las imágenes en espejo. */
const chosenKeys = (target: Target): Set<string> => target.parts.find((part) => !part.mirror)?.keys ?? new Set();
/**
 * Los vértices propios de las partes sin espejo (lo que eligió la persona). Lo que una operación deja elegido tiene que salir de aquí:
 * si se dejaran también las imágenes en espejo, el siguiente arrastre no crearía parte espejo y los dos lados irían en la misma dirección.
 */
const ownKeys = (parts: Part[]): Set<string> => new Set(parts.filter((part) => !part.mirror).flatMap((part) => [...part.keys]));
/** Las partes que no son imagen en espejo de otra. */
const ownParts = (parts: Part[]): Part[] => parts.filter((part) => !part.mirror);

const sameId = (made: Piece, old: Piece): Piece => ({ ...made, id: old.id });
/**
 * Las caras cuyos vértices están todos elegidos, grupo por grupo (los elegidos por un lado, cada imagen en espejo por otro).
 * Mezclar los grupos haría pasar por elegida una cara que cruza el espejo con solo un borde elegido (sus dos vértices más sus dos imágenes).
 */
const facesOfParts = (piece: Piece, parts: Part[]): number[] => [...new Set(parts.flatMap((part) => facesWithin(piece, part.full)))];
/** Los grupos de vértices de una pieza, juntando los que comparten alguno (un vértice sobre el plano del espejo es de los dos lados). */
function vertexGroups(parts: Part[]): Set<string>[] {
  const groups: Set<string>[] = [];
  for (const part of parts) {
    let group = new Set(part.full);
    for (let i = groups.length - 1; i >= 0; i--) {
      if ([...groups[i]].some((key) => group.has(key))) {
        group = new Set([...group, ...groups[i]]);
        groups.splice(i, 1);
      }
    }
    groups.push(group);
  }
  return groups;
}
/** Lo que devuelve una operación de `change` cuando la pieza se queda sin caras y desaparece (distinto de `null`: no hacer nada). */
const REMOVE = Symbol('remove');

const FIN_MESSAGE = 'Ese punto solo toca dos caras: queda como una aleta plana (sin volumen) y se ve por los dos lados. Añade el punto en una cara para tener volumen';
const cloneSelection = (selection: VertexSelection): VertexSelection => new Map([...selection].map(([id, keys]) => [id, new Set(keys)]));
/** Los vértices no se mueven: la selección se queda donde está. */
const keepPosition = (p: Vec3): Vec3 => p;

/** Colores de los ejes X, Y y Z (los de Blender), también en la brújula del visor. */
export const AXIS_COLORS = [0xff4d4d, 0x6fdc4a, 0x4d8dff];
/** Cuánto sobresalen las líneas guía a cada lado del vértice agarrado, en celdas. */
const GUIDE_REACH = 3;

/** Un vértice a menos de esto del plano de simetría cuenta como estando en él. */
const PLANE_SNAP = 0.02;

const distance3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Distancia del punto al plano de la cara (por sus tres primeros vértices no alineados). */
function planeDistance(face: Vec3[], point: Vec3): number {
  const [a, b] = face;
  for (let k = 2; k < face.length; k++) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [face[k][0] - a[0], face[k][1] - a[1], face[k][2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length < 1e-9) continue;
    return Math.abs((n[0] * (point[0] - a[0]) + n[1] * (point[1] - a[1]) + n[2] * (point[2] - a[2])) / length);
  }
  return Infinity;
}

/** La arista de la pieza que pasa a menos de 0,02 del punto (sin ser uno de sus extremos), con la posición del punto a lo largo de ella. */
function edgeThrough(piece: Piece, point: Vec3): { a: Vec3; b: Vec3; t: number } | null {
  let best: { a: Vec3; b: Vec3; t: number } | null = null;
  let bestDistance = 0.02;
  for (const face of piece.faces) {
    for (let i = 0; i < face.length; i++) {
      const p = face[i];
      const q = face[(i + 1) % face.length];
      const d: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const length2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      if (length2 < 1e-12) continue;
      const t = ((point[0] - p[0]) * d[0] + (point[1] - p[1]) * d[1] + (point[2] - p[2]) * d[2]) / length2;
      if (t < 0.02 || t > 0.98) continue;
      const distance = distance3([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t], point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { a: p, b: q, t };
      }
    }
  }
  return best;
}

export class MeshTool {
  private selection: VertexSelection = new Map();
  private overlay = new THREE.Group();
  private points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false, depthWrite: false, transparent: true }));
  /** Tres líneas (X rojo, Y verde, Z azul) que cruzan el vértice agarrado mientras se arrastra; la del eje bloqueado se ve más fuerte. */
  private guide = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
  /** Contorno naranja de las caras torcidas. */
  private warnLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: WARN_COLOR, depthTest: false, transparent: true, opacity: 0.9 }));
  private warpCache = new WeakMap<Piece, number[]>();
  private warped = 0;
  /** `idPieza:clave` de los vértices mostrados que no tienen gemelo en el espejo (con simetría activa). */
  private unpaired = new Set<string>();
  /** Al soltar un arrastre, las caras que hayan quedado torcidas se aplanan solas (opcional). */
  flattenOnRelease = false;
  private shown: { piece: Piece; position: Vec3; key: string }[] = [];
  /** Las piezas de `shown`, una sola vez cada una (varias búsquedas recorren caras y no deben repetirlas por vértice). */
  private shownPieces: Piece[] = [];
  /** Vértices únicos con su clave por pieza: una pieza no cambia (se sustituye por otra), así que se calculan una sola vez. */
  private vertexCache = new WeakMap<Piece, { position: Vec3; key: string }[]>();
  /** Triángulos de cada pieza (nueve números por triángulo), para saber si una cara tapa un vértice sin volver a triangular en cada movimiento. */
  private triangleCache = new WeakMap<Piece, Float64Array>();
  /** Lo último con que se buscaron los vértices sin gemelo: si no cambió ninguna pieza ni la simetría, no se vuelve a buscar. */
  private unpairedFor: { pieces: Piece[]; symmetry: string } | null = null;
  private unpairedAll = new Set<string>();
  private hover: { piece: Piece; key: string } | null = null;
  private active = false;
  private marqueeEl: HTMLDivElement | null = null;
  private marquee: { x: number; y: number; add: boolean } | null = null;

  /** Si cada pieza ya se atravesaba antes de empezar a mover (entonces no se frena por eso). */
  private collapsedBefore = new WeakMap<Piece, boolean>();
  private drag: {
    targets: Target[];
    anchor: Vec3;
    plane: THREE.Plane;
    grab: THREE.Vector3;
    startX: number;
    startY: number;
    moved: boolean;
    delta: Vec3;
    /** Con «Deslizar vértice», el segmento por el que se mueve el vértice agarrado: dirección y cuánto puede avanzar hacia cada lado. */
    slide?: { dir: Vec3; min: number; max: number };
  } | null = null;
  /** Deslizar: el vértice agarrado solo se mueve a lo largo del segmento en que está (sin deformar la pieza), entre sus dos vecinos. */
  private sliding = false;
  /** Eje al que se limita el movimiento (0 X, 1 Y, 2 Z); se mantiene entre arrastres hasta que se cambia. */
  private axisLock: AxisLock = null;

  /**
   * Qué vértices estaban elegidos antes y después de cada cambio, para devolverlos al deshacer y rehacer
   * (cada entrada va con el número de cambios del modelo que había tras el cambio).
   */
  private history: { depth: number; before: VertexSelection; after: VertexSelection }[] = [];
  private pendingBefore: VertexSelection | null = null;
  /** Imán: con él, los vértices arrastrados caen en la rejilla de ¼ y girar/escalar van a saltos. Apagado (por defecto) se mueven suaves; Ctrl invierte. */
  magnet = false;

  /** En cuántas partes se divide una arista al añadir un vértice (2 = por la mitad, 4 = cuartos…); 0 es libre, donde se pulse. */
  edgeDivisions = 4;

  /** Cuánto crecen «Cara desde segmento» y «Extruir cara» (en unidades del modelo); se cambia desde el panel. */
  growDistance = EXTRUDE_DISTANCE;
  /** Cuánto se corta la esquina al biselar una arista (en celdas, sobre los segmentos vecinos). */
  bevelSize = 0.25;
  /** Distancia bajo la que «Soldar cercanos» junta dos vértices (en celdas); se cambia desde el panel. */
  weldDistance = WELD_DISTANCE;
  /** Con el modo «Añadir vértice», un clic sobre una arista o una cara le pone un vértice nuevo (sin Alt). */
  private adding = false;
  /** Con el modo «Quitar vértice», un clic sobre un vértice lo quita (con su espejo si hay simetría). */
  private removing = false;
  /** Ver (y poder elegir) también los vértices que quedan detrás de una cara. Apagado, solo los que se ven desde la cámara. */
  private seeBehind = true;
  /** Dónde se pulsó en modo añadir: si el ratón no se movió al soltar, es un clic y se añade; si se movió, era girar la cámara. */
  private pendingAdd: { x: number; y: number; ctrl: boolean } | null = null;
  /** Clic anotado al pulsar en vacío: si se suelta sin arrastrar y hay un segmento a mano, se eligen sus vértices. */
  private pendingEdge: { x: number; y: number } | null = null;
  private lastEdgeClick: { time: number; a: string; b: string; id: number } | null = null;

  /** Giro o escala en curso: se maneja moviendo el ratón (sin pulsar) y se confirma con un clic o Intro. */
  private modal: {
    kind: TransformKind;
    targets: Target[];
    pivot: Vec3;
    /** Mitad del largo de los vértices elegidos a lo largo de cada eje (para afinar y torcer). */
    half: Vec3;
    axis: number | null;
    /** Dirección en la que se empuja (solo «push»): la normal media de las caras elegidas. */
    normal?: Vec3;
    /** Posición del cursor al empezar (se fija con el primer movimiento) y lo que valía entonces. */
    start: { x: number; y: number; angle: number; distance: number } | null;
    last: { x: number; y: number; free: boolean } | null;
    value: number;
    /** Último valor con el que el cuerpo no se aplastaba ni se atravesaba. */
    valid: number;
    moved: boolean;
  } | null = null;

  constructor(private readonly host: MeshToolHost) {
    // Los vértices están justo sobre la superficie: se acercan a la cámara un 0,6 % de su distancia, sobre el mismo rayo (no se mueven en pantalla),
    // para que no los tape su propia cara al ocultar los de atrás. Se mide en distancia y no en profundidad de pantalla: a lo lejos esa profundidad
    // está tan comprimida que el desplazamiento antes sacaba a la vista vértices de la cara de atrás.
    (this.points.material as THREE.PointsMaterial).onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n  mvPosition.xyz *= ${(1 - VERTEX_BIAS).toFixed(4)};\n  gl_Position = projectionMatrix * mvPosition;`);
    };
    this.points.renderOrder = 999;
    this.points.frustumCulled = false;
    this.overlay.add(this.points);
    this.guide.renderOrder = 998;
    this.guide.frustumCulled = false;
    this.guide.visible = false;
    this.overlay.add(this.guide);
    this.warnLines.renderOrder = 997;
    this.warnLines.frustumCulled = false;
    this.warnLines.visible = false;
    this.overlay.add(this.warnLines);
    this.overlay.visible = false;
    host.scene.add(this.overlay);
    const el = host.domElement;
    el.addEventListener('pointerdown', (e) => this.down(e), { capture: true });
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e), { capture: true });
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('pointerleave', () => {
      if (!this.drag && this.hover) {
        this.hover = null;
        this.paint();
      }
    });
  }

  /** Hay un arrastre, un giro/escala o un recuadro en marcha: mientras dure, deshacer, rehacer, borrar y las acciones del panel se ignoran. */
  get busy(): boolean {
    return this.drag !== null || this.marquee !== null || this.modal !== null;
  }

  /** Cuántos vértices hay elegidos en la pieza que más tiene (las acciones que unen vértices necesitan que sean de una misma pieza). */
  get mostInOnePiece(): number {
    let most = 0;
    for (const keys of this.selection.values()) most = Math.max(most, keys.size);
    return most;
  }

  get count(): number {
    let total = 0;
    for (const keys of this.selection.values()) total += keys.size;
    return total;
  }

  get slideMode(): boolean {
    return this.sliding;
  }

  setSlideMode(on: boolean): void {
    this.sliding = on;
    this.host.status(on ? 'Deslizar: arrastra un vértice puesto en un segmento y se mueve solo por él, sin deformar la pieza' : 'Deslizar desactivado: el vértice se mueve libre');
    this.host.onSelectionChange();
  }

  get addMode(): boolean {
    return this.adding;
  }

  setAddMode(on: boolean): void {
    this.adding = on;
    if (on) this.removing = false;
    this.pendingAdd = null;
    this.host.status(on ? 'Añadir vértice: clic en una arista (según la cantidad elegida; Ctrl donde pulses) o en una cara' : 'Añadir vértice desactivado');
    this.host.onSelectionChange();
  }

  get removeMode(): boolean {
    return this.removing;
  }

  setRemoveMode(on: boolean): void {
    this.removing = on;
    if (on) {
      this.adding = false;
      this.pendingAdd = null;
    }
    this.host.status(on ? 'Quitar vértice: clic en un vértice para quitarlo (la cara que lo usaba se queda con uno menos; un triángulo desaparece)' : 'Quitar vértice desactivado');
    this.host.onSelectionChange();
  }

  get seesBehind(): boolean {
    return this.seeBehind;
  }

  /** Con `on` se ven y se pueden elegir los vértices de detrás de las caras; sin él, solo los que se ven desde la cámara. */
  setSeeBehind(on: boolean, announce = true): void {
    this.seeBehind = on;
    (this.points.material as THREE.PointsMaterial).depthTest = !on;
    this.paint();
    if (announce) this.host.status(on ? 'Se ven todos los vértices, también los de detrás' : 'Solo se ven los vértices que dan a la cámara');
    this.host.onSelectionChange();
  }

  get axis(): AxisLock {
    return this.axisLock;
  }

  /** Limita el movimiento a un eje (o lo suelta con `null`); lo usan los botones del panel y las teclas X/Y/Z. */
  setAxis(axis: AxisLock): void {
    this.axisLock = axis;
    if (this.drag?.moved) this.showGuide([this.drag.anchor[0] + this.drag.delta[0], this.drag.anchor[1] + this.drag.delta[1], this.drag.anchor[2] + this.drag.delta[2]]);
    this.host.status(axis === null ? 'Movimiento libre' : `Movimiento solo en ${lockLabel(axis)}`);
    this.host.onSelectionChange();
  }

  activate(): void {
    this.history = [];
    this.active = true;
    this.overlay.visible = true;
    this.refresh();
  }

  deactivate(): void {
    this.cancel();
    this.axisLock = null;
    this.adding = false;
    this.removing = false;
    this.sliding = false;
    this.pendingAdd = null;
    this.pendingEdge = null;
    this.lastEdgeClick = null;
    this.active = false;
    this.overlay.visible = false;
    this.selection.clear();
    this.hover = null;
    if (this.host.domElement.style) this.host.domElement.style.cursor = 'default';
    this.host.onSelectionChange();
  }

  /** Anota la elección de antes y de ahora para el cambio que acaba de entrar en el historial del modelo. */
  private record(before: VertexSelection): void {
    const depth = this.host.model.undoDepth;
    this.history = this.history.filter((h) => h.depth < depth);
    this.history.push({ depth, before, after: cloneSelection(this.selection) });
  }

  /** Tras deshacer o rehacer un cambio de esta herramienta, los vértices elegidos vuelven a como estaban en ese momento. */
  historyMoved(kind: 'undo' | 'redo'): void {
    if (!this.active) return;
    const depth = this.host.model.undoDepth;
    const entry = this.history.find((h) => h.depth === (kind === 'undo' ? depth + 1 : depth));
    if (!entry) return;
    this.selection = cloneSelection(kind === 'undo' ? entry.before : entry.after);
    this.refresh();
  }

  /** Vuelve a dibujar los vértices (tras un cambio del modelo o de la selección de piezas). */
  refresh(): void {
    if (!this.active) return;
    // Se descartan las elecciones de piezas que ya no existen o de vértices que ya no están.
    for (const [id, keys] of [...this.selection]) {
      const piece = this.host.model.get(id);
      if (!piece) {
        this.selection.delete(id);
        continue;
      }
      const present = new Set(this.verticesOf(piece).map((v) => v.key));
      for (const key of [...keys]) if (!present.has(key)) keys.delete(key);
      if (keys.size === 0) this.selection.delete(id);
    }
    const chosen = this.host.selectedPieces();
    let pieces = (chosen.length > 0 ? chosen : this.host.model.editable()).filter((piece) => !this.host.isHidden(piece));
    pieces = pieces.filter((piece) => !this.host.model.isLocked(piece));
    // Una pieza que deja de mostrarse (oculta, bloqueada o ya no elegida) suelta su elección: si no, Supr borraría vértices que no se ven.
    const visible = new Set(pieces.map((piece) => piece.id));
    for (const id of [...this.selection.keys()]) if (!visible.has(id)) this.selection.delete(id);
    const shown: typeof this.shown = [];
    for (const piece of pieces) {
      for (const { position, key } of this.verticesOf(piece)) shown.push({ piece, position, key });
      if (shown.length > MAX_VISIBLE) break;
    }
    if (shown.length > MAX_VISIBLE) {
      this.host.status('Hay demasiados vértices para mostrarlos todos: elige una pieza con la herramienta Elegir');
      shown.length = 0;
      for (const piece of chosen) for (const { position, key } of this.verticesOf(piece)) shown.push({ piece, position, key });
    }
    this.shown = shown;
    this.shownPieces = [...new Set(shown.map(({ piece }) => piece))];
    // Mientras se arrastra o se gira/escala (cada movimiento del ratón avisa al modelo) solo se mueven los puntos: los avisos de caras torcidas,
    // los vértices sin gemelo y el panel se ponen al día al soltar, cuando la operación termina y vuelve a llamar aquí.
    if (this.drag !== null || this.modal !== null) {
      this.paint();
      return;
    }
    this.updateWarnings();
    this.updateUnpaired();
    this.paint();
    this.host.onSelectionChange();
  }

  /** Los vértices únicos de una pieza con su clave (se recuerdan por pieza). */
  private verticesOf(piece: Piece): { position: Vec3; key: string }[] {
    let found = this.vertexCache.get(piece);
    if (!found) {
      found = uniqueVertices(piece).map((position) => ({ position, key: vertexKey(position) }));
      this.vertexCache.set(piece, found);
    }
    return found;
  }

  /** Los triángulos de una pieza como números sueltos (se recuerdan por pieza). */
  private trianglesOf(piece: Piece): Float64Array {
    let found = this.triangleCache.get(piece);
    if (!found) {
      const out: number[] = [];
      for (const face of piece.faces) for (const [i, j, k] of triangulateFace(face)) out.push(...face[i], ...face[j], ...face[k]);
      found = Float64Array.from(out);
      this.triangleCache.set(piece, found);
    }
    return found;
  }

  /** Cuántas caras torcidas (de cuatro o más vértices fuera de su plano) hay en las piezas que se ven. */
  get warpedCount(): number {
    return this.warped;
  }

  /** Las caras torcidas de una pieza (se recuerdan por pieza: una pieza no cambia, se sustituye por otra). */
  private warpedOf(piece: Piece): number[] {
    let found = this.warpCache.get(piece);
    if (!found) {
      found = warpedFaces(piece);
      this.warpCache.set(piece, found);
    }
    return found;
  }

  /** Cuántos vértices de los que se ven no tienen gemelo al otro lado del espejo (0 sin simetría activa). */
  get unpairedCount(): number {
    return this.unpaired.size;
  }

  /** Busca los vértices sin gemelo en las piezas que se ven; con simetría apagada no hay ninguno. */
  private updateUnpaired(): void {
    const shown = new Set(this.shown.map(({ piece }) => piece.id));
    if (shown.size === 0) {
      this.unpaired = new Set();
      return;
    }
    // El gemelo puede estar en otra pieza que no se ve (se eligió una mitad): se empareja contra todas las editables y solo se pintan las que se ven.
    const editable = this.host.model.editable();
    const sym = this.host.symmetry();
    const signature = JSON.stringify([sym.x, sym.y, sym.z, sym.center]);
    const last = this.unpairedFor;
    // Buscar los gemelos repite hasta 12 pasadas sobre todas las piezas: solo se hace si cambió alguna pieza o la simetría.
    if (!last || last.symmetry !== signature || last.pieces.length !== editable.length || last.pieces.some((piece, i) => piece !== editable[i])) {
      this.unpairedAll = symmetrize(editable, sym).unpaired;
      this.unpairedFor = { pieces: editable, symmetry: signature };
    }
    this.unpaired = new Set([...this.unpairedAll].filter((entry) => shown.has(Number(entry.slice(0, entry.indexOf(':'))))));
  }

  /**
   * Deja exactamente simétricas las piezas elegidas (o todas las que se ven si no hay ninguna): cada vértice se promedia con el espejo
   * de su gemelo y los que están casi sobre un plano quedan sobre él. Un solo paso de deshacer.
   */
  symmetrizeAll(): void {
    if (this.busy) return;
    const sym = this.host.symmetry();
    if (reflections(sym).length === 0) {
      this.host.status('Simetrizar: activa antes la simetría en algún eje (X, Y o Z)');
      return;
    }
    const pieces = [...new Map(this.shown.map(({ piece }) => [piece.id, piece])).values()];
    const result = symmetrize(pieces, sym);
    const removed: Piece[] = [];
    const added: Piece[] = [];
    const before = cloneSelection(this.selection);
    const next: VertexSelection = new Map();
    for (const piece of pieces) {
      const moves = result.moves.get(piece.id);
      const kept = this.selection.get(piece.id);
      if (!moves) {
        if (kept) next.set(piece.id, kept);
        continue;
      }
      const made = placeVertices(piece, new Set(moves.keys()), (p) => moves.get(vertexKey(p)) ?? p);
      if (!made) {
        if (kept) next.set(piece.id, kept);
        continue;
      }
      // La pieza conserva su id: así sigue elegida, con sus pistas de animación y su estado de oculta.
      const fixed = sameId(made, piece);
      removed.push(piece);
      added.push(fixed);
      if (kept) next.set(piece.id, new Set([...kept].map((key) => (moves.has(key) ? vertexKey(moves.get(key)!) : key))));
    }
    if (added.length > 0) {
      const depthBefore = this.host.model.undoDepth;
      this.host.model.apply({ added, removed });
      this.selection = next;
      if (this.host.model.undoDepth > depthBefore) this.record(before);
    }
    this.refresh();
    const lonely = this.unpaired.size;
    const tail = lonely > 0 ? ` · ${lonely} vértice(s) sin gemelo (en rosa): o no tienen par al otro lado o están casi encima de otro vértice (Fusionar vértices los junta)` : '';
    this.host.status(result.fixed > 0 ? `Simetrizar: ${result.fixed} vértice(s) ajustados${tail}` : `Simetrizar: ya era simétrico${tail}`);
  }

  /** Dibuja en naranja el contorno de cada cara torcida y cuenta cuántas son. */
  private updateWarnings(): void {
    const positions: number[] = [];
    const seen = new Set<Piece>();
    let count = 0;
    for (const { piece } of this.shown) {
      if (seen.has(piece)) continue;
      seen.add(piece);
      for (const i of this.warpedOf(piece)) {
        count++;
        const face = piece.faces[i];
        face.forEach((p, k) => {
          const q = face[(k + 1) % face.length];
          positions.push(p[0], p[1], p[2], q[0], q[1], q[2]);
        });
      }
    }
    this.warped = count;
    this.warnLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.warnLines.visible = count > 0;
  }

  private showGuide(at: Vec3): void {
    const reach = GUIDE_REACH;
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    for (let axis = 0; axis < 3; axis++) {
      const to: Vec3 = [at[0], at[1], at[2]];
      const from: Vec3 = [at[0], at[1], at[2]];
      to[axis] += reach;
      from[axis] -= reach;
      positions.push(...from, ...to);
      color.set(AXIS_COLORS[axis]).multiplyScalar(this.axisLock === null ? 0.8 : axisAllowed(this.axisLock, axis) ? 1 : 0.3);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    this.guide.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.guide.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.guide.visible = true;
  }

  private paint(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    for (const { piece, position, key } of this.shown) {
      positions.push(position[0], position[1], position[2]);
      const selected = this.selection.get(piece.id)?.has(key) ?? false;
      const hovered = this.hover?.piece.id === piece.id && this.hover.key === key;
      color.set(hovered ? HOVER_COLOR : selected ? SELECTED_COLOR : this.unpaired.has(`${piece.id}:${key}`) ? UNPAIRED_COLOR : NORMAL_COLOR);
      colors.push(color.r, color.g, color.b);
    }
    const geometry = this.points.geometry;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
  }

  private rect(): DOMRect {
    return this.host.domElement.getBoundingClientRect();
  }

  private screenOf(p: Vec3): { x: number; y: number; behind: boolean } {
    const rect = this.rect();
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.host.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, behind: v.z > 1 };
  }

  private vertexAt(x: number, y: number): { piece: Piece; key: string; position: Vec3 } | null {
    const candidates: { entry: { piece: Piece; key: string; position: Vec3 }; d: number }[] = [];
    for (const entry of this.shown) {
      const s = this.screenOf(entry.position);
      if (s.behind) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < PICK_RADIUS) candidates.push({ entry, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    // Sin «ver los de atrás», un vértice tapado por una cara no se puede agarrar.
    return candidates.find(({ entry }) => this.seeBehind || !this.occluded(entry.position))?.entry ?? null;
  }

  /** ¿Hay una cara entre la cámara y este punto? (No cuenta la cara en la que el punto está.) */
  private occluded(position: Vec3): boolean {
    const origin = this.host.camera.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(...position);
    const distance = origin.distanceTo(target);
    const ray = new THREE.Ray(origin, target.clone().sub(origin).normalize());
    // El mismo margen con el que se dibujan los vértices (se acercan a la cámara un 0,6 % de su distancia): lo que se ve se puede elegir y viceversa.
    const margin = distance * VERTEX_BIAS;
    const point = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const piece of this.shownPieces) {
      const t = this.trianglesOf(piece);
      for (let n = 0; n < t.length; n += 9) {
        a.set(t[n], t[n + 1], t[n + 2]);
        b.set(t[n + 3], t[n + 4], t[n + 5]);
        c.set(t[n + 6], t[n + 7], t[n + 8]);
        if (ray.intersectTriangle(a, b, c, false, point) && point.distanceTo(origin) < distance - margin) return true;
      }
    }
    return false;
  }

  private isSelected(piece: Piece, key: string): boolean {
    return this.selection.get(piece.id)?.has(key) ?? false;
  }

  private select(piece: Piece, key: string, additive: boolean): void {
    if (!additive) this.selection.clear();
    const keys = this.selection.get(piece.id) ?? new Set<string>();
    keys.add(key);
    this.selection.set(piece.id, keys);
  }

  /** Todos los vértices mostrados. */
  selectAll(): void {
    this.selection.clear();
    for (const { piece, key } of this.shown) {
      const keys = this.selection.get(piece.id) ?? new Set<string>();
      keys.add(key);
      this.selection.set(piece.id, keys);
    }
    this.paint();
    this.host.onSelectionChange();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.paint();
    this.host.onSelectionChange();
  }

  // ——— Ratón ———

  /** Se queda con el evento: no sigue hacia la cámara ni hacia el resto de la aplicación. */
  private consume(e: Event): void {
    e.stopImmediatePropagation();
    this.host.consumed?.();
  }

  private down(e: PointerEvent): void {
    if (this.active && this.modal) {
      // Mientras se gira o escala, el clic izquierdo confirma y el derecho cancela.
      this.consume(e);
      e.preventDefault();
      if (e.button === 0) this.finishModal(true);
      else if (e.button === 2) this.finishModal(false);
      return;
    }
    if (!this.active || e.button !== 0) return;
    if (e.altKey && !this.vertexAt(e.clientX, e.clientY)) {
      // Alt+clic sobre una arista le pone un vértice nuevo (en cuartos de su largo; Ctrl lo coloca donde se hizo clic).
      if (this.splitEdgeAt(e)) this.consume(e);
      return;
    }
    const hit = this.vertexAt(e.clientX, e.clientY);
    if (this.removing && hit && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Quitar vértice: el vértice del clic es el único elegido y se quita (con simetría, su espejo también); un solo paso de deshacer.
      this.consume(e);
      this.selection = new Map([[hit.piece.id, new Set([hit.key])]]);
      this.deleteSelected();
      return;
    }
    if (this.adding && !hit && !e.shiftKey) {
      // Se anota el clic: al soltar sin haber movido el ratón se añade el vértice; si se arrastró, la cámara gira como siempre.
      this.pendingAdd = { x: e.clientX, y: e.clientY, ctrl: e.ctrlKey || e.metaKey };
    }
    this.pendingEdge = !hit && !this.adding && !this.removing && !(e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey ? { x: e.clientX, y: e.clientY } : null;
    if (!hit && e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      // Shift+clic sobre una cara elige todos sus vértices (se suman a los que ya había).
      const face = this.faceAt(e.clientX, e.clientY);
      if (face) {
        this.consume(e);
        const keys = this.selection.get(face.piece.id) ?? new Set<string>();
        for (const p of face.piece.faces[face.index]) keys.add(vertexKey(p));
        this.selection.set(face.piece.id, keys);
        this.paint();
        this.host.onSelectionChange();
        return;
      }
    }
    if (hit) {
      this.consume(e);
      if (!this.isSelected(hit.piece, hit.key)) this.select(hit.piece, hit.key, e.shiftKey);
      else if (e.shiftKey && this.count > 1) this.selection.get(hit.piece.id)?.delete(hit.key);
      this.paint();
      this.host.onSelectionChange();
      this.beginDrag(e, hit.position);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !this.adding) {
      // Ctrl y arrastrar en vacío dibuja un recuadro que elige todos los vértices que caen dentro, también los de detrás.
      this.consume(e);
      this.marquee = { x: e.clientX, y: e.clientY, add: e.shiftKey };
      this.host.setOrbit(false);
      this.host.domElement.setPointerCapture(e.pointerId);
    }
  }

  private beginDrag(e: PointerEvent, anchor: Vec3): void {
    const targets = this.buildTargets();
    if (targets.length === 0) return;
    const camera = this.host.camera;
    const normal = camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...anchor));
    const grab = this.pointOnPlane(e, plane) ?? new THREE.Vector3(...anchor);
    this.pendingBefore = cloneSelection(this.selection);
    this.drag = { targets, anchor, plane, grab, startX: e.clientX, startY: e.clientY, moved: false, delta: [0, 0, 0] };
    if (this.sliding) {
      // El segmento se saca de la pieza donde está el vértice agarrado (no de su imagen en espejo, que lo sigue reflejado).
      const key = vertexKey(anchor);
      const owner = targets.find((t) => t.parts.some((part) => !part.mirror && part.keys.has(key)));
      const line = owner && slideSegment(owner.original, key);
      if (line) this.drag.slide = line;
      else this.host.status('Ese vértice no está en medio de un segmento recto: se mueve libre (Deslizar solo vale para vértices puestos sobre una arista)');
    }
    this.host.setOrbit(false);
    this.host.domElement.setPointerCapture(e.pointerId);
  }

  /** Las piezas y vértices que se mueven: los elegidos y, con simetría, sus imágenes en espejo con el desplazamiento reflejado. */
  private buildTargets(): Target[] {
    const identity = (v: Vec3): Vec3 => v;
    const targets: Target[] = [];
    const taken = new Map<number, Set<string>>();
    const add = (piece: Piece, keys: Set<string>, dir: (v: Vec3) => Vec3, mirror?: (p: Vec3) => Vec3): void => {
      const already = taken.get(piece.id) ?? new Set<string>();
      const fresh = new Set([...keys].filter((key) => !already.has(key)));
      if (fresh.size === 0) return;
      for (const key of fresh) already.add(key);
      taken.set(piece.id, already);
      const part: Part = { keys: fresh, full: new Set(keys), dir, mirror };
      const existing = targets.find((t) => t.original.id === piece.id);
      if (existing) {
        existing.parts.push(part);
        for (const key of fresh) existing.keys.add(key);
      } else targets.push({ original: piece, keys: new Set(fresh), parts: [part] });
    };
    for (const [id, keys] of this.selection) {
      const piece = this.host.model.get(id);
      if (piece) add(piece, new Set(keys), identity);
    }
    const mirrors = reflections(this.host.symmetry());
    if (mirrors.length > 0) {
      // Los vértices elegidos, antes de añadir imágenes (sobre estos se calculan todos los espejos).
      const chosen = targets.map((t) => ({ original: t.original, keys: new Set(t.keys) }));
      for (const reflection of mirrors) {
        const images: Vec3[] = [];
        for (const target of chosen) {
          for (const position of uniqueVertices(target.original)) if (target.keys.has(vertexKey(position))) images.push(reflection.point(position));
        }
        for (const piece of this.host.model.editable()) {
          const positions = uniqueVertices(piece);
          const found = new Set<string>();
          for (const image of images) {
            // La pareja es el vértice que cae justo en la imagen o, si el modelo quedó apenas descentrado, el más cercano dentro de un margen.
            let best: Vec3 | null = null;
            let bestDistance = MIRROR_TOLERANCE;
            for (const p of positions) {
              const distance = Math.hypot(p[0] - image[0], p[1] - image[1], p[2] - image[2]);
              if (distance <= bestDistance) {
                best = p;
                bestDistance = distance;
              }
            }
            if (best) found.add(vertexKey(best));
          }
          if (found.size > 0) add(piece, found, reflection.dir, reflection.point);
        }
      }
    }
    return targets;
  }

  private pointOnPlane(e: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null {
    const rect = this.rect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.host.camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  private move(e: PointerEvent): void {
    if (!this.active) return;
    if (this.modal) {
      this.modal.last = { x: e.clientX, y: e.clientY, free: this.magnet === (e.ctrlKey || e.metaKey) };
      this.updateModal();
      return;
    }
    if (this.marquee) {
      this.drawMarquee(e);
      return;
    }
    if (!this.drag) {
      const hit = this.vertexAt(e.clientX, e.clientY);
      const same = hit?.piece.id === this.hover?.piece.id && hit?.key === this.hover?.key;
      if (!same) {
        this.hover = hit ? { piece: hit.piece, key: hit.key } : null;
        this.paint();
        this.host.domElement.style.cursor = hit ? 'move' : 'default';
      }
      return;
    }
    const drag = this.drag;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const point = this.pointOnPlane(e, drag.plane);
    if (!point) return;
    let delta: Vec3 = [point.x - drag.grab.x, point.y - drag.grab.y, point.z - drag.grab.z];
    // Deslizar: el desplazamiento se proyecta sobre el segmento y se frena antes de llegar a los vecinos.
    const slide = drag.slide;
    const alongSegment = (v: Vec3): Vec3 => {
      if (!slide) return v;
      const s = Math.max(slide.min, Math.min(slide.max, v[0] * slide.dir[0] + v[1] * slide.dir[1] + v[2] * slide.dir[2]));
      return [slide.dir[0] * s, slide.dir[1] * s, slide.dir[2] * s];
    };
    if (slide) delta = alongSegment(delta);
    else if (this.axisLock !== null) delta = delta.map((v, i) => (axisAllowed(this.axisLock, i) ? v : 0)) as Vec3;
    // Con imán la posición final del vértice agarrado cae en la rejilla; sin él sigue al ratón. Ctrl invierte.
    if (!slide && this.magnet !== (e.ctrlKey || e.metaKey)) {
      delta = delta.map((v, i) => {
        if (!axisAllowed(this.axisLock, i)) return 0;
        return Math.round((drag.anchor[i] + v) / SNAP_STEP) * SNAP_STEP - drag.anchor[i];
      }) as Vec3;
    }
    // Con simetría, el vértice agarrado no cruza el plano: si lo hiciera, él y su imagen en espejo se cruzarían y la figura se plegaría sobre sí misma.
    const sym = this.host.symmetry();
    (['x', 'y', 'z'] as const).forEach((axis, i) => {
      if (!sym[axis]) return;
      const offset = drag.anchor[i] - sym.center[i];
      // Un vértice en el plano es su propia imagen: si se saliera de él, la figura dejaría de ser simétrica. Uno casi en el plano cuenta como en el plano.
      if (Math.abs(offset) < PLANE_SNAP) {
        delta[i] = sym.center[i] - drag.anchor[i];
        return;
      }
      const side = Math.sign(offset);
      if ((drag.anchor[i] + delta[i] - sym.center[i]) * side < 0) delta[i] = sym.center[i] - drag.anchor[i];
    });
    // El tope de simetría de arriba mueve componentes sueltos: se vuelve a dejar el desplazamiento sobre el segmento.
    if (slide) delta = alongSegment(delta);
    if (delta.every((v, i) => Math.abs(v - drag.delta[i]) < 1e-9)) return;
    // El cuerpo no se aplasta ni se atraviesa: si el desplazamiento lo hiciera, el vértice se queda en el último punto donde no pasaba.
    const from = drag.delta;
    // Un salto enorme del puntero se recorre por tramos: así no se salta ningún contacto por el camino.
    const reach = PATH_MAX * PATH_STEP;
    const jump = Math.hypot(delta[0] - from[0], delta[1] - from[1], delta[2] - from[2]);
    const target: Vec3 = jump > reach ? (from.map((v, i) => v + ((delta[i] - v) * reach) / jump) as Vec3) : delta;
    const at = (t: number): Vec3 => from.map((v, i) => v + (target[i] - v) * t) as Vec3;
    // Se recorre el camino en pasos: un salto grande podría pasar al otro lado sin que el estado final delate que atravesó algo.
    const steps = Math.min(PATH_MAX, Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[1] - from[1], target[2] - from[2]) / PATH_STEP)));
    let first = 0;
    for (let i = 1; i <= steps && first === 0; i++) if (this.collides(drag.targets, at(i / steps))) first = i;
    if (first > 0) {
      let lo = (first - 1) / steps;
      let hi = first / steps;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (this.collides(drag.targets, at(mid))) hi = mid;
        else lo = mid;
      }
      this.host.status('El cuerpo no puede aplastarse más contra sí mismo');
      delta = at(lo);
      if (delta.every((v, i) => Math.abs(v - drag.delta[i]) < 1e-9)) return;
    }
    if (first === 0) delta = target;
    drag.delta = delta;
    this.preview(delta);
  }

  /**
   * La pieza con los vértices elegidos llevados por `to`. Si un punto de arista (que toca solo dos caras) sale de los planos de las dos, antes se pone un
   * vértice en el centro de cada una: sin él las dos caras acabarían siendo el mismo triángulo, una aleta plana sin volumen.
   */
  private place(target: Target, to: (p: Vec3) => Vec3): Piece | null {
    const moved = placeVertices(target.original, target.keys, to, true);
    if (!moved || moved.faces.length !== target.original.faces.length) return moved;
    const { faces } = finFaces(moved, target.original);
    if (faces.size === 0) return moved;
    const prepared = splitFacesAtCenter(target.original, faces);
    return (prepared && placeVertices(prepared, target.keys, to, true)) || moved;
  }

  /**
   * Con simetría, un vértice que está sobre un plano de espejo (a menos de MIRROR_TOLERANCE) conserva esa coordenada: es su propia imagen, y si se
   * saliera del plano la pieza dejaría de ser simétrica. Vale para el arrastre y para girar, escalar y deformar, sea cual sea el vértice agarrado.
   */
  private keepPlanes(to: (p: Vec3) => Vec3): (p: Vec3) => Vec3 {
    const sym = this.host.symmetry();
    const axes = ([sym.x, sym.y, sym.z] as const).map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
    if (axes.length === 0) return to;
    return (p) => {
      const q = to(p);
      for (const i of axes) if (Math.abs(p[i] - sym.center[i]) < MIRROR_TOLERANCE) q[i] = p[i];
      return q;
    };
  }

  /** Las piezas con los vértices desplazados (null si una desaparece). */
  private placed(targets: Target[], delta: Vec3): (Piece | null)[] {
    return targets.map((target) =>
      this.place(
        target,
        this.keepPlanes((p) => {
          const d = partOf(target, p).dir(delta);
          return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
        }),
      ),
    );
  }

  /** ¿Alguna pieza se aplastaría o se atravesaría a sí misma con este desplazamiento, siendo que antes no? */
  private collides(targets: Target[], delta: Vec3): boolean {
    return this.collapseOf(targets, this.placed(targets, delta));
  }

  /** ¿Alguna de estas piezas movidas se aplasta o se atraviesa a sí misma, siendo que su original no? */
  private collapseOf(targets: Target[], moved: (Piece | null)[]): boolean {
    return moved.some((piece, i) => {
      if (!piece) return false;
      const original = targets[i].original;
      let before = this.collapsedBefore.get(original);
      if (before === undefined) {
        before = collapses(original);
        this.collapsedBefore.set(original, before);
      }
      return !before && collapses(piece);
    });
  }

  /** Coloca las piezas en su estado inicial más el desplazamiento, sin pasar por el historial. */
  private preview(delta: Vec3): void {
    const drag = this.drag!;
    this.showGuide([drag.anchor[0] + delta[0], drag.anchor[1] + delta[1], drag.anchor[2] + delta[2]]);
    // La selección sigue a los vértices movidos (cambian de clave al cambiar de sitio) antes de avisar al modelo, que la revisa.
    const shifted = (target: Target) =>
      this.keepPlanes((p: Vec3): Vec3 => {
        const d = partOf(target, p).dir(delta);
        return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
      });
    for (const target of drag.targets) {
      if (!this.selection.has(target.original.id)) continue;
      const chosen = chosenKeys(target);
      const to = shifted(target);
      this.selection.set(target.original.id, new Set(uniqueVertices(target.original).filter((position) => chosen.has(vertexKey(position))).map((position) => vertexKey(to(position)))));
    }
    const removed: Piece[] = [];
    const added: Piece[] = [];
    let finned = false;
    for (const target of drag.targets) {
      const current = this.host.model.get(target.original.id);
      const moved = this.place(target, shifted(target));
      if (current) removed.push(current);
      if (moved) {
        const fins = flagFins(moved, target.original);
        if (fins.count > 0) finned = true;
        added.push(sameId(fins.piece, moved));
      }
    }
    if (finned) this.host.status(FIN_MESSAGE);
    this.host.model.preview({ added, removed });
  }

  private up(e: PointerEvent): void {
    if (!this.active) return;
    if (this.pendingEdge) {
      const { x, y } = this.pendingEdge;
      this.pendingEdge = null;
      // Un clic sin arrastrar sobre un segmento elige sus dos vértices; un doble clic sigue el segmento en línea recta.
      if (Math.hypot(e.clientX - x, e.clientY - y) < DRAG_THRESHOLD && this.clickEdge(x, y)) {
        this.consume(e);
        // Como al añadir un vértice: la cámara recibió el pulsar pero no recibirá el soltar, y el clic no debe cambiar la pieza elegida.
        this.host.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, bubbles: true }));
      }
      return;
    }
    if (this.pendingAdd) {
      const { x, y, ctrl } = this.pendingAdd;
      this.pendingAdd = null;
      if (Math.hypot(e.clientX - x, e.clientY - y) < DRAG_THRESHOLD && this.addVertexAt(x, y, ctrl)) {
        this.consume(e);
        // La cámara recibió el pulsar pero ya no recibirá el soltar: sin esto se queda agarrada y sigue al ratón sin tener el botón pulsado.
        this.host.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, bubbles: true }));
      }
      return;
    }
    if (this.marquee) {
      this.consume(e);
      this.finishMarquee(e);
      return;
    }
    if (!this.drag) return;
    this.consume(e);
    this.finishDrag(true);
  }

  private finishDrag(commit: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.guide.visible = false;
    this.host.setOrbit(true);
    if (!drag.moved) return;
    if (!commit) {
      this.restore(drag.targets);
      return;
    }
    const finals: Piece[] = [];
    const originals: Piece[] = [];
    let flattened = 0;
    for (const target of drag.targets) {
      let current = this.host.model.get(target.original.id);
      if (current && this.flattenOnRelease) {
        // Las caras que tocan los vértices movidos y quedaron torcidas se aplanan, salvo que eso aplaste o atraviese la pieza.
        const before = new Set(uniqueVertices(target.original).map(vertexKey));
        const touched = new Set(uniqueVertices(current).map(vertexKey).filter((key) => !before.has(key)));
        const fixed = flattenWarped(current, touched);
        if (fixed && (!collapses(fixed.piece) || collapses(target.original))) {
          // El arrastre ya dejó la pieza en el modelo; se sustituye por la aplanada antes de anotar el cambio (commitPreview solo lo anota).
          this.host.model.preview({ added: [fixed.piece], removed: [current] });
          current = fixed.piece;
          flattened += fixed.moved.size;
          const chosen = this.selection.get(target.original.id);
          if (chosen) this.selection.set(target.original.id, new Set([...chosen].map((key) => fixed.moved.get(key) ?? key)));
        }
      }
      if (current) finals.push(current);
      originals.push(target.original);
    }
    const depthBefore = this.host.model.undoDepth;
    this.host.model.commitPreview({ added: finals, removed: originals });
    // Si no cambió nada (un arrastre sin desplazamiento) el modelo no anotó un paso: tampoco se anota la elección.
    if (this.pendingBefore && this.host.model.undoDepth > depthBefore) this.record(this.pendingBefore);
    this.refresh();
    if (flattened > 0) this.host.status(`Aplanar al soltar: ${flattened} vértice(s) ajustados para que las caras no queden torcidas`);
  }

  private restore(targets: Target[]): void {
    const removed: Piece[] = [];
    const added: Piece[] = [];
    for (const target of targets) {
      const current = this.host.model.get(target.original.id);
      if (current) removed.push(current);
      added.push(target.original);
      if (this.selection.has(target.original.id)) this.selection.set(target.original.id, new Set(chosenKeys(target)));
    }
    this.host.model.preview({ added, removed });
    this.refresh();
  }

  cancel(): void {
    if (this.modal) this.finishModal(false);
    if (this.drag) this.finishDrag(false);
    if (this.marquee) {
      this.marquee = null;
      this.marqueeEl?.remove();
      this.marqueeEl = null;
      this.host.setOrbit(true);
    }
  }

  private drawMarquee(e: PointerEvent): void {
    const m = this.marquee!;
    if (!this.marqueeEl) {
      this.marqueeEl = document.createElement('div');
      this.marqueeEl.style.cssText = 'position:fixed;border:1px solid #ffd34d;background:rgba(255,211,77,0.12);pointer-events:none;z-index:20';
      document.body.append(this.marqueeEl);
    }
    const x = Math.min(m.x, e.clientX);
    const y = Math.min(m.y, e.clientY);
    Object.assign(this.marqueeEl.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(e.clientX - m.x)}px`, height: `${Math.abs(e.clientY - m.y)}px` });
  }

  private finishMarquee(e: PointerEvent): void {
    const m = this.marquee!;
    this.marquee = null;
    this.marqueeEl?.remove();
    this.marqueeEl = null;
    this.host.setOrbit(true);
    const x0 = Math.min(m.x, e.clientX);
    const x1 = Math.max(m.x, e.clientX);
    const y0 = Math.min(m.y, e.clientY);
    const y1 = Math.max(m.y, e.clientY);
    if (x1 - x0 < DRAG_THRESHOLD && y1 - y0 < DRAG_THRESHOLD) return;
    if (!m.add) this.selection.clear();
    for (const { piece, position, key } of this.shown) {
      const s = this.screenOf(position);
      if (s.behind || s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
      if (!this.seeBehind && this.occluded(position)) continue;
      const keys = this.selection.get(piece.id) ?? new Set<string>();
      keys.add(key);
      this.selection.set(piece.id, keys);
    }
    this.paint();
    this.host.onSelectionChange();
  }

  // ——— Teclado y acciones ———

  /** Devuelve true si la tecla se usó aquí y no debe seguir (flechas con selección, Supr, ejes durante el arrastre). */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    const key = e.key.toLowerCase();
    if (this.modal) {
      if (key === 'x' || key === 'y' || key === 'z') {
        const axis = 'xyz'.indexOf(key);
        this.modal.axis = this.modal.axis === axis ? null : axis;
        this.updateModal();
      } else if (key === 'escape') this.finishModal(false);
      else if (key === 'enter') this.finishModal(true);
      return true;
    }
    // Con un arrastre o un recuadro en marcha, Ctrl+Z/Ctrl+Y y Supr no tocan el modelo: la vista previa todavía no está en el historial.
    if (this.busy && (((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) || key === 'delete' || key === 'backspace')) return true;
    if (!this.busy && this.count > 0 && !e.ctrlKey && !e.metaKey && !e.altKey && (key === 'r' || key === 't')) {
      this.beginTransform(key === 'r' ? 'rotate' : 'scale');
      return true;
    }
    // A (de «añadir») enciende y apaga el modo añadir vértice, igual que el botón «+ Vértice».
    if (!this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'a') {
      this.setAddMode(!this.adding);
      return true;
    }
    // D (de «deshacerse de un vértice») enciende y apaga el modo quitar vértice, igual que el botón «− Vértice».
    if (!this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'd') {
      this.setRemoveMode(!this.removing);
      return true;
    }
    // En Malla, X / Y / Z fijan el eje (como los botones «Mover en») y no tocan la simetría, que se cambia con sus casillas.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (key === 'x' || key === 'y' || key === 'z')) {
      const axis = 'xyz'.indexOf(key);
      // Con Mayús se fija el plano que deja fuera ese eje (Mayús+Z = XY), como en Blender.
      const lock = e.shiftKey ? [PLANE_YZ, PLANE_XZ, PLANE_XY][axis] : axis;
      this.setAxis(this.axisLock === lock ? null : lock);
      return true;
    }
    if (this.drag && key === 'escape') {
      this.finishDrag(false);
      return true;
    }
    // S (de «deslizar») enciende y apaga Deslizar, igual que el botón; es un modo de arrastre y no necesita vértices elegidos.
    if (key === 's' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.setSlideMode(!this.sliding);
      return true;
    }
    if (this.count === 0) {
      // Sin vértices elegidos estas teclas no hacen nada en Malla (antes pasaban a las de las otras herramientas, como F = Cara, y se salía de Malla sin querer).
      const needs = NEEDS_SELECTION[key];
      if (needs && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        this.host.status(needs);
        return true;
      }
      return false;
    }
    // U (de «unir») traza el segmento entre dos vértices elegidos, igual que el botón «Trazar segmento».
    if (key === 'u' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.connectSelected();
      return true;
    }
    // Q (de «quitar segmento») junta las dos caras que separa el segmento entre dos vértices elegidos, igual que el botón «Quitar segmento».
    if (key === 'q' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.dissolveSelected();
      return true;
    }
    // L (de «línea») endereza los vértices elegidos entre el primero y el último, igual que el botón «Alinear en línea».
    if (key === 'l' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.straightenSelected();
      return true;
    }
    // P (de «plano») aplana los vértices elegidos, igual que el botón «Aplanar en plano».
    if (key === 'p' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.flattenSelected();
      return true;
    }
    // F (de «face») crea una cara con los vértices elegidos y B (de «borrar cara») quita las caras cuyos vértices están todos elegidos, igual que los botones.
    if (key === 'f' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.createFace();
      return true;
    }
    if (key === 'b' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.deleteFacesSelected();
      return true;
    }
    // N (de «normal») empuja las caras elegidas a lo largo de su normal, igual que el botón «Empujar cara».
    if (key === 'n' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.beginTransform('push');
      return true;
    }
    // K (de «cerrar») tapa el hueco que toquen los vértices elegidos, igual que el botón «Tapar hueco».
    if (key === 'k' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.fillHolesSelected();
      return true;
    }
    // I (de «sacar una punta») duplica los vértices elegidos y deja elegidas las copias para jalarlas, igual que el botón «Punta».
    if (key === 'i' && !this.drag && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      this.tipSelected();
      return true;
    }
    if (key === 'delete' || key === 'backspace') {
      this.deleteSelected();
      return true;
    }
    return false;
  }

  /** Empieza a girar (R) o escalar (T) los vértices elegidos alrededor de su centro; se maneja moviendo el ratón. */
  beginTransform(kind: TransformKind): void {
    if (this.busy) return;
    const targets = this.buildTargets();
    if (targets.length === 0) {
      this.host.status('Elige algún vértice para girarlo o escalarlo');
      return;
    }
    // El pivote es el centro de la caja de los vértices elegidos (sin contar las imágenes en espejo).
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const target of targets) {
      const chosen = chosenKeys(target);
      for (const p of uniqueVertices(target.original)) {
        if (!chosen.has(vertexKey(p))) continue;
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[k]);
          max[k] = Math.max(max[k], p[k]);
        }
      }
    }
    const pivot = [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as Vec3;
    let normal: Vec3 | undefined;
    if (kind === 'push') {
      normal = this.chosenFacesNormal(targets) ?? undefined;
      if (!normal) {
        this.host.status('Empujar cara (N): elige todos los vértices de una o más caras');
        return;
      }
    }
    const half = [0, 1, 2].map((k) => (max[k] - min[k]) / 2) as Vec3;
    if ((kind === 'taper' || kind === 'twist' || kind === 'bend') && half.every((h) => h < 1e-6)) {
      this.host.status('Elige vértices que ocupen algo de espacio para afinar, torcer o curvar');
      return;
    }
    this.pendingBefore = cloneSelection(this.selection);
    this.modal = { kind, targets, pivot, half, normal, axis: this.axisLock !== null && this.axisLock < 3 ? this.axisLock : null, start: null, last: null, value: kind === 'scale' ? 1 : 0, valid: kind === 'scale' ? 1 : 0, moved: false };
    this.host.setOrbit(false);
    const name = { rotate: 'Girar', scale: 'Escalar', taper: 'Afinar', twist: 'Torcer', bend: 'Curvar', push: 'Empujar cara' }[kind];
    const hint = kind === 'push' ? 'mueve el ratón en la dirección de la flecha de la cara (adelante empuja, atrás jala)' : kind === 'taper' || kind === 'twist' || kind === 'bend' ? 'mueve el ratón a los lados · X/Y/Z cambia el eje (por defecto Y)' : 'mueve el ratón · X/Y/Z fija el eje';
    this.host.status(`${name}: ${hint} · Ctrl invierte el imán · clic o Intro confirma · Esc cancela`);
    // Afinar, Torcer y Curvar trabajan a lo largo de un eje: si la selección es plana en el eje por defecto, se dice ya, con los ejes que sí sirven.
    if (kind === 'taper' || kind === 'twist' || kind === 'bend') {
      const axis = this.modal!.axis ?? 1;
      if (half[axis] < 1e-6) {
        const useful = [0, 1, 2].filter((k) => half[k] >= 1e-6).map((k) => 'XYZ'[k]);
        this.host.status(`${name}: la selección es plana en ${'XYZ'[axis]} y no hay nada que ${{ taper: 'afinar', twist: 'torcer', bend: 'curvar' }[kind]} en ese eje: pulsa ${useful.join(' o ')} para usar otro`);
      }
    }
  }

  /** Eje de giro: el del mundo elegido, o el más parecido a la dirección de la cámara. */
  private rotationAxis(): Vec3 {
    const modal = this.modal!;
    if (modal.axis !== null) return [0, 1, 2].map((k) => (k === modal.axis ? 1 : 0)) as Vec3;
    const direction = this.host.camera.getWorldDirection(new THREE.Vector3());
    const axis = this.worldAxis(direction);
    return axis;
  }

  /** La normal media (hacia fuera) de las caras cuyos vértices están todos elegidos, o null si no hay ninguna. */
  private chosenFacesNormal(targets: Target[]): Vec3 | null {
    const sum: Vec3 = [0, 0, 0];
    for (const target of targets) {
      const chosen = chosenKeys(target);
      for (const i of facesWithin(target.original, chosen)) {
        const n = faceNormal(target.original.faces[i]);
        for (let k = 0; k < 3; k++) sum[k] += n[k];
      }
    }
    const length = Math.hypot(...sum);
    return length < 1e-9 ? null : [sum[0] / length, sum[1] / length, sum[2] / length];
  }

  private updateModal(): void {
    const modal = this.modal;
    if (!modal || !modal.last) return;
    const centre = this.screenOf(modal.pivot);
    const { x, y, free } = modal.last;
    const angle = Math.atan2(y - centre.y, x - centre.x);
    const distance = Math.max(Math.hypot(x - centre.x, y - centre.y), 8);
    if (!modal.start) {
      // El primer movimiento fija el punto de partida: así no hay salto al empezar.
      modal.start = { x, y, angle, distance };
      return;
    }
    let mapAt: (value: number) => (p: Vec3) => Vec3;
    let value: number;
    // El texto se arma con el valor que de verdad se aplica (un salto grande del ratón se recorta a MODAL_REACH y el cuerpo puede frenar antes).
    let describe: (value: number) => string;
    if (modal.kind === 'taper' || modal.kind === 'twist' || modal.kind === 'bend') {
      // Se maneja con el movimiento horizontal del cursor; el eje por defecto es el vertical.
      const axis = modal.axis ?? 1;
      const half = modal.half[axis];
      if (half < 1e-6) {
        this.host.status(`No hay largo a lo largo de ${'XYZ'[axis]}: prueba con otro eje (X/Y/Z)`);
        return;
      }
      let amount = (x - modal.start.x) / DEFORM_PIXELS;
      if (!free) amount = Math.round(amount / SCALE_STEP) * SCALE_STEP;
      if (modal.kind === 'taper') amount = Math.max(amount, -0.95);
      if (modal.kind === 'bend') amount = Math.min(Math.max(amount, -1.5), 1.5);
      value = amount;
      const point = { taper: taperPoint, twist: twistPoint, bend: bendPoint }[modal.kind];
      mapAt = (v) => (p) => point(p, modal.pivot, axis, half, v);
      const label = { taper: 'Afinar', twist: 'Torcer', bend: 'Curvar' }[modal.kind];
      describe = (v) => `${label} ${v >= 0 ? '+' : ''}${v.toFixed(2)} en ${'XYZ'[axis]}`;
    } else if (modal.kind === 'push') {
      const normal = modal.normal!;
      // Cuántos píxeles mide una celda a lo largo de la normal: el ratón se mueve en esa dirección de pantalla. Si la normal apunta a la cámara, vale el movimiento vertical.
      const from = this.screenOf(modal.pivot);
      const to = this.screenOf([modal.pivot[0] + normal[0], modal.pivot[1] + normal[1], modal.pivot[2] + normal[2]]);
      let dx = to.x - from.x;
      let dy = to.y - from.y;
      let perCell = Math.hypot(dx, dy);
      if (perCell < PUSH_MIN_PIXELS) {
        dx = 0;
        dy = -PUSH_FALLBACK_PIXELS;
        perCell = PUSH_FALLBACK_PIXELS;
      }
      let amount = ((x - modal.start.x) * dx + (y - modal.start.y) * dy) / (perCell * perCell);
      if (!free) amount = Math.round(amount / SNAP_STEP) * SNAP_STEP;
      value = amount;
      mapAt = (v) => (p) => [p[0] + normal[0] * v, p[1] + normal[1] * v, p[2] + normal[2] * v];
      describe = (v) => `Empujar cara ${v >= 0 ? '+' : ''}${v.toFixed(2)} (${v >= 0 ? 'hacia fuera' : 'hacia dentro'})`;
    } else if (modal.kind === 'rotate') {
      const axis = this.rotationAxis();
      const toward = this.host.camera.getWorldDirection(new THREE.Vector3());
      // Si el eje apunta hacia quien mira, el giro positivo se ve en sentido contrario al de las agujas; el cursor se mide al revés.
      const sign = axis[0] * toward.x + axis[1] * toward.y + axis[2] * toward.z < 0 ? -1 : 1;
      let theta = (angle - modal.start.angle) * sign;
      if (!free) theta = Math.round(theta / ROTATE_STEP) * ROTATE_STEP;
      value = theta;
      mapAt = (v) => (p) => rotateAbout(p, modal.pivot, axis, v);
      describe = (v) => `Girar ${Math.round((v * 180) / Math.PI)}°${modal.axis === null ? '' : ' en ' + 'XYZ'[modal.axis]}`;
    } else {
      let factor = distance / modal.start.distance;
      if (!free) factor = Math.round(factor / SCALE_STEP) * SCALE_STEP;
      factor = Math.max(factor, SCALE_STEP);
      value = factor;
      mapAt = (v) => {
        const factors = [0, 1, 2].map((k) => (modal.axis === null || modal.axis === k ? v : 1)) as Vec3;
        return (p) => scaleAbout(p, modal.pivot, factors);
      };
      describe = (v) => `Escalar ×${v.toFixed(2)}${modal.axis === null ? '' : ' en ' + 'XYZ'[modal.axis]}`;
    }
    // El cuerpo no se aplasta ni se atraviesa: si el valor pedido lo hiciera, se queda en el último valor donde no pasaba.
    const from = modal.valid;
    const reach = Math.sign(value - from) * Math.min(Math.abs(value - from), MODAL_REACH);
    const target = from + reach;
    const hit = (v: number): boolean => this.collapseOf(modal.targets, this.placedMap(modal.targets, mapAt(v)));
    let first = 0;
    for (let i = 1; i <= MODAL_STEPS && first === 0; i++) if (hit(from + (reach * i) / MODAL_STEPS)) first = i;
    let result = target;
    if (first > 0) {
      let lo = from + (reach * (first - 1)) / MODAL_STEPS;
      let hi = from + (reach * first) / MODAL_STEPS;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (hit(mid)) hi = mid;
        else lo = mid;
      }
      result = lo;
      this.host.status('El cuerpo no puede aplastarse más contra sí mismo');
    }
    if (first === 0) this.host.status(describe(result));
    modal.valid = result;
    modal.value = result;
    modal.moved = true;
    this.previewMap(modal.targets, mapAt(result));
  }

  /** Las piezas con cada vértice elegido llevado por `map` (las imágenes en espejo reciben la transformación reflejada). */
  private placedMap(targets: Target[], map: (p: Vec3) => Vec3): (Piece | null)[] {
    return targets.map((target) =>
      this.place(
        target,
        this.keepPlanes((p) => {
          const { mirror } = partOf(target, p);
          return mirror ? mirror(map(mirror(p))) : map(p);
        }),
      ),
    );
  }

  /** Coloca las piezas en su estado inicial con cada vértice elegido llevado por `map` (las imágenes en espejo reciben la transformación reflejada). */
  private previewMap(targets: Target[], map: (p: Vec3) => Vec3): void {
    const placed = (target: Target) =>
      this.keepPlanes((p: Vec3): Vec3 => {
        const { mirror } = partOf(target, p);
        return mirror ? mirror(map(mirror(p))) : map(p);
      });
    for (const target of targets) {
      if (!this.selection.has(target.original.id)) continue;
      const to = placed(target);
      const chosen = chosenKeys(target);
      this.selection.set(target.original.id, new Set(uniqueVertices(target.original).filter((p) => chosen.has(vertexKey(p))).map((p) => vertexKey(to(p)))));
    }
    const removed: Piece[] = [];
    const added: Piece[] = [];
    let finned = false;
    for (const target of targets) {
      const current = this.host.model.get(target.original.id);
      const result = this.place(target, placed(target));
      if (current) removed.push(current);
      if (result) {
        const fins = flagFins(result, target.original);
        if (fins.count > 0) finned = true;
        added.push(sameId(fins.piece, result));
      }
    }
    if (finned) this.host.status(FIN_MESSAGE);
    this.host.model.preview({ added, removed });
  }

  private finishModal(commit: boolean): void {
    const modal = this.modal;
    if (!modal) return;
    this.modal = null;
    this.host.setOrbit(true);
    if (!modal.moved) {
      this.host.status('');
      return;
    }
    if (!commit) {
      this.restore(modal.targets);
      this.host.status('Cancelado');
      return;
    }
    const finals: Piece[] = [];
    const originals: Piece[] = [];
    for (const target of modal.targets) {
      const current = this.host.model.get(target.original.id);
      if (current) finals.push(current);
      originals.push(target.original);
    }
    const depthBefore = this.host.model.undoDepth;
    this.host.model.commitPreview({ added: finals, removed: originals });
    // Si no cambió nada (un arrastre sin desplazamiento) el modelo no anotó un paso: tampoco se anota la elección.
    if (this.pendingBefore && this.host.model.undoDepth > depthBefore) this.record(this.pendingBefore);
    this.refresh();
    this.host.status({ rotate: 'Giro aplicado', scale: 'Escala aplicada', taper: 'Afinado aplicado', twist: 'Torcido aplicado', bend: 'Curvado aplicado', push: 'Cara empujada' }[modal.kind]);
  }

  /** Eje del mundo que más se parece a una dirección de pantalla. */
  private worldAxis(direction: THREE.Vector3): Vec3 {
    const abs = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)];
    const axis = abs.indexOf(Math.max(...abs));
    const out: Vec3 = [0, 0, 0];
    out[axis] = Math.sign([direction.x, direction.y, direction.z][axis]) || 1;
    return out;
  }

  snapToGrid(): void {
    const onGrid = (p: Vec3): Vec3 => p.map((v) => Math.round(v / SNAP_STEP) * SNAP_STEP) as Vec3;
    let moved = 0;
    this.change((piece, keys, _dirAt, parts) => {
      // Se redondea el lado elegido y el espejo es su reflejo: redondear cada lado por separado dejaría el modelo asimétrico si el centro no cae en la rejilla.
      const own = ownKeys(parts);
      moved += uniqueVertices(piece).filter((p) => own.has(vertexKey(p)) && vertexKey(onGrid(p)) !== vertexKey(p)).length;
      const to = this.keepPlanes((p) => {
        const part = partOf({ original: piece, keys, parts }, p);
        return part.mirror ? part.mirror(onGrid(part.mirror(p))) : onGrid(p);
      });
      return placeVertices(piece, keys, to, true) ?? REMOVE;
    }, onGrid);
    this.host.status(moved > 0 ? `A la rejilla: ${moved} vértice(s) movidos al punto de rejilla más cercano` : 'A la rejilla: los vértices elegidos ya estaban en ella');
  }

  mergeSelected(): void {
    if (this.count < 2) {
      this.host.status('Elige al menos dos vértices de la misma pieza para fusionarlos');
      return;
    }
    let merged = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      // Con simetría cada lado se funde en su propio punto: mezclar los elegidos con sus imágenes los llevaría a todos al centro.
      // Solo se juntan los grupos que comparten algún vértice (uno puesto sobre el plano del espejo es de los dos lados).
      let current: Piece | null = piece;
      let any = false;
      for (const group of vertexGroups(parts)) {
        if (uniqueVertices(current).filter((p) => group.has(vertexKey(p))).length < 2) continue;
        any = true;
        merged++;
        current = mergeVertices(current, group);
        // Con dos o más vértices y sin resultado, la pieza se quedó sin caras.
        if (!current) return REMOVE;
      }
      return any ? sameId(current, piece) : null;
    });
    this.host.status(merged > 0 ? `Fusionar: ${merged === 1 ? 'los vértices elegidos pasan a ser uno' : `${merged} grupos de vértices fusionados (el espejo también)`}` : 'Fusionar: elige al menos dos vértices de la misma pieza');
  }

  /**
   * Suelda los vértices que están a menos de `distance` de otro: de los elegidos (y sus imágenes en el espejo) o, sin elección, de todas las piezas que se ven.
   * Cada grupo pasa a su punto medio, así que con simetría el resultado sigue siendo simétrico. Un solo paso de deshacer.
   */
  weldNearby(distance = this.weldDistance): void {
    if (this.busy) return;
    if (!(distance > 0)) {
      this.host.status('Soldar cercanos: la distancia tiene que ser mayor que cero');
      return;
    }
    let welded = 0;
    if (this.count > 0) {
      this.change((piece, keys) => {
        const result = weldVertices(piece, distance, keys);
        if (result.welded === 0) return null;
        welded += result.welded;
        return result.piece;
      });
    } else {
      const removed: Piece[] = [];
      const added: Piece[] = [];
      for (const piece of new Map(this.shown.map((entry) => [entry.piece.id, entry.piece])).values()) {
        const result = weldVertices(piece, distance);
        if (result.welded === 0) continue;
        welded += result.welded;
        removed.push(piece);
        added.push(result.piece);
      }
      if (added.length > 0) {
        const before = cloneSelection(this.selection);
        const depthBefore = this.host.model.undoDepth;
        this.host.model.apply({ added, removed });
        if (this.host.model.undoDepth > depthBefore) this.record(before);
        this.refresh();
      }
    }
    this.host.status(
      welded > 0
        ? `Soldar cercanos: ${welded} ${welded === 1 ? 'vértice soldado' : 'vértices soldados'} (a menos de ${+distance.toFixed(4)} de otro)`
        : `Soldar cercanos: ningún vértice está a menos de ${+distance.toFixed(4)} de otro${this.count > 0 ? ' entre los elegidos' : ''}`,
    );
  }

  deleteSelected(): void {
    let removed = 0;
    this.change((piece, keys) => {
      removed += uniqueVertices(piece).filter((p) => keys.has(vertexKey(p))).length;
      const result = deleteVertices(piece, keys);
      return result ? sameId(result, piece) : REMOVE;
    });
    if (removed > 0) this.host.status(`Borrar: ${removed} vértice(s) quitados (las caras que los usaban se quedan con menos; un triángulo desaparece)`);
  }

  /**
   * Crea una cara con los vértices elegidos de cada pieza (con tres, un triángulo). Con simetría, cada lado se arma con sus propios vértices:
   * mezclar los elegidos con sus imágenes en el espejo daría una cara con otros vértices y en otro plano.
   */
  createFace(): void {
    if (this.count < 3) {
      this.host.status(`Crear cara: hay ${this.count} vértice(s) elegido(s); elige al menos tres de la misma pieza (Shift+clic para sumar)`);
      return;
    }
    if (this.mostInOnePiece < 3) {
      this.host.status(`Crear cara: hay ${this.count} vértices elegidos pero repartidos en ${this.selection.size} piezas (como mucho ${this.mostInOnePiece} en una): una cara necesita tres de la misma pieza`);
      return;
    }
    let made = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      let current = piece;
      for (const part of parts) {
        const result = addFace(current, part.full);
        if (result) {
          current = result;
          made++;
        }
      }
      return current === piece ? null : sameId(current, piece);
    }, keepPosition);
    if (made > 0) this.host.status(made > 1 ? `Cara creada: ${made} (la del espejo también)` : 'Cara creada');
    else this.host.status(`No se creó ninguna cara: elige tres o más vértices de una misma pieza que no formen ya una cara${this.seeBehind ? '' : ' (si te faltan vértices, están tapados: marca «Ver vértices de atrás»)'}`);
  }

  /** Cierra con una cara cada hueco (borde abierto) que toque algún vértice elegido; basta con elegir uno de los del contorno. */
  fillHolesSelected(): void {
    let filled = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      let current = piece;
      for (const part of parts) {
        const result = fillHoles(current, part.full);
        if (result) {
          current = result.piece;
          filled += result.filled;
        }
      }
      return current === piece ? null : sameId(current, piece);
    }, keepPosition);
    this.host.status(filled > 0 ? `Tapar hueco: ${filled} hueco(s) cerrados con una cara` : 'Tapar hueco: elige algún vértice del borde abierto (ese contorno tiene que dar la vuelta completa)');
  }

  /** Quita las caras cuyos vértices están todos elegidos. */
  deleteFacesSelected(): void {
    let any = false;
    let count = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      const faces = facesOfParts(piece, parts);
      if (faces.length === 0) return null;
      any = true;
      count += faces.length;
      const result = deleteFaces(piece, new Set(faces));
      return result ? sameId(result, piece) : REMOVE;
    }, keepPosition);
    this.host.status(any ? `Borrar cara: ${count} cara(s) quitadas, la pieza queda abierta por ahí` : 'Borrar cara: elige todos los vértices de la cara');
  }

  /** Da la vuelta a las caras cuyos vértices están todos elegidos. */
  flipSelected(): void {
    let any = false;
    let count = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      const faces = facesOfParts(piece, parts);
      if (faces.length === 0) return null;
      any = true;
      count += faces.length;
      const result = flipFaces(piece, new Set(faces));
      return result ? sameId(result, piece) : null;
    }, keepPosition);
    this.host.status(any ? `Invertir cara: ${count} cara(s) dadas la vuelta` : 'Invertir cara: elige todos los vértices de la cara');
  }

  /** Corta por la mitad el anillo de caras que atraviesa la arista entre dos vértices elegidos; los vértices nuevos quedan elegidos para moverlos o escalarlos juntos. */
  ringCutSelected(): void {
    let cuts = 0;
    let faces = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      let current = piece;
      const select = new Set<string>();
      for (const part of parts) {
        const pair = uniqueVertices(current).filter((p) => part.full.has(vertexKey(p)));
        if (pair.length !== 2) continue;
        const result = ringCut(current, pair[0], pair[1]);
        if (!result) continue;
        current = result.piece;
        cuts++;
        faces += result.cut;
        if (!part.mirror) for (const key of result.created) select.add(key);
      }
      return current === piece ? null : { piece: sameId(current, piece), select: select.size > 0 ? this.oneSide(select, current, piece, parts) : ownKeys(parts) };
    });
    this.host.status(cuts > 0 ? `Corte en anillo: ${faces} cara(s) partidas${cuts > 1 ? ` en ${cuts} anillos (el espejo también)` : ''}; los vértices nuevos quedan elegidos` : 'Corte en anillo: elige los dos vértices de una arista (que dé paso a caras de cuatro lados)');
  }

  /**
   * Bisela la arista de cada grupo (los elegidos y cada espejo) sobre una copia de la pieza. `ok` es falso si algún grupo que tenía su arista no
   * pudo biselarse (por ejemplo porque el primer bisel dejó el segmento vecino más corto que el tamaño): entonces el resultado no vale.
   */
  private bevelParts(piece: Piece, parts: Part[], size: number): { piece: Piece; created: Set<string>; count: number; ok: boolean } {
    let current = piece;
    const created = new Set<string>();
    let count = 0;
    let ok = true;
    for (const part of parts) {
      if (uniqueVertices(piece).filter((p) => part.full.has(vertexKey(p))).length !== 2) continue;
      const pair = uniqueVertices(current).filter((p) => part.full.has(vertexKey(p)));
      const result = pair.length === 2 ? bevelEdge(current, pair[0], pair[1], size) : null;
      if (!result) {
        ok = false;
        continue;
      }
      current = result.piece;
      count++;
      if (!part.mirror) for (const key of result.created) created.add(key);
    }
    return { piece: current, created, count, ok };
  }

  /** Bisela la arista entre dos vértices elegidos (con el espejo, también la suya); los cuatro vértices nuevos quedan elegidos para ajustarlos. */
  bevelSelected(): void {
    if (this.busy) return;
    // Todo o nada: primero se prueba en una copia; si algún lado no cabe, no se toca nada (un solo lado biselado rompería la simetría).
    const targets = this.buildTargets();
    const attempt = (size: number) => targets.map((target) => this.bevelParts(target.original, target.parts, size));
    const first = attempt(this.bevelSize);
    if (first.some((r) => !r.ok)) {
      const symmetric = reflections(this.host.symmetry()).length > 0;
      let max = 0;
      if (attempt(0.001).every((r) => r.ok)) {
        let lo = 0.001;
        let hi = this.bevelSize;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (attempt(mid).every((r) => r.ok)) lo = mid;
          else hi = mid;
        }
        max = Math.floor(lo * 100) / 100;
        while (max > 0 && !attempt(max).every((r) => r.ok)) max = Math.round((max - 0.01) * 100) / 100;
      }
      if (max > 0) this.host.status(`Biselar: ese tamaño no cabe${symmetric ? ' con la simetría activa (cada lado recorta el segmento que comparten)' : ''}: prueba con ${max} o menos`);
      else if (first.some((r) => r.count > 0)) this.host.status('Biselar: con la simetría activa esta arista y su espejo se estorban (comparten un extremo): bisélala sin simetría');
      else this.host.status('Biselar: elige los dos vértices de una arista que acaben en esquinas de tres caras, y un tamaño menor que los segmentos vecinos');
      return;
    }
    let done = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      const result = this.bevelParts(piece, parts, this.bevelSize);
      if (result.count === 0) return null;
      done += result.count;
      return { piece: sameId(result.piece, piece), select: result.created.size > 0 ? this.oneSide(result.created, result.piece, piece, parts) : ownKeys(parts) };
    });
    this.host.status(done > 0 ? `Biselar: ${done} arista(s) biseladas (los vértices nuevos quedan elegidos)` : 'Biselar: elige los dos vértices de una arista que acaben en esquinas de tres caras, y un tamaño menor que los segmentos vecinos');
  }

  /** Parte en triángulos las caras de cuatro o más vértices cuyos vértices están todos elegidos (los vértices no se mueven; el contorno de cada cara queda igual). */
  triangulateSelected(): void {
    let split = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      const faces = facesOfParts(piece, parts);
      if (faces.length === 0) return null;
      const result = triangulateFaces(piece, new Set(faces));
      if (!result) return null;
      split += result.split;
      return sameId(result.piece, piece);
    }, keepPosition);
    this.host.status(split > 0 ? `Triangular: ${split} cara(s) partidas en triángulos (para juntarlos: Quitar segmento, Q)` : 'Triangular: elige todos los vértices de una cara con cuatro o más lados');
  }

  /** Extruye las caras cuyos vértices están todos elegidos; los vértices de arriba quedan elegidos para seguir moviéndolos. */
  extrudeSelected(distance = this.growDistance): void {
    let any = false;
    let count = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      const faces = facesOfParts(piece, parts);
      if (faces.length === 0) return null;
      const result = extrudeFaces(piece, new Set(faces), distance);
      if (!result) return null;
      any = true;
      count += faces.length;
      // Quedan elegidos los vértices de arriba de las caras de quien eligió (la cara extruida conserva su posición en la lista), no los del espejo.
      const own = new Set<string>();
      for (const i of facesOfParts(piece, ownParts(parts))) for (const p of result.piece.faces[i]) own.add(vertexKey(p));
      return { piece: sameId(result.piece, piece), select: own.size > 0 ? this.oneSide(own, result.piece, piece, parts) : ownKeys(parts) };
    });
    this.host.status(any ? `Extruir cara: ${count} cara(s) subidas ${+distance.toFixed(3)}; los vértices de arriba quedan elegidos para moverlos` : 'Extruir cara: elige todos los vértices de la cara');
  }

  /**
   * Punta: saca una copia de cada vértice elegido y la une al original con caras nuevas; el original se queda donde estaba. Las copias quedan
   * elegidas (solo las del lado de quien eligió) para jalarlas con el ratón. Con simetría, el espejo saca la suya a la vez.
   */
  tipSelected(distance = this.growDistance): void {
    let tips = 0;
    let faces = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      let current = piece;
      const select = new Set<string>();
      for (const part of parts) {
        const result = tipVertices(current, part.full, distance, piece.faces.length);
        if (!result) continue;
        current = result.piece;
        faces += result.faces;
        if (!part.mirror) for (const key of result.keys) select.add(key);
      }
      if (current === piece) return null;
      tips += select.size;
      return { piece: sameId(current, piece), select: select.size > 0 ? select : ownKeys(parts) };
    });
    this.host.status(
      tips > 0
        ? `Punta: ${tips} copia(s) sacadas ${+distance.toFixed(3)} (${faces} caras nuevas); las copias quedan elegidas: jálalas con el ratón`
        : 'Punta (I): elige vértices que tengan caras para sacar la copia',
    );
  }

  /**
   * Con dos vértices elegidos en una pieza, hace crecer una cara desde ese segmento; los dos vértices nuevos quedan elegidos para moverlos.
   * Con simetría, el espejo hace crecer la suya a la vez: cada grupo (los elegidos y cada espejo) usa sus dos vértices por separado.
   */
  growFaceFromEdge(distance = this.growDistance): void {
    let any = false;
    this.change((piece, _keys, _dirAt, parts) => {
      let current = piece;
      const select = new Set<string>();
      for (const part of parts) {
        const result = extrudeEdge(current, part.full, distance);
        if (!result) continue;
        current = result.piece;
        if (!part.mirror) for (const key of result.keys) select.add(key);
      }
      if (current === piece) return null;
      any = true;
      return { piece: sameId(current, piece), select: select.size > 0 ? this.oneSide(select, current, piece, parts) : ownKeys(parts) };
    });
    this.host.status(any ? `Cara desde segmento: creció ${+distance.toFixed(3)}; mueve los dos vértices nuevos, que quedan elegidos` : 'Cara desde segmento: elige exactamente dos vértices de una pieza');
  }

  /** Con dos vértices elegidos de una misma cara, traza el segmento entre ellos: la cara se parte en dos. Los vértices siguen elegidos. */
  connectSelected(): void {
    let split = 0;
    // Con simetría, `keys` trae los elegidos y también sus imágenes en el espejo (cuatro vértices en una misma cara no se pueden unir de dos en dos
    // sin saber cuáles): cada grupo se une por separado, con sus propios vértices, y la cara se vuelve a mirar tras cada corte.
    this.change((piece, _keys, _dirAt, parts) => {
      let current = piece;
      let here = 0;
      for (const part of parts) {
        const result = connectVertices(current, part.full);
        if (!result) continue;
        current = result.piece;
        here += result.split;
      }
      if (here === 0) return null;
      split += here;
      return { piece: sameId(current, piece), select: ownKeys(parts) };
    });
    this.host.status(
      split > 0
        ? split > 1
          ? `Segmento trazado: ${split} caras partidas (la del espejo también)`
          : 'Segmento trazado: la cara quedó partida en dos'
        : 'No se trazó nada: elige dos vértices de una misma cara que no estén ya unidos por una arista y con el camino libre entre ellos',
    );
  }

  /** Con dos vértices elegidos que forman un segmento entre dos caras del mismo plano, quita el segmento: las dos caras pasan a ser una. */
  dissolveSelected(): void {
    let joined = 0;
    this.change((piece, _keys, _dirAt, parts) => {
      let current = piece;
      let here = 0;
      // Como en Trazar segmento: con simetría, cada grupo (los elegidos y cada espejo) quita su propio segmento.
      for (const part of parts) {
        const result = dissolveEdge(current, part.full);
        if (!result) continue;
        current = result;
        here++;
      }
      if (here === 0) return null;
      joined += here;
      return { piece: sameId(current, piece), select: ownKeys(parts) };
    });
    this.host.status(
      joined > 0
        ? joined > 1
          ? `Segmento quitado: ${joined} pares de caras juntados (el espejo también)`
          : 'Segmento quitado: las dos caras pasan a ser una'
        : 'No se quitó nada: elige los dos vértices de un segmento que separe dos caras del mismo plano (no un borde de la pieza ni un ángulo)',
    );
  }

  /**
   * Con tres o más vértices elegidos, deja rectos los de en medio sobre la línea que une el primero y el último que elegiste
   * (los dos extremos no se mueven; cada uno de los demás va al punto más cercano de esa línea). Con simetría, el espejo se endereza igual.
   */
  straightenSelected(): void {
    const order: Vec3[] = [];
    for (const [id, keys] of this.selection) {
      const piece = this.host.model.get(id);
      if (!piece) continue;
      const positions = new Map(uniqueVertices(piece).map((p) => [vertexKey(p), p] as const));
      for (const key of keys) {
        const p = positions.get(key);
        if (p) order.push(p);
      }
    }
    if (order.length < 3) {
      this.host.status('Elige al menos tres vértices: el primero y el último que elijas marcan la línea, y los de en medio se enderezan sobre ella');
      return;
    }
    const first = order[0];
    const last = order[order.length - 1];
    if (vertexKey(first) === vertexKey(last)) {
      this.host.status('El primer y el último vértice elegidos son el mismo punto: no hay línea. Elige otro como último');
      return;
    }
    let straightened = 0;
    let flattened = false;
    this.change((piece, _keys, _dirAt, parts) => {
      let current = piece;
      const landing = new Map<string, Vec3>();
      for (const part of parts) {
        // Los extremos de cada grupo: los elegidos o, en el espejo, sus imágenes.
        const a = part.mirror ? part.mirror(first) : first;
        const b = part.mirror ? part.mirror(last) : last;
        const result = straightenVertices(current, part.full, a, b);
        if (!result) continue;
        // Una línea que deje la pieza aplastada o atravesada se descarta (como al arrastrar).
        if (!collapses(piece) && collapses(result.piece)) {
          flattened = true;
          continue;
        }
        current = result.piece;
        for (const [key, to] of result.landed) landing.set(key, to);
      }
      if (landing.size === 0) return null;
      straightened += landing.size;
      // La selección sigue a los vértices a su sitio nuevo.
      const select = new Set<string>();
      for (const key of ownKeys(parts)) {
        const to = landing.get(key);
        select.add(to ? vertexKey(to) : key);
      }
      return { piece: sameId(current, piece), select };
    });
    this.host.status(
      straightened > 0
        ? `Vértices alineados: ${straightened} movidos a la línea entre el primero y el último`
        : flattened
          ? 'No se alineó: la línea dejaría la pieza aplastada o atravesada'
          : 'Ya estaban alineados (o no hay vértices de en medio que mover)',
    );
  }

  /**
   * Aplana los vértices elegidos: cada uno va al punto más cercano del plano que mejor se ajusta a todos (sirve para arreglar una cara chueca).
   * Con simetría, el espejo se aplana igual.
   */
  flattenSelected(): void {
    let flattened = 0;
    let crushed = false;
    this.change((piece, _keys, _dirAt, parts) => {
      let current = piece;
      const landing = new Map<string, Vec3>();
      for (const part of parts) {
        const result = flattenVertices(current, part.full);
        if (!result) continue;
        // Un plano que deje la pieza aplastada o atravesada se descarta (como al arrastrar).
        if (!collapses(piece) && collapses(result.piece)) {
          crushed = true;
          continue;
        }
        current = result.piece;
        for (const [key, to] of result.landed) landing.set(key, to);
      }
      if (landing.size === 0) return null;
      flattened += landing.size;
      const select = new Set<string>();
      for (const key of ownKeys(parts)) {
        const to = landing.get(key);
        select.add(to ? vertexKey(to) : key);
      }
      return { piece: sameId(current, piece), select };
    });
    this.host.status(
      flattened > 0
        ? `Vértices aplanados: ${flattened} movidos al plano que mejor les queda`
        : crushed
          ? 'No se aplanó: ese plano dejaría la pieza aplastada o atravesada'
          : 'Nada que aplanar: elige tres o más vértices que no estén ya en un mismo plano ni en una línea',
    );
  }

  /** Cuántas de las caras elegidas (con todos sus vértices elegidos) tienen la propiedad `flag`. */
  faceFlagCount(flag: number): { total: number; on: number } {
    let total = 0;
    let on = 0;
    // `shown` trae una entrada por vértice: cada pieza se cuenta una sola vez.
    for (const piece of new Set(this.shown.map((entry) => entry.piece))) {
      const keys = this.selection.get(piece.id);
      if (!keys) continue;
      for (const i of facesWithin(piece, keys)) {
        total++;
        if ((piece.faceFlags?.[i] ?? 0) & flag) on++;
      }
    }
    return { total, on };
  }

  /** Pone o quita una propiedad (`FACE_DOUBLE`, `FACE_UNLIT`) a las caras cuyos vértices están todos elegidos. */
  setFaceFlag(flag: number, on: boolean): void {
    this.change((piece, _keys, _dirAt, parts) => {
      const faces = facesOfParts(piece, parts);
      const result = faces.length ? setFaceFlags(piece, new Set(faces), flag, on) : null;
      return result ? sameId(result, piece) : null;
    }, keepPosition);
  }

  /** El segmento más cercano al punto de la pantalla (a menos de `EDGE_RADIUS` píxeles y a la vista, salvo que se vean los de atrás). */
  private edgeAt(x: number, y: number): { piece: Piece; a: Vec3; b: Vec3 } | null {
    let best: { piece: Piece; a: Vec3; b: Vec3 } | null = null;
    let bestDistance = EDGE_RADIUS;
    const seen = new Set<number>();
    for (const { piece } of this.shown) {
      if (seen.has(piece.id)) continue;
      seen.add(piece.id);
      for (const { a, b } of pieceEdges(piece)) {
        const sa = this.screenOf(a);
        const sb = this.screenOf(b);
        if (sa.behind || sb.behind) continue;
        const dx = sb.x - sa.x;
        const dy = sb.y - sa.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - sa.x) * dx + (y - sa.y) * dy) / len2));
        const d = Math.hypot(sa.x + dx * t - x, sa.y + dy * t - y);
        if (d >= bestDistance) continue;
        const at: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        if (!this.seeBehind && this.occluded(at)) continue;
        bestDistance = d;
        best = { piece, a, b };
      }
    }
    return best;
  }

  /** Clic sobre un segmento: elige sus dos vértices; segundo clic seguido en el mismo, también todo lo que continúa recto. */
  private clickEdge(x: number, y: number): boolean {
    // Con varias piezas a la vista y ninguna elegida, el clic sigue sirviendo para elegir una pieza (así solo se ven sus vértices); los segmentos se eligen ya dentro de ella.
    if (this.host.selectedPieces().length === 0 && new Set(this.shown.map((entry) => entry.piece.id)).size > 1) return false;
    const edge = this.edgeAt(x, y);
    if (!edge) {
      this.lastEdgeClick = null;
      return false;
    }
    const a = vertexKey(edge.a);
    const b = vertexKey(edge.b);
    const last = this.lastEdgeClick;
    const now = performance.now();
    const again = last !== null && last.id === edge.piece.id && last.a === a && last.b === b && now - last.time < DOUBLE_CLICK_MS;
    this.lastEdgeClick = again ? null : { time: now, a, b, id: edge.piece.id };
    const keys = again ? edgeLoop(edge.piece, edge.a, edge.b) : new Set([a, b]);
    this.selection = new Map([[edge.piece.id, keys]]);
    this.paint();
    this.host.onSelectionChange();
    this.host.status(again ? `Segmento seguido en línea recta: ${keys.size} vértices elegidos` : 'Segmento elegido (doble clic: seguirlo en línea recta)');
    return true;
  }

  /** La cara más cercana bajo el cursor (se cuentan también las vistas por detrás). */
  private faceAt(x: number, y: number): { piece: Piece; index: number; point: THREE.Vector3; distance: number } | null {
    const rect = this.rect();
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.host.camera);
    const point = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let best: { piece: Piece; index: number; point: THREE.Vector3; distance: number } | null = null;
    let bestDistance = Infinity;
    const seen = new Set<number>();
    for (const { piece } of this.shown) {
      if (seen.has(piece.id)) continue;
      seen.add(piece.id);
      piece.faces.forEach((face, index) => {
        for (const [i, j, k] of triangulateFace(face)) {
          a.set(...face[i]);
          b.set(...face[j]);
          c.set(...face[k]);
          if (!raycaster.ray.intersectTriangle(a, b, c, false, point)) continue;
          const d = point.distanceTo(raycaster.ray.origin);
          if (d < bestDistance) {
            bestDistance = d;
            best = { piece, index, point: point.clone(), distance: d };
          }
        }
      });
    }
    return best;
  }

  /** Alt+clic: pone un vértice en la arista más cercana al cursor. */
  /** Añade un vértice donde se hizo clic: en la arista más cercana si hay una a mano y, si no, dentro de la cara apuntada. */
  private addVertexAt(x: number, y: number, precise: boolean): boolean {
    if (this.splitEdgeAt({ clientX: x, clientY: y, ctrlKey: precise, metaKey: false })) return true;
    const face = this.faceAt(x, y);
    if (!face) {
      this.host.status('Apunta a una arista o a una cara de una pieza');
      return false;
    }
    // Con un solo espejo y una cara que es su propia imagen, el punto y su espejo parten la cara a la vez y de forma simétrica.
    const single = reflections(this.host.symmetry());
    if (single.length === 1) {
      const reflection = single[0];
      const corners = face.piece.faces[face.index];
      const cornerKeys = new Set(corners.map((p) => vertexKey(reflection.point(p))));
      if (corners.every((p) => cornerKeys.has(vertexKey(p)))) {
        const pair = addMirrorPairOnFace(face.piece, face.index, [face.point.x, face.point.y, face.point.z], reflection.point);
        if (pair) {
          this.commitVertex(new Map([[face.piece.id, sameId(pair.piece, face.piece)]]), face.piece.id, pair.vertex);
          this.host.status('Vértice añadido en la cara y en su espejo: muévelo para deformar');
          return true;
        }
      }
    }
    const result = addVertexOnFace(face.piece, face.index, [face.point.x, face.point.y, face.point.z]);
    if (!result) {
      this.host.status('Ahí no cabe un vértice: apunta al interior de la cara, lejos de sus aristas');
      return false;
    }
    const edits = new Map<number, Piece>([[face.piece.id, sameId(result.piece, face.piece)]]);
    const images = this.mirrorImages(face.piece);
    // Con simetría, el mismo vértice entra en la cara espejo de cada pieza imagen.
    for (const { reflection, other } of images) {
      const current = edits.get(other.id) ?? other;
      const mirroredCorners = new Set(face.piece.faces[face.index].map((p) => vertexKey(reflection.point(p))));
      const mirroredPoint = reflection.point([face.point.x, face.point.y, face.point.z]);
      const index = current.faces.findIndex((f) => f.length === mirroredCorners.size && f.every((p) => mirroredCorners.has(vertexKey(p))));
      let image = index < 0 ? null : addVertexOnFace(current, index, mirroredPoint);
      if (index < 0) {
        // La cara es su propia imagen (la pieza cruza el plano) y el vértice ya la partió en triángulos: el espejo cae en uno de ellos.
        for (let i = 0; i < current.faces.length && !image; i++) {
          const found = addVertexOnFace(current, i, mirroredPoint);
          if (found && Math.hypot(found.vertex[0] - mirroredPoint[0], found.vertex[1] - mirroredPoint[1], found.vertex[2] - mirroredPoint[2]) < 1e-6) image = found;
        }
      }
      if (image) edits.set(other.id, sameId(image.piece, other));
    }
    // La pieza puede no ser una imagen exacta de sí misma (un vértice a unas milésimas del plano, por ejemplo): el espejo se busca entonces por posición.
    const point: Vec3 = [face.point.x, face.point.y, face.point.z];
    let mirrored = images.length;
    for (const reflection of this.missingReflections(images)) {
      const target = reflection.point(point);
      if (distance3(target, point) < 1e-6) continue;
      for (const piece of this.host.model.editable()) {
        const current = edits.get(piece.id) ?? piece;
        let done = false;
        for (let i = 0; i < current.faces.length && !done; i++) {
          if (planeDistance(current.faces[i], target) > 1e-3) continue;
          const found = addVertexOnFace(current, i, target);
          if (found && distance3(found.vertex, target) < 1e-6) {
            edits.set(piece.id, sameId(found.piece, piece));
            done = true;
            mirrored++;
          }
        }
        if (done) break;
      }
    }
    this.commitVertex(edits, face.piece.id, result.vertex);
    this.host.status(mirrored > 0 ? 'Vértice añadido en la cara y en su espejo: muévelo para deformar' : reflections(this.host.symmetry()).length > 0 ? 'Vértice añadido, pero no se encontró su cara espejo (¿la pieza no es simétrica?)' : 'Vértice añadido en la cara: muévelo para deformar');
    return true;
  }

  /** Los espejos activos que `images` no cubre (porque la pieza no es una imagen exacta de sí misma). */
  private missingReflections(images: { reflection: Reflection }[]): Reflection[] {
    const probe: Vec3 = [0.123, 0.456, 0.789];
    return reflections(this.host.symmetry()).filter((r) => !images.some((i) => distance3(i.reflection.point(probe), r.point(probe)) < 1e-9));
  }

  /** Las piezas que son la imagen en espejo de esta con la simetría activa (puede ser ella misma si es simétrica), con su reflexión. */
  private mirrorImages(piece: Piece): { reflection: Reflection; other: Piece }[] {
    const mirrors = reflections(this.host.symmetry());
    if (mirrors.length === 0) return [];
    const candidates = this.host.model.editable().map((p) => ({ p, key: pieceKey(p) }));
    const out: { reflection: Reflection; other: Piece }[] = [];
    for (const reflection of mirrors) {
      const key = pieceKey(reflectPiece(piece, reflection));
      const found = candidates.find((c) => c.key === key);
      if (found) out.push({ reflection, other: found.p });
    }
    return out;
  }

  /** Aplica las piezas editadas de una sola vez, deja elegido el vértice nuevo de la pieza apuntada y lo anota para deshacer. */
  private commitVertex(edits: Map<number, Piece>, pieceId: number, vertex: Vec3): void {
    const before = cloneSelection(this.selection);
    const removed = [...edits.keys()].map((id) => this.host.model.get(id)).filter((p): p is Piece => !!p);
    this.host.model.apply({ added: [...edits.values()], removed });
    this.selection = new Map([[pieceId, new Set([vertexKey(vertex)])]]);
    this.record(before);
    this.refresh();
  }

  private splitEdgeAt(e: Pick<PointerEvent, 'clientX' | 'clientY' | 'ctrlKey' | 'metaKey'>): boolean {
    let best: { piece: Piece; a: Vec3; b: Vec3; t: number } | null = null;
    let bestDistance = EDGE_RADIUS;
    // Una arista tapada por una cara que está delante del cursor no cuenta: se apunta a lo que se ve.
    const front = this.faceAt(e.clientX, e.clientY)?.distance ?? Infinity;
    const eye = this.host.camera.position;
    const seen = new Set<string>();
    for (const piece of this.shownPieces) {
      for (const face of piece.faces) {
        face.forEach((a, i) => {
          const b = face[(i + 1) % face.length];
          const key = [vertexKey(a), vertexKey(b)].sort().join('>') + piece.id;
          if (seen.has(key)) return;
          seen.add(key);
          const sa = this.screenOf(a);
          const sb = this.screenOf(b);
          if (sa.behind || sb.behind) return;
          const dx = sb.x - sa.x;
          const dy = sb.y - sa.y;
          const length2 = dx * dx + dy * dy;
          if (length2 < 1) return;
          const t = Math.max(0, Math.min(1, ((e.clientX - sa.x) * dx + (e.clientY - sa.y) * dy) / length2));
          const d = Math.hypot(sa.x + dx * t - e.clientX, sa.y + dy * t - e.clientY);
          const along = new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
          if (eye.distanceTo(along) > front + 0.05) return;
          if (d < bestDistance) {
            bestDistance = d;
            best = { piece, a, b, t };
          }
        });
      }
    }
    if (!best) return false;
    const { piece, a, b } = best as { piece: Piece; a: Vec3; b: Vec3; t: number };
    let t = (best as { t: number }).t;
    const free = e.ctrlKey || e.metaKey || this.edgeDivisions === 0;
    if (!free) {
      const n = this.edgeDivisions;
      t = Math.min(1 - 1 / n, Math.max(1 / n, Math.round(t * n) / n));
    } else t = Math.min(0.95, Math.max(0.05, t));
    const result = splitEdge(piece, a, b, t);
    if (!result) return false;
    const edits = new Map<number, Piece>([[piece.id, sameId(result.piece, piece)]]);
    // Con simetría, la arista espejo de cada pieza imagen recibe el vértice en el punto reflejado.
    // (Si la imagen es la propia pieza, su arista espejo puede ser la misma ya partida: eso lo resuelve la búsqueda por posición de abajo.)
    const imagesDone = this.mirrorImages(piece);
    for (const { reflection, other } of imagesDone) {
      if (other.id === piece.id) continue;
      const current = edits.get(other.id) ?? other;
      const image = splitEdge(current, reflection.point(a), reflection.point(b), t);
      if (image) edits.set(other.id, sameId(image.piece, other));
    }
    // Sin pieza imagen exacta, la arista espejo se busca por posición (con unas milésimas de margen).
    for (const reflection of this.missingReflections(imagesDone.filter((i) => i.other.id !== piece.id))) {
      const at: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const want = reflection.point(at);
      if (distance3(want, at) < 1e-6) continue;
      for (const other of this.host.model.editable()) {
        const current = edits.get(other.id) ?? other;
        // Se busca, en la pieza ya editada, la arista que pasa por el punto reflejado (puede ser un tramo de la propia arista recién partida).
        const edge = edgeThrough(current, want);
        if (!edge) continue;
        const image = splitEdge(current, edge.a, edge.b, edge.t);
        if (image) {
          edits.set(other.id, sameId(image.piece, other));
          break;
        }
      }
    }
    this.commitVertex(edits, piece.id, result.vertex);
    return true;
  }

  /**
   * De los vértices que creó una operación, deja los de un solo lado del espejo: cuando un mismo corte atraviesa el plano (un anillo, un bisel
   * que cruza) crea también las imágenes en espejo de los suyos, y dejarlos todos elegidos haría que el siguiente arrastre moviera los dos lados
   * en la misma dirección. De cada pareja se queda el vértice más cercano al centro de lo que se eligió.
   */
  private oneSide(created: Set<string>, made: Piece, original: Piece, parts: Part[]): Set<string> {
    const mirrors = reflections(this.host.symmetry());
    if (mirrors.length === 0 || created.size < 2) return created;
    const chosen = ownKeys(parts);
    const centre: Vec3 = [0, 0, 0];
    let n = 0;
    for (const p of uniqueVertices(original)) {
      if (!chosen.has(vertexKey(p))) continue;
      for (let k = 0; k < 3; k++) centre[k] += p[k];
      n++;
    }
    if (n === 0) return created;
    for (let k = 0; k < 3; k++) centre[k] /= n;
    const kept = new Set<string>();
    for (const p of uniqueVertices(made)) {
      const key = vertexKey(p);
      if (!created.has(key)) continue;
      const mine = distance3(p, centre);
      const loses = mirrors.some((mirror) => {
        const image = mirror.point(p);
        const imageKey = vertexKey(image);
        if (imageKey === key || !created.has(imageKey)) return false;
        const theirs = distance3(image, centre);
        return theirs < mine - 1e-9 || (Math.abs(theirs - mine) <= 1e-9 && imageKey < key);
      });
      if (!loses) kept.add(key);
    }
    return kept.size > 0 ? kept : created;
  }

  /**
   * Aplica una operación sobre cada pieza con vértices elegidos (y sus imágenes en espejo) como un único paso de deshacer.
   * Con `after` la selección sigue a los vértices a su posición nueva; sin él se vacía (fusionar, borrar).
   * La operación devuelve la pieza nueva, `null` si no puede hacer nada con esa pieza (se queda tal cual) o `REMOVE` si la pieza desaparece.
   */
  private change(operation: (piece: Piece, keys: Set<string>, dirAt: (p: Vec3) => (v: Vec3) => Vec3, parts: Part[]) => Piece | { piece: Piece; select: Set<string> } | typeof REMOVE | null, after?: (position: Vec3, dirAt: (p: Vec3) => (v: Vec3) => Vec3) => Vec3): void {
    if (this.busy) return;
    const targets = this.buildTargets();
    if (targets.length === 0) return;
    const before = cloneSelection(this.selection);
    const removed: Piece[] = [];
    const added: Piece[] = [];
    const next: VertexSelection = new Map();
    for (const target of targets) {
      const dirAt = (p: Vec3): ((v: Vec3) => Vec3) => partOf(target, p).dir;
      const outcome = operation(target.original, target.keys, dirAt, target.parts);
      if (outcome === null) {
        // Sin cambios: la pieza y su selección se quedan como están.
        const kept = this.selection.get(target.original.id);
        if (kept) next.set(target.original.id, kept);
        continue;
      }
      removed.push(target.original);
      if (outcome === REMOVE) continue;
      const result = 'select' in outcome ? outcome.piece : outcome;
      added.push(result);
      if ('select' in outcome) {
        // La operación dice qué vértices quedan elegidos (por ejemplo los de la cara recién extruida).
        if (this.selection.has(target.original.id)) next.set(target.original.id, outcome.select);
      } else if (after && this.selection.has(target.original.id)) {
        const chosen = chosenKeys(target);
        next.set(target.original.id, new Set(uniqueVertices(target.original).filter((p) => chosen.has(vertexKey(p))).map((p) => vertexKey(after(p, dirAt)))));
      }
    }
    const depthBefore = this.host.model.undoDepth;
    this.host.model.apply({ added, removed });
    this.selection = next;
    if (this.host.model.undoDepth > depthBefore) this.record(before);
    this.refresh();
  }
}
