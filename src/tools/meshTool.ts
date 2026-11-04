import * as THREE from 'three';
import type { Piece, Vec3 } from '../core/piece';
import { pieceKey, reflectPiece, reflections, type Reflection, type Symmetry } from '../core/symmetry';
import { triangulateFace } from '../core/convex';
import { addFace, deleteFaces, deleteVertices, extrudeFaces, facesWithin, flipFaces, mergeVertices, moveVertices, placeVertices, rotateAbout, scaleAbout, setFaceFlags, splitEdge, addVertexOnFace, taperPoint, twistPoint, bendPoint, uniqueVertices, vertexKey } from '../core/vertices';
import type { ModelScene } from '../scene';

/** Paso de la rejilla de imán, en celdas. */
export const SNAP_STEP = 0.25;
/** Cuánto sube una cara al extruirla (después se afina arrastrando o con las flechas). */
const EXTRUDE_DISTANCE = 0.5;
/** Distancia en pantalla (px) a la que el cursor "agarra" una arista para ponerle un vértice. */
const EDGE_RADIUS = 8;
/** Con Ctrl se empuja con pasos más finos. */
const FINE_STEP = 1 / 16;
/** Distancia en pantalla (px) a la que el cursor "agarra" un vértice. */
const PICK_RADIUS = 12;
/** Con más vértices que estos no se dibujan todos (solo los de la selección). */
const MAX_VISIBLE = 4000;
/** Con imán, el giro avanza de 15° en 15° y la escala de 0,05 en 0,05. */
const ROTATE_STEP = Math.PI / 12;
const SCALE_STEP = 0.05;
/** Píxeles de movimiento horizontal que valen 1 al afinar o torcer. */
const DEFORM_PIXELS = 150;

export type TransformKind = 'rotate' | 'scale' | 'taper' | 'twist' | 'bend';
/** Lo que hay que mover el cursor antes de que un clic pase a ser un arrastre. */
const DRAG_THRESHOLD = 3;

const NORMAL_COLOR = 0xe6e8ee;
const SELECTED_COLOR = 0xffd34d;
const HOVER_COLOR = 0x40e0ff;

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
  /** Se llama cuando cambia la selección de vértices (para refrescar el panel). */
  onSelectionChange: () => void;
}

/** Vértices elegidos por pieza, con las claves de posición. */
type VertexSelection = Map<number, Set<string>>;

/** Una pieza que se mueve en el arrastre: su estado inicial, qué vértices lleva y cómo se transforma el desplazamiento. */
interface Target {
  original: Piece;
  keys: Set<string>;
  /** Dirección del desplazamiento para esta pieza: la identidad, o el reflejo si es la imagen en espejo de la elegida. */
  dir: (v: Vec3) => Vec3;
  /** Reflejo de un punto, si esta pieza es la imagen en espejo de la elegida; sin él, la identidad. */
  mirror?: (p: Vec3) => Vec3;
}

const sameId = (made: Piece, old: Piece): Piece => ({ ...made, id: old.id });
const cloneSelection = (selection: VertexSelection): VertexSelection => new Map([...selection].map(([id, keys]) => [id, new Set(keys)]));
/** Los vértices no se mueven: la selección se queda donde está. */
const keepPosition = (p: Vec3): Vec3 => p;

/** Colores de los ejes X, Y y Z (los de Blender), también en la brújula del visor. */
export const AXIS_COLORS = [0xff4d4d, 0x6fdc4a, 0x4d8dff];
/** Cuánto sobresalen las líneas guía a cada lado del vértice agarrado, en celdas. */
const GUIDE_REACH = 3;

export class MeshTool {
  private selection: VertexSelection = new Map();
  private overlay = new THREE.Group();
  private points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
  /** Tres líneas (X rojo, Y verde, Z azul) que cruzan el vértice agarrado mientras se arrastra; la del eje bloqueado se ve más fuerte. */
  private guide = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
  private shown: { piece: Piece; position: Vec3; key: string }[] = [];
  private hover: { piece: Piece; key: string } | null = null;
  private active = false;
  private marqueeEl: HTMLDivElement | null = null;
  private marquee: { x: number; y: number; add: boolean } | null = null;

