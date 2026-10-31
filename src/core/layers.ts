import type { Piece } from './piece';

/** Capa por defecto: las piezas sin capa propia pertenecen a ella. */
export const BASE_LAYER = 1;

export interface Layer {
  id: number;
  name: string;
  /** Oculta: no se dibuja ni se apunta, pero sigue en el modelo y en la exportación. */
  hidden: boolean;
  /** Bloqueada: se ve y las demás piezas chocan con ella y se imantan a sus vértices, pero no se puede elegir ni modificar. */
  locked: boolean;
}

/** La capa de una pieza (la primera si no tiene). */
export const layerOf = (piece: Piece): number => piece.layer ?? BASE_LAYER;

/**
 * Las capas del proyecto y cuál está activa (donde van las piezas nuevas).
 * No sabe de piezas: solo lleva la lista; quien la usa aplica lo que significa cada interruptor.
 */
export class Layers {
  private list: Layer[] = [{ id: BASE_LAYER, name: 'Capa 1', hidden: false, locked: false }];
  private nextId = BASE_LAYER + 1;
  active = BASE_LAYER;

  /** Se llama al cambiar algo de las capas (lista, nombres, interruptores o capa activa). */
  onChange: () => void = () => {};

  all(): Layer[] {
    return this.list;
  }

  get(id: number): Layer | undefined {
    return this.list.find((layer) => layer.id === id);
  }

  /** Una pieza oculta por su capa. */
  isHidden(piece: Piece): boolean {
    return this.get(layerOf(piece))?.hidden ?? false;
  }

  /** Una pieza bloqueada por su capa. */
  isLocked(piece: Piece): boolean {
    return this.get(layerOf(piece))?.locked ?? false;
  }

  add(name?: string): Layer {
    const layer: Layer = { id: this.nextId++, name: name?.trim() || `Capa ${this.list.length + 1}`, hidden: false, locked: false };
    this.list.push(layer);
    this.active = layer.id;
    this.onChange();
    return layer;
  }

  rename(id: number, name: string): void {
    const layer = this.get(id);
    const clean = name.trim().slice(0, 40);
    if (!layer || !clean || layer.name === clean) return;
    layer.name = clean;
    this.onChange();
  }

  setHidden(id: number, hidden: boolean): void {
    const layer = this.get(id);
    if (!layer || layer.hidden === hidden) return;
    layer.hidden = hidden;
    this.onChange();
  }

  setLocked(id: number, locked: boolean): void {
    const layer = this.get(id);
    if (!layer || layer.locked === locked) return;
    layer.locked = locked;
    this.onChange();
  }

  setActive(id: number): void {
    if (!this.get(id) || this.active === id) return;
    this.active = id;
    this.onChange();
  }

  /** Quita una capa (la base no se puede quitar). Devuelve false si no se pudo. La capa activa pasa a la base. */
  remove(id: number): boolean {
    if (id === BASE_LAYER || !this.get(id)) return false;
    this.list = this.list.filter((layer) => layer.id !== id);
    if (this.active === id) this.active = BASE_LAYER;
    this.onChange();
    return true;
  }

  /** Estado para guardar en el proyecto. */
  toJSON(): { layers: Layer[]; active: number } {
    return { layers: this.list.map((layer) => ({ ...layer })), active: this.active };
  }

  /** Repone las capas guardadas (siempre queda la base). Con datos no válidos se queda con la capa base. */
  load(data: { layers?: Partial<Layer>[]; active?: number } | undefined, pieces: Piece[] = []): void {
    const list: Layer[] = [];
    for (const raw of data?.layers ?? []) {
      if (!Number.isInteger(raw.id) || (raw.id as number) < 1 || list.some((l) => l.id === raw.id)) continue;
      list.push({ id: raw.id as number, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : `Capa ${raw.id}`, hidden: raw.hidden === true, locked: raw.locked === true });
    }
    if (!list.some((layer) => layer.id === BASE_LAYER)) list.unshift({ id: BASE_LAYER, name: 'Capa 1', hidden: false, locked: false });
    // Una pieza con una capa que ya no existe vuelve a la base.
    for (const piece of pieces) if (piece.layer !== undefined && !list.some((layer) => layer.id === piece.layer)) delete piece.layer;
    this.list = list;
    this.nextId = Math.max(...list.map((layer) => layer.id)) + 1;
    this.active = list.some((layer) => layer.id === data?.active) ? (data!.active as number) : BASE_LAYER;
    this.onChange();
  }
}
