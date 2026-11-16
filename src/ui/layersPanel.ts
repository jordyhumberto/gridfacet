import { Layers, layerOf } from '../core/layers';
import { withGroup, withLayer, type Piece } from '../core/piece';
import type { ModelScene } from '../scene';
import type { Selection } from '../selection';

/** Lo que el panel de capas, las piezas ocultas y la lista de grupos necesitan de la aplicación. */
export interface LayersHost {
  model: ModelScene;
  selection: Selection;
  batches: { add(piece: Piece): void; remove(id: number): void };
  textureLayer: { add(piece: Piece): void; remove(id: number): void };
  selectedPieces(): Piece[];
  /** Cambia a la herramienta Elegir (al elegir un grupo de la lista). */
  selectTool(): void;
  /** Un cambio de capas cuenta como cambio sin guardar. */
  markEdited(): void;
  scheduleAutosave(): void;
}

export interface LayersPanel {
  readonly layers: Layers;
  /** Piezas ocultas: no se dibujan ni se pueden apuntar; siguen en el modelo (y en la exportación). */
  readonly hidden: Set<number>;
  showPiece(piece: Piece): void;
  hidePieces(ids: number[]): void;
  showHidden(ids?: number[]): void;
  hideSelected(): void;
  isolateSelected(): void;
  /** Aplica a las piezas el estado de las capas: las de capas ocultas se esconden y las de bloqueadas dejan de estar elegidas. */
  applyLayerState(): void;
  refreshLayers(): void;
  refreshGroups(): void;
  /** Campo de nombre y botón «A la capa activa»: aparecen según la selección. */
  syncSelection(): void;
}