  private drag: {
    targets: Target[];
    anchor: Vec3;
    plane: THREE.Plane;
    grab: THREE.Vector3;
    startX: number;
    startY: number;
    moved: boolean;
    delta: Vec3;
  } | null = null;
  /** Eje al que se limita el movimiento (0 X, 1 Y, 2 Z); se mantiene entre arrastres hasta que se cambia. */
  private axisLock: number | null = null;

  /**
   * Qué vértices estaban elegidos antes y después de cada cambio, para devolverlos al deshacer y rehacer
   * (cada entrada va con el número de cambios del modelo que había tras el cambio).
   */
  private history: { depth: number; before: VertexSelection; after: VertexSelection }[] = [];
  private pendingBefore: VertexSelection | null = null;
  /** Con el modo «Añadir vértice», un clic sobre una arista o una cara le pone un vértice nuevo (sin Alt). */
  private adding = false;
  /** Dónde se pulsó en modo añadir: si el ratón no se movió al soltar, es un clic y se añade; si se movió, era girar la cámara. */
  private pendingAdd: { x: number; y: number; ctrl: boolean } | null = null;

  /** Giro o escala en curso: se maneja moviendo el ratón (sin pulsar) y se confirma con un clic o Intro. */
  private modal: {
    kind: TransformKind;
    targets: Target[];
    pivot: Vec3;
    /** Mitad del largo de los vértices elegidos a lo largo de cada eje (para afinar y torcer). */
    half: Vec3;
    axis: number | null;
    /** Posición del cursor al empezar (se fija con el primer movimiento) y lo que valía entonces. */
    start: { x: number; y: number; angle: number; distance: number } | null;
    last: { x: number; y: number; free: boolean } | null;
    value: number;
    moved: boolean;
  } | null = null;

  constructor(private readonly host: MeshToolHost) {
    this.points.renderOrder = 999;
    this.points.frustumCulled = false;
    this.overlay.add(this.points);
    this.guide.renderOrder = 998;
    this.guide.frustumCulled = false;
    this.guide.visible = false;
    this.overlay.add(this.guide);
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

  get isDragging(): boolean {
    return this.drag !== null || this.marquee !== null || this.modal !== null;
  }

  get count(): number {
    let total = 0;
    for (const keys of this.selection.values()) total += keys.size;
    return total;
  }

  get addMode(): boolean {
    return this.adding;
  }

  setAddMode(on: boolean): void {
    this.adding = on;
    this.pendingAdd = null;
    this.host.status(on ? 'Añadir vértice: clic en una arista (en cuartos; Ctrl donde pulses) o en una cara' : 'Añadir vértice desactivado');
    this.host.onSelectionChange();
  }

  get axis(): number | null {
    return this.axisLock;
  }

  /** Limita el movimiento a un eje (o lo suelta con `null`); lo usan los botones del panel y las teclas X/Y/Z. */
  setAxis(axis: number | null): void {
    this.axisLock = axis;
    if (this.drag?.moved) this.showGuide([this.drag.anchor[0] + this.drag.delta[0], this.drag.anchor[1] + this.drag.delta[1], this.drag.anchor[2] + this.drag.delta[2]]);
    this.host.status(axis === null ? 'Movimiento libre' : `Movimiento solo en ${'XYZ'[axis]}`);
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
    this.pendingAdd = null;
    this.active = false;
    this.overlay.visible = false;
    this.selection.clear();
    this.hover = null;
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
      const present = new Set(uniqueVertices(piece).map(vertexKey));
      for (const key of [...keys]) if (!present.has(key)) keys.delete(key);
      if (keys.size === 0) this.selection.delete(id);
    }
    const chosen = this.host.selectedPieces();
    let pieces = (chosen.length > 0 ? chosen : this.host.model.editable()).filter((piece) => !this.host.isHidden(piece));
    pieces = pieces.filter((piece) => !this.host.model.isLocked(piece));
    const shown: typeof this.shown = [];
    for (const piece of pieces) {
      for (const position of uniqueVertices(piece)) shown.push({ piece, position, key: vertexKey(position) });
      if (shown.length > MAX_VISIBLE) break;
    }
    if (shown.length > MAX_VISIBLE) {
      this.host.status('Hay demasiados vértices para mostrarlos todos: elige una pieza con la herramienta Elegir');
      shown.length = 0;
      for (const piece of chosen) for (const position of uniqueVertices(piece)) shown.push({ piece, position, key: vertexKey(position) });
    }
    this.shown = shown;
    this.paint();
    this.host.onSelectionChange();
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
      color.set(AXIS_COLORS[axis]).multiplyScalar(this.axisLock === null ? 0.8 : this.axisLock === axis ? 1 : 0.3);
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
      color.set(hovered ? HOVER_COLOR : selected ? SELECTED_COLOR : NORMAL_COLOR);
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
    let best: { piece: Piece; key: string; position: Vec3 } | null = null;
    let bestDistance = PICK_RADIUS;
    for (const entry of this.shown) {
      const s = this.screenOf(entry.position);
      if (s.behind) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = entry;
      }
    }
    return best;
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

