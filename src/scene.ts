import { vertexKey } from './core/key';
import type { Change } from './core/cut';
import type { Piece, Vec3 } from './core/piece';

const markKey = vertexKey;

/** ¿Es la misma pieza con la misma forma y los mismos colores y propiedades por cara? (Las texturas solo se miran por referencia.) */
function sameGeometry(a: Piece, b: Piece): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.color !== b.color || a.faces.length !== b.faces.length || a.group !== b.group || a.layer !== b.layer) return false;
  if (a.faceTextures !== b.faceTextures && JSON.stringify(a.faceTextures?.map((t) => t !== null)) !== JSON.stringify(b.faceTextures?.map((t) => t !== null))) return false;
  if (JSON.stringify(a.faceColors) !== JSON.stringify(b.faceColors) || JSON.stringify(a.faceFlags) !== JSON.stringify(b.faceFlags)) return false;
  const sa = a.segments ?? [];
  const sb = b.segments ?? [];
  if (sa.length !== sb.length || !sa.every(([p, q], i) => p.every((v, k) => v === sb[i][0][k]) && q.every((v, k) => v === sb[i][1][k]))) return false;
  return a.faces.every((face, i) => face.length === b.faces[i].length && face.every((p, k) => p[0] === b.faces[i][k][0] && p[1] === b.faces[i][k][1] && p[2] === b.faces[i][k][2]));
}

/** Estado del modelo, independiente del dibujo, con historial de cambios. */
export class ModelScene {
  private pieces = new Map<number, Piece>();
  private marks = new Map<string, Vec3>();
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];

  /** Cuántos cambios se pueden deshacer y rehacer ahora. */
  get undoDepth(): number {
    return this.undoStack.length;
  }
  get redoDepth(): number {
    return this.redoStack.length;
  }
  /** Sube con cada cambio nuevo (no al deshacer ni rehacer): sirve para saber si lo rehacible sigue valiendo. */
  serial = 0;

  /** Capa en la que quedan las piezas nuevas que no traen una (la activa del panel). */
  activeLayer = 1;
  /** Dice si una pieza está bloqueada: se ve y cuenta para choques e imanes, pero las herramientas de edición no la tocan. */
  isLocked: (piece: Piece) => boolean = () => false;

  /** Se llama cuando termina un deshacer o un rehacer (con el historial ya en su sitio). */
  onHistory: (kind: 'undo' | 'redo') => void = () => {};

  private listeners: Array<(change: Change) => void> = [];

  /**
   * Se llama con el cambio efectivo cada vez que el contenido se modifica, en el orden en que se suscribieron
   * (`first` pone al suscriptor delante de los demás). Devuelve la función que lo da de baja.
   */
  subscribe(listener: (change: Change) => void, first = false): () => void {
    if (first) this.listeners.unshift(listener);
    else this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== listener);
    };
  }

  get(id: number): Piece | undefined {
    return this.pieces.get(id);
  }

  all(): Piece[] {
    return [...this.pieces.values()];
  }

  /** Las piezas que se pueden modificar (las de capas no bloqueadas). */
  editable(): Piece[] {
    return this.all().filter((piece) => !this.isLocked(piece));
  }

  /** Puntos de referencia: vértices sueltos que se pueden usar al marcar puntos. */
  points(): Vec3[] {
    return [...this.marks.values()];
  }

  apply(change: Change): void {
    // Solo cuenta lo que de verdad cambia: puntos nuevos que no existían y puntos quitados que sí.
    const effective: Change = {
      ...change,
      marksAdded: (change.marksAdded ?? []).filter((p) => !this.marks.has(markKey(p))),
      marksRemoved: (change.marksRemoved ?? []).filter((p) => this.marks.has(markKey(p))),
    };
    if (effective.added.length === 0 && effective.removed.length === 0 && effective.marksAdded!.length === 0 && effective.marksRemoved!.length === 0) return;
    change = effective;
    // Solo las piezas nuevas de verdad caen en la capa activa: las derivadas de otra (hay `removed`) conservan la suya, aunque sea la 1 (sin valor).
    if (change.removed.length === 0) for (const piece of change.added) if (piece.layer === undefined && this.activeLayer !== 1) piece.layer = this.activeLayer;
    this.write(change);
    this.undoStack.push(change);
    this.redoStack = [];
    this.serial++;
  }

  /**
   * Cambia piezas sin tocar el historial: para vistas previas mientras se arrastra algo (las piezas conservan el id).
   * Al terminar se registra con `commitPreview`, pasando las piezas de antes y las de después.
   */
  preview(change: Change): void {
    this.write(change);
  }

  /** Anota en el historial un cambio ya aplicado con `preview`, como un único paso de deshacer. */
  commitPreview(change: Change): void {
    // Una pieza que se quedó igual que estaba (un arrastre sin desplazamiento, por imán, eje bloqueado o tope) no es un cambio: no se anota,
    // y así no hay un paso de deshacer vacío que además borre lo rehacible.
    const unchanged = new Set(change.added.filter((piece) => change.removed.some((old) => sameGeometry(piece, old))).map((piece) => piece.id));
    if (unchanged.size > 0) change = { ...change, added: change.added.filter((p) => !unchanged.has(p.id)), removed: change.removed.filter((p) => !unchanged.has(p.id)) };
    if (change.added.length === 0 && change.removed.length === 0) return;
    this.undoStack.push(change);
    this.redoStack = [];
    this.serial++;
  }

  /** Olvida todo lo que se podía deshacer y rehacer (al abrir otro proyecto, por ejemplo). */
  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.serial++;
  }

  undo(): void {
    const change = this.undoStack.pop();
    if (!change) return;
    this.write({ added: change.removed, removed: change.added, marksAdded: change.marksRemoved, marksRemoved: change.marksAdded });
    this.redoStack.push(change);
    this.onHistory('undo');
  }

  redo(): void {
    const change = this.redoStack.pop();
    if (!change) return;
    this.write(change);
    this.undoStack.push(change);
    this.onHistory('redo');
  }

  private write(change: Change): void {
    for (const piece of change.removed) this.pieces.delete(piece.id);
    for (const piece of change.added) this.pieces.set(piece.id, piece);
    for (const p of change.marksRemoved ?? []) this.marks.delete(markKey(p));
    for (const p of change.marksAdded ?? []) this.marks.set(markKey(p), p);
    for (const listener of [...this.listeners]) listener(change);
  }
}
