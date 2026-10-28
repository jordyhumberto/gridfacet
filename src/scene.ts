import type { Change } from './core/cut';
import type { Piece, Vec3 } from './core/piece';

const markKey = (p: Vec3): string => p.map((v) => Math.round(v * 1e5)).join(',');

/** Estado del modelo, independiente del dibujo, con historial de cambios. */
export class ModelScene {
  private pieces = new Map<number, Piece>();
  private marks = new Map<string, Vec3>();
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];

  /** Se llama con el cambio efectivo cada vez que el contenido se modifica. */
  onChange: (change: Change) => void = () => {};

  get(id: number): Piece | undefined {
    return this.pieces.get(id);
  }

  all(): Piece[] {
    return [...this.pieces.values()];
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
    this.write(change);
    this.undoStack.push(change);
    this.redoStack = [];
  }

  undo(): void {
    const change = this.undoStack.pop();
    if (!change) return;
    this.write({ added: change.removed, removed: change.added, marksAdded: change.marksRemoved, marksRemoved: change.marksAdded });
    this.redoStack.push(change);
  }

  redo(): void {
    const change = this.redoStack.pop();
    if (!change) return;
    this.write(change);
    this.undoStack.push(change);
  }

  private write(change: Change): void {
    for (const piece of change.removed) this.pieces.delete(piece.id);
    for (const piece of change.added) this.pieces.set(piece.id, piece);
    for (const p of change.marksRemoved ?? []) this.marks.delete(markKey(p));
    for (const p of change.marksAdded ?? []) this.marks.set(markKey(p), p);
    this.onChange(change);
  }
}
