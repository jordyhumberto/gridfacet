/** Conjunto de piezas elegidas, por id. Es estado de edición, no forma parte del proyecto guardado. */
export class Selection {
  private ids = new Set<number>();

  /** Dice si una pieza se puede elegir (las de capas bloqueadas no). Se aplica en toda vía: clic, recuadro, todo, conectadas. */
  canSelect: (id: number) => boolean = () => true;

  /** Se llama cada vez que cambia el conjunto. */
  onChange: () => void = () => {};

  get size(): number {
    return this.ids.size;
  }

  has(id: number): boolean {
    return this.ids.has(id);
  }

  list(): number[] {
    return [...this.ids];
  }

  set(ids: Iterable<number>): void {
    this.ids = new Set([...ids].filter((id) => this.canSelect(id)));
    this.onChange();
  }

  toggle(id: number): void {
    if (!this.ids.delete(id) && this.canSelect(id)) this.ids.add(id);
    this.onChange();
  }

  clear(): void {
    if (this.ids.size === 0) return;
    this.ids.clear();
    this.onChange();
  }

  /** Quita de la selección las piezas que ya no existen. */
  remove(ids: Iterable<number>): void {
    let changed = false;
    for (const id of ids) changed = this.ids.delete(id) || changed;
    if (changed) this.onChange();
  }
}