  private down(e: PointerEvent): void {
    if (this.active && this.modal) {
      // Mientras se gira o escala, el clic izquierdo confirma y el derecho cancela.
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.button === 0) this.finishModal(true);
      else if (e.button === 2) this.finishModal(false);
      return;
    }
    if (!this.active || e.button !== 0) return;
    if (e.altKey && !this.vertexAt(e.clientX, e.clientY)) {
      // Alt+clic sobre una arista le pone un vértice nuevo (en cuartos de su largo; Ctrl lo coloca donde se hizo clic).
      if (this.splitEdgeAt(e)) e.stopImmediatePropagation();
      return;
    }
    const hit = this.vertexAt(e.clientX, e.clientY);
    if (this.adding && !hit && !e.shiftKey) {
      // Se anota el clic: al soltar sin haber movido el ratón se añade el vértice; si se arrastró, la cámara gira como siempre.
      this.pendingAdd = { x: e.clientX, y: e.clientY, ctrl: e.ctrlKey || e.metaKey };
    }
    if (!hit && e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      // Shift+clic sobre una cara elige todos sus vértices (se suman a los que ya había).
      const face = this.faceAt(e.clientX, e.clientY);
      if (face) {
        e.stopImmediatePropagation();
        const keys = this.selection.get(face.piece.id) ?? new Set<string>();
        for (const p of face.piece.faces[face.index]) keys.add(vertexKey(p));
        this.selection.set(face.piece.id, keys);
        this.paint();
        this.host.onSelectionChange();
        return;
      }
    }
    if (hit) {
      e.stopImmediatePropagation();
      if (!this.isSelected(hit.piece, hit.key)) this.select(hit.piece, hit.key, e.shiftKey);
      else if (e.shiftKey && this.count > 1) this.selection.get(hit.piece.id)?.delete(hit.key);
      this.paint();
      this.host.onSelectionChange();
      this.beginDrag(e, hit.position);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !this.adding) {
      // Ctrl y arrastrar en vacío dibuja un recuadro que elige todos los vértices que caen dentro, también los de detrás.
      e.stopImmediatePropagation();
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
      targets.push({ original: piece, keys: fresh, dir, mirror });
    };
    for (const [id, keys] of this.selection) {
      const piece = this.host.model.get(id);
      if (piece) add(piece, new Set(keys), identity);
    }
    const mirrors = reflections(this.host.symmetry());
    if (mirrors.length > 0) {
      const chosen = [...targets];
      for (const reflection of mirrors) {
        const images = new Set<string>();
        for (const target of chosen) {
          for (const position of uniqueVertices(target.original)) if (target.keys.has(vertexKey(position))) images.add(vertexKey(reflection.point(position)));
        }
        for (const piece of this.host.model.editable()) {
          const found = new Set(uniqueVertices(piece).map(vertexKey).filter((key) => images.has(key)));
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
      this.modal.last = { x: e.clientX, y: e.clientY, free: e.ctrlKey || e.metaKey };
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
    if (this.axisLock !== null) delta = delta.map((v, i) => (i === this.axisLock ? v : 0)) as Vec3;
    // Con imán la posición final del vértice agarrado cae en la rejilla; Ctrl lo suelta.
    if (!(e.ctrlKey || e.metaKey)) {
      delta = delta.map((v, i) => {
        if (this.axisLock !== null && i !== this.axisLock) return 0;
        return Math.round((drag.anchor[i] + v) / SNAP_STEP) * SNAP_STEP - drag.anchor[i];
      }) as Vec3;
    }
    if (delta.every((v, i) => Math.abs(v - drag.delta[i]) < 1e-9)) return;
    drag.delta = delta;
    this.preview(delta);
  }

  /** Coloca las piezas en su estado inicial más el desplazamiento, sin pasar por el historial. */
  private preview(delta: Vec3): void {
    const drag = this.drag!;
    this.showGuide([drag.anchor[0] + delta[0], drag.anchor[1] + delta[1], drag.anchor[2] + delta[2]]);
    // La selección sigue a los vértices movidos (cambian de clave al cambiar de sitio) antes de avisar al modelo, que la revisa.
    for (const target of drag.targets) {
      if (!this.selection.has(target.original.id)) continue;
      const d = target.dir(delta);
      const moved = new Set<string>();
      for (const position of uniqueVertices(target.original)) {
        if (target.keys.has(vertexKey(position))) moved.add(vertexKey([position[0] + d[0], position[1] + d[1], position[2] + d[2]]));
      }
      this.selection.set(target.original.id, moved);
    }
    const removed: Piece[] = [];
    const added: Piece[] = [];
    for (const target of drag.targets) {
      const current = this.host.model.get(target.original.id);
      const moved = moveVertices(target.original, target.keys, target.dir(delta), true);
      if (current) removed.push(current);
      if (moved) added.push(moved);
    }
    this.host.model.preview({ added, removed });
  }

  private up(e: PointerEvent): void {
    if (!this.active) return;
    if (this.pendingAdd) {
      const { x, y, ctrl } = this.pendingAdd;
      this.pendingAdd = null;
      if (Math.hypot(e.clientX - x, e.clientY - y) < DRAG_THRESHOLD && this.addVertexAt(x, y, ctrl)) e.stopImmediatePropagation();
      return;
    }
    if (this.marquee) {
      e.stopImmediatePropagation();
      this.finishMarquee(e);
      return;
    }
    if (!this.drag) return;
    e.stopImmediatePropagation();
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
    for (const target of drag.targets) {
      const current = this.host.model.get(target.original.id);
      if (current) finals.push(current);
      originals.push(target.original);
    }
    this.host.model.commitPreview({ added: finals, removed: originals });
    if (this.pendingBefore) this.record(this.pendingBefore);
    this.refresh();
  }

  private restore(targets: Target[]): void {
    const removed: Piece[] = [];
    const added: Piece[] = [];
    for (const target of targets) {
      const current = this.host.model.get(target.original.id);
      if (current) removed.push(current);
      added.push(target.original);
      if (this.selection.has(target.original.id)) this.selection.set(target.original.id, new Set(target.keys));
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
    if (!this.drag && this.count > 0 && !e.ctrlKey && !e.metaKey && !e.altKey && (key === 'r' || key === 't')) {
      this.beginTransform(key === 'r' ? 'rotate' : 'scale');
      return true;
    }
    if (this.drag && (key === 'x' || key === 'y' || key === 'z')) {
      const axis = 'xyz'.indexOf(key);
      this.setAxis(this.axisLock === axis ? null : axis);
      return true;
    }
    if (this.drag && key === 'escape') {
      this.finishDrag(false);
      return true;
    }
    if (this.count === 0) return false;
    if (key === 'delete' || key === 'backspace') {
      this.deleteSelected();
      return true;
    }
    const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
    if (key in arrows) {
      this.nudge(arrows[key], e.ctrlKey || e.metaKey ? FINE_STEP : SNAP_STEP);
      return true;
    }
    return false;
  }

  /** Empieza a girar (R) o escalar (T) los vértices elegidos alrededor de su centro; se maneja moviendo el ratón. */
  beginTransform(kind: TransformKind): void {
    if (this.drag || this.modal) return;
    const targets = this.buildTargets();
    if (targets.length === 0) {
      this.host.status('Elige algún vértice para girarlo o escalarlo');
      return;
    }
    // El pivote es el centro de la caja de los vértices elegidos (sin contar las imágenes en espejo).
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const target of targets) {
      if (target.mirror) continue;
      for (const p of uniqueVertices(target.original)) {
        if (!target.keys.has(vertexKey(p))) continue;
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[k]);
          max[k] = Math.max(max[k], p[k]);
        }
      }
    }
    const pivot = [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as Vec3;
    const half = [0, 1, 2].map((k) => (max[k] - min[k]) / 2) as Vec3;
    if ((kind === 'taper' || kind === 'twist' || kind === 'bend') && half.every((h) => h < 1e-6)) {
      this.host.status('Elige vértices que ocupen algo de espacio para afinar, torcer o curvar');
      return;
    }
    this.pendingBefore = cloneSelection(this.selection);
    this.modal = { kind, targets, pivot, half, axis: this.axisLock, start: null, last: null, value: kind === 'scale' ? 1 : 0, moved: false };
    this.host.setOrbit(false);
    const name = { rotate: 'Girar', scale: 'Escalar', taper: 'Afinar', twist: 'Torcer', bend: 'Curvar' }[kind];
    const hint = kind === 'taper' || kind === 'twist' || kind === 'bend' ? 'mueve el ratón a los lados · X/Y/Z cambia el eje (por defecto Y)' : 'mueve el ratón · X/Y/Z fija el eje';
    this.host.status(`${name}: ${hint} · Ctrl sin imán · clic o Intro confirma · Esc cancela`);
  }

  /** Eje de giro: el del mundo elegido, o el más parecido a la dirección de la cámara. */
  private rotationAxis(): Vec3 {
    const modal = this.modal!;
    if (modal.axis !== null) return [0, 1, 2].map((k) => (k === modal.axis ? 1 : 0)) as Vec3;
    const direction = this.host.camera.getWorldDirection(new THREE.Vector3());
    const axis = this.worldAxis(direction);
    return axis;
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
    let map: (p: Vec3) => Vec3;
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
      modal.value = amount;
      const point = { taper: taperPoint, twist: twistPoint, bend: bendPoint }[modal.kind];
      map = (p) => point(p, modal.pivot, axis, half, amount);
      this.host.status(`${{ taper: 'Afinar', twist: 'Torcer', bend: 'Curvar' }[modal.kind]} ${amount >= 0 ? '+' : ''}${amount.toFixed(2)} en ${'XYZ'[axis]}`);
    } else if (modal.kind === 'rotate') {
      const axis = this.rotationAxis();
      const toward = this.host.camera.getWorldDirection(new THREE.Vector3());
      // Si el eje apunta hacia quien mira, el giro positivo se ve en sentido contrario al de las agujas; el cursor se mide al revés.
      const sign = axis[0] * toward.x + axis[1] * toward.y + axis[2] * toward.z < 0 ? -1 : 1;
      let theta = (angle - modal.start.angle) * sign;
      if (!free) theta = Math.round(theta / ROTATE_STEP) * ROTATE_STEP;
      modal.value = theta;
      map = (p) => rotateAbout(p, modal.pivot, axis, theta);
      this.host.status(`Girar ${Math.round((theta * 180) / Math.PI)}°${modal.axis === null ? '' : ' en ' + 'XYZ'[modal.axis]}`);
    } else {
      let factor = distance / modal.start.distance;
      if (!free) factor = Math.round(factor / SCALE_STEP) * SCALE_STEP;
      factor = Math.max(factor, SCALE_STEP);
      modal.value = factor;
      const factors = [0, 1, 2].map((k) => (modal.axis === null || modal.axis === k ? factor : 1)) as Vec3;
      map = (p) => scaleAbout(p, modal.pivot, factors);
      this.host.status(`Escalar ×${factor.toFixed(2)}${modal.axis === null ? '' : ' en ' + 'XYZ'[modal.axis]}`);
    }
    modal.moved = true;
    this.previewMap(modal.targets, map);
  }