/** Piezas ocultas, capas y lista de grupos. */
export function createLayersPanel(host: LayersHost): LayersPanel {
  const { model, selection, batches, textureLayer } = host;

  // Piezas ocultas: no se dibujan ni se pueden apuntar; siguen en el modelo (y en la exportación).
  const hidden = new Set<number>();
  function showPiece(piece: Piece): void {
    if (!hidden.has(piece.id)) batches.add(piece);
  }
  function hidePieces(ids: number[]): void {
    for (const id of ids) hidden.add(id);
    selection.remove(ids);
    for (const id of ids) {
      batches.remove(id);
      textureLayer.remove(id);
    }
    refreshHidden();
  }
  function showHidden(ids: number[] = [...hidden]): void {
    for (const id of ids) {
      hidden.delete(id);
      const piece = model.get(id);
      if (piece && !selection.has(id)) batches.add(piece);
      if (piece) textureLayer.add(piece);
    }
    refreshHidden();
  }
  const showHiddenButton = document.getElementById('showHidden')!;
  function refreshHidden(): void {
    showHiddenButton.hidden = hidden.size === 0;
    showHiddenButton.textContent = `Mostrar ocultas (${hidden.size})`;
    refreshGroups();
  }
  showHiddenButton.addEventListener('click', () => {
    // "Mostrar ocultas" también muestra las capas ocultas.
    for (const layer of layers.all()) layers.setHidden(layer.id, false);
    showHidden();
  });

  // Capas: cada pieza está en una; una capa se oculta (no se ve ni se apunta) o se bloquea (se ve y choca, pero no se modifica).
  const layers = new Layers();
  model.isLocked = (piece) => layers.isLocked(piece);
  selection.canSelect = (id) => {
    const piece = model.get(id);
    return !piece || !layers.isLocked(piece);
  };
  const layerListEl = document.getElementById('layerList')!;
  const layerMoveEl = document.getElementById('layerMove')!;
  const idsOfLayer = (id: number): number[] => model.all().filter((piece) => layerOf(piece) === id).map((piece) => piece.id);

  function applyLayerState(): void {
    for (const layer of layers.all()) {
      const ids = idsOfLayer(layer.id);
      if (layer.hidden) hidePieces(ids.filter((id) => !hidden.has(id)));
      if (layer.locked) selection.remove(ids);
    }
  }
  /** Un cambio de capas (crear, renombrar, ocultar, bloquear, quitar) cuenta como cambio sin guardar; elegir la capa activa no. */
  function markLayersEdited(): void {
    host.markEdited();
  }
  function toggleLayerHidden(id: number): void {
    const layer = layers.get(id);
    if (!layer) return;
    markLayersEdited();
    layers.setHidden(id, !layer.hidden);
    if (layer.hidden) applyLayerState();
    else showHidden(idsOfLayer(id).filter((pid) => hidden.has(pid)));
  }
  function toggleLayerLocked(id: number): void {
    const layer = layers.get(id);
    if (!layer) return;
    markLayersEdited();
    layers.setLocked(id, !layer.locked);
    applyLayerState();
  }
  function removeLayer(id: number): void {
    const layer = layers.get(id);
    if (!layer || id === 1) return;
    // Sus piezas pasan a la primera capa, como un cambio más del modelo (se puede deshacer y marca «sin guardar»).
    const moved = model.all().filter((piece) => layerOf(piece) === id);
    const wasHidden = layer.hidden;
    layers.remove(id);
    model.activeLayer = layers.active;
    if (moved.length > 0) {
      const added = moved.map((piece) => withLayer(piece, 1));
      model.apply({ added, removed: moved });
      if (wasHidden) showHidden(added.map((piece) => piece.id).filter((pid) => hidden.has(pid)));
    }
    markLayersEdited();
    applyLayerState();
  }
  /** Pasa las piezas elegidas a la capa activa. */
  function moveSelectionToActiveLayer(): void {
    const target = layers.active;
    // Como un cambio más (piezas nuevas), para poder deshacerlo.
    const removed = selection.list().map((id) => model.get(id)).filter((piece): piece is Piece => !!piece && layerOf(piece) !== target);
    if (removed.length === 0) return;
    const added = removed.map((piece) => withLayer(piece, target));
    model.apply({ added, removed });
    selection.set(added.map((piece) => piece.id));
    applyLayerState();
    refreshLayers();
  }
  function refreshLayers(): void {
    const counts = new Map<number, number>();
    for (const piece of model.all()) counts.set(layerOf(piece), (counts.get(layerOf(piece)) ?? 0) + 1);
    layerListEl.replaceChildren();
    for (const layer of layers.all()) {
      const row = document.createElement('div');
      row.className = `lrow${layer.id === layers.active ? ' active' : ''}${layer.hidden ? ' off' : ''}`;
      const name = document.createElement('button');
      name.className = 'lname';
      name.textContent = `${layer.name} (${counts.get(layer.id) ?? 0})`;
      name.title = 'Capa activa: lo que coloques o crees va aquí. Doble clic: renombrar';
      name.addEventListener('click', () => layers.setActive(layer.id));
      name.addEventListener('dblclick', () => {
        const next = window.prompt('Nombre de la capa', layer.name);
        if (next !== null) {
          layers.rename(layer.id, next);
          markLayersEdited();
        }
      });
      const eye = document.createElement('button');
      eye.className = `tool${layer.hidden ? ' on' : ''}`;
      eye.textContent = layer.hidden ? 'Oculta' : 'Ojo';
      eye.title = layer.hidden ? 'Mostrar la capa' : 'Ocultar la capa';
      eye.addEventListener('click', () => toggleLayerHidden(layer.id));
      const lock = document.createElement('button');
      lock.className = `tool${layer.locked ? ' on' : ''}`;
      lock.textContent = layer.locked ? 'Bloq.' : 'Candado';
      lock.title = layer.locked ? 'Desbloquear la capa' : 'Bloquear la capa: se ve y choca, pero no se puede modificar';
      lock.addEventListener('click', () => toggleLayerLocked(layer.id));
      row.append(name, eye, lock);
      if (layer.id !== 1) {
        const del = document.createElement('button');
        del.className = 'tool';
        del.textContent = '✕';
        del.title = 'Quitar la capa (sus piezas pasan a la primera)';
        del.addEventListener('click', () => removeLayer(layer.id));
        row.append(del);
      }
      layerListEl.appendChild(row);
    }
    layerMoveEl.hidden = selection.size === 0;
  }
  layers.onChange = () => {
    model.activeLayer = layers.active;
    refreshLayers();
    host.scheduleAutosave();
  };
  document.getElementById('layerAdd')!.addEventListener('click', () => {
    layers.add();
    markLayersEdited();
  });
  layerMoveEl.addEventListener('click', moveSelectionToActiveLayer);
  refreshLayers();
  function hideSelected(): void {
    if (selection.size > 0) hidePieces(selection.list());
  }
  function isolateSelected(): void {
    if (selection.size === 0) {
      if (hidden.size > 0) showHidden();
      return;
    }
    hidePieces(model.all().filter((piece) => !selection.has(piece.id)).map((piece) => piece.id));
  }

  // Lista de grupos: elegir, ocultar o mostrar cada uno y darle nombre.
  const groupsEl = document.getElementById('groups')!;
  const groupListEl = document.getElementById('groupList')!;
  const groupNameRow = document.getElementById('groupName')!;
  const groupNameInput = document.getElementById('groupNameInput') as HTMLInputElement;
  function refreshGroups(): void {
    const groups = new Map<number, { name: string; ids: number[] }>();
    for (const piece of model.all()) {
      if (piece.group === undefined) continue;
      const entry = groups.get(piece.group) ?? { name: piece.groupName ?? `Grupo ${piece.group}`, ids: [] };
      entry.ids.push(piece.id);
      groups.set(piece.group, entry);
    }
    groupsEl.hidden = groups.size === 0;
    groupListEl.replaceChildren();
    for (const [group, entry] of groups) {
      const isHidden = entry.ids.every((id) => hidden.has(id));
      const row = document.createElement('div');
      row.className = `grow${isHidden ? ' hiddenGroup' : ''}`;
      const pick = document.createElement('button');
      pick.textContent = `${entry.name} (${entry.ids.length})`;
      pick.title = 'Elegir el grupo';
      pick.addEventListener('click', () => {
        if (isHidden) showHidden(entry.ids);
        host.selectTool();
        selection.set(entry.ids);
      });
      const eye = document.createElement('button');
      eye.textContent = isHidden ? 'Mostrar' : 'Ocultar';
      eye.title = isHidden ? 'Mostrar el grupo' : 'Ocultar el grupo';
      eye.addEventListener('click', () => (isHidden ? showHidden(entry.ids) : hidePieces(entry.ids)));
      row.append(pick, eye);
      row.dataset.group = String(group);
      groupListEl.appendChild(row);
    }
  }

  /** Campo de nombre: aparece cuando la selección es justo un grupo. */
  function selectedGroup(): { group: number; pieces: Piece[] } | null {
    const pieces = host.selectedPieces();
    const group = pieces[0]?.group;
    if (group === undefined || pieces.some((piece) => piece.group !== group)) return null;
    return { group, pieces: model.all().filter((piece) => piece.group === group) };
  }
  function syncGroupName(): void {
    const found = selectedGroup();
    groupNameRow.hidden = !found;
    if (found && document.activeElement !== groupNameInput) groupNameInput.value = found.pieces[0].groupName ?? '';
  }
  groupNameInput.addEventListener('change', () => {
    const found = selectedGroup();
    if (!found) return;
    const name = groupNameInput.value.trim();
    const added = found.pieces.map((piece) => withGroup(piece, found.group, name || undefined));
    model.apply({ added, removed: found.pieces });
    selection.set(added.map((piece) => piece.id));
    groupNameInput.blur();
  });

  return {
    layers,
    hidden,
    showPiece,
    hidePieces,
    showHidden,
    hideSelected,
    isolateSelected,
    applyLayerState,
    refreshLayers,
    refreshGroups,
    syncSelection: () => {
      syncGroupName();
      layerMoveEl.hidden = selection.size === 0;
    },
  };
}