  /** Coloca las piezas en su estado inicial con cada vértice elegido llevado por `map` (las imágenes en espejo reciben la transformación reflejada). */
  private previewMap(targets: Target[], map: (p: Vec3) => Vec3): void {
    const placed = (target: Target) => (p: Vec3): Vec3 => (target.mirror ? target.mirror(map(target.mirror(p))) : map(p));
    for (const target of targets) {
      if (!this.selection.has(target.original.id)) continue;
      const to = placed(target);
      this.selection.set(target.original.id, new Set(uniqueVertices(target.original).filter((p) => target.keys.has(vertexKey(p))).map((p) => vertexKey(to(p)))));
    }
    const removed: Piece[] = [];
    const added: Piece[] = [];
    for (const target of targets) {
      const current = this.host.model.get(target.original.id);
      const result = placeVertices(target.original, target.keys, placed(target), true);
      if (current) removed.push(current);
      if (result) added.push(result);
    }
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
    this.host.model.commitPreview({ added: finals, removed: originals });
    if (this.pendingBefore) this.record(this.pendingBefore);
    this.refresh();
    this.host.status({ rotate: 'Giro aplicado', scale: 'Escala aplicada', taper: 'Afinado aplicado', twist: 'Torcido aplicado', bend: 'Curvado aplicado' }[modal.kind]);
  }

  /** Eje del mundo que más se parece a una dirección de pantalla. */
  private worldAxis(direction: THREE.Vector3): Vec3 {
    const abs = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)];
    const axis = abs.indexOf(Math.max(...abs));
    const out: Vec3 = [0, 0, 0];
    out[axis] = Math.sign([direction.x, direction.y, direction.z][axis]) || 1;
    return out;
  }

  /** Empuja los vértices elegidos un paso en la dirección de pantalla dada (derecha/arriba), alineada con un eje del mundo. */
  private nudge([sx, sy]: [number, number], step: number): void {
    const camera = this.host.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    // Desde arriba o abajo la "pantalla arriba" es horizontal; si no, se mueve en altura.
    const vertical = Math.abs(up.y) > 0.5 ? new THREE.Vector3(0, Math.sign(up.y), 0) : up;
    const a = this.worldAxis(right);
    const b = this.worldAxis(vertical);
    const delta: Vec3 = [(a[0] * sx + b[0] * sy) * step, (a[1] * sx + b[1] * sy) * step, (a[2] * sx + b[2] * sy) * step];
    this.change(
      (piece, keys, dir) => moveVertices(piece, keys, dir(delta), true),
      (p, dir) => {
        const d = dir(delta);
        return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
      },
    );
  }

  /** Lleva los vértices elegidos a la rejilla. */
  snapToGrid(): void {
    const onGrid = (p: Vec3): Vec3 => p.map((v) => Math.round(v / SNAP_STEP) * SNAP_STEP) as Vec3;
    this.change((piece, keys) => placeVertices(piece, keys, onGrid, true), onGrid);
  }

  mergeSelected(): void {
    if (this.count < 2) {
      this.host.status('Elige al menos dos vértices de la misma pieza para fusionarlos');
      return;
    }
    this.change((piece, keys) => {
      const merged = mergeVertices(piece, keys);
      return merged ? sameId(merged, piece) : null;
    });
  }

  deleteSelected(): void {
    this.change((piece, keys) => {
      const result = deleteVertices(piece, keys);
      return result ? sameId(result, piece) : null;
    });
  }

  /** Crea una cara con los vértices elegidos de cada pieza. */
  createFace(): void {
    if (this.count < 3) {
      this.host.status('Elige al menos tres vértices de la misma pieza para crear una cara');
      return;
    }
    this.change((piece, keys) => {
      const result = addFace(piece, keys);
      return result ? sameId(result, piece) : null;
    }, keepPosition);
  }

  /** Quita las caras cuyos vértices están todos elegidos. */
  deleteFacesSelected(): void {
    let any = false;
    this.change((piece, keys) => {
      const faces = facesWithin(piece, keys);
      if (faces.length === 0) return null;
      any = true;
      const result = deleteFaces(piece, new Set(faces));
      return result ? sameId(result, piece) : null;
    }, keepPosition);
    if (!any) this.host.status('Elige todos los vértices de una cara para borrarla');
  }

  /** Da la vuelta a las caras cuyos vértices están todos elegidos. */
  flipSelected(): void {
    let any = false;
    this.change((piece, keys) => {
      const faces = facesWithin(piece, keys);
      if (faces.length === 0) return null;
      any = true;
      const result = flipFaces(piece, new Set(faces));
      return result ? sameId(result, piece) : null;
    }, keepPosition);
    if (!any) this.host.status('Elige todos los vértices de una cara para invertirla');
  }

  /** Extruye las caras cuyos vértices están todos elegidos; los vértices de arriba quedan elegidos para seguir moviéndolos. */
  extrudeSelected(distance = EXTRUDE_DISTANCE): void {
    let any = false;
    this.change((piece, keys) => {
      const faces = facesWithin(piece, keys);
      if (faces.length === 0) return null;
      const result = extrudeFaces(piece, new Set(faces), distance);
      if (!result) return null;
      any = true;
      return { piece: sameId(result.piece, piece), select: result.keys };
    });
    if (!any) this.host.status('Elige todos los vértices de una cara para extruirla');
  }

  /** Cuántas de las caras elegidas (con todos sus vértices elegidos) tienen la propiedad `flag`. */
  faceFlagCount(flag: number): { total: number; on: number } {
    let total = 0;
    let on = 0;
    for (const { piece } of this.shown) {
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
    this.change((piece, keys) => {
      const faces = facesWithin(piece, keys);
      const result = faces.length ? setFaceFlags(piece, new Set(faces), flag, on) : null;
      return result ? sameId(result, piece) : null;
    }, keepPosition);
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
      const index = current.faces.findIndex((f) => f.length === mirroredCorners.size && f.every((p) => mirroredCorners.has(vertexKey(p))));
      if (index < 0) continue;
      const image = addVertexOnFace(current, index, reflection.point([face.point.x, face.point.y, face.point.z]));
      if (image) edits.set(other.id, sameId(image.piece, other));
    }
    this.commitVertex(edits, face.piece.id, result.vertex);
    this.host.status(images.length > 0 ? 'Vértice añadido en la cara y en su espejo: muévelo para deformar' : 'Vértice añadido en la cara: muévelo para deformar');
    return true;
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
    for (const { piece } of this.shown) {
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
    if (!(e.ctrlKey || e.metaKey)) t = Math.min(0.75, Math.max(0.25, Math.round(t * 4) / 4));
    else t = Math.min(0.95, Math.max(0.05, t));
    const result = splitEdge(piece, a, b, t);
    if (!result) return false;
    const edits = new Map<number, Piece>([[piece.id, sameId(result.piece, piece)]]);
    // Con simetría, la arista espejo de cada pieza imagen recibe el vértice en el punto reflejado.
    for (const { reflection, other } of this.mirrorImages(piece)) {
      const current = edits.get(other.id) ?? other;
      const image = splitEdge(current, reflection.point(a), reflection.point(b), t);
      if (image) edits.set(other.id, sameId(image.piece, other));
    }
    this.commitVertex(edits, piece.id, result.vertex);
    return true;
  }

  /**
   * Aplica una operación sobre cada pieza con vértices elegidos (y sus imágenes en espejo) como un único paso de deshacer.
   * Con `after` la selección sigue a los vértices a su posición nueva; sin él se vacía (fusionar, borrar).
   */
  private change(operation: (piece: Piece, keys: Set<string>, dir: (v: Vec3) => Vec3) => Piece | { piece: Piece; select: Set<string> } | null, after?: (position: Vec3, dir: (v: Vec3) => Vec3) => Vec3): void {
    const targets = this.buildTargets();
    if (targets.length === 0) return;
    const before = cloneSelection(this.selection);
    const removed: Piece[] = [];
    const added: Piece[] = [];
    const next: VertexSelection = new Map();
    for (const target of targets) {
      const outcome = operation(target.original, target.keys, target.dir);
      removed.push(target.original);
      if (!outcome) continue;
      const result = 'select' in outcome ? outcome.piece : outcome;
      added.push(result);
      if ('select' in outcome) {
        // La operación dice qué vértices quedan elegidos (por ejemplo los de la cara recién extruida).
        if (this.selection.has(target.original.id)) next.set(target.original.id, outcome.select);
      } else if (after && this.selection.has(target.original.id)) {
        next.set(target.original.id, new Set(uniqueVertices(target.original).filter((p) => target.keys.has(vertexKey(p))).map((p) => vertexKey(after(p, target.dir)))));
      }
    }
    const depthBefore = this.host.model.undoDepth;
    this.host.model.apply({ added, removed });
    this.selection = next;
    if (this.host.model.undoDepth > depthBefore) this.record(before);
    this.refresh();
  }
}
