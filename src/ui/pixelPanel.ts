import * as THREE from 'three';
import { facesAt } from '../core/paint';
import type { BrushOptions, PixelEdit, Rect } from '../core/pixels';
import { copyRegion, editRegion, paintCell, pasteRegion, pixelClipboard, rectBetween, texelAt, textureOfFace, visibleColor, withFaceTexture } from '../core/pixels';
import { faceCentre, faceColorOf, type Piece, type Vec3 } from '../core/piece';
import { reflections, type Symmetry } from '../core/symmetry';
import { pointOf, type FaceTexture } from '../core/texture';
import type { ModelScene } from '../scene';
import { FaceEditor } from '../tools/faceEditor';
import { iconSvg } from './paintIcons';

/** La cara de una pieza bajo el puntero. */
export interface PixelFaceHit {
  piece: Piece;
  face: Vec3[];
  normal: Vec3;
  point: THREE.Vector3;
}

/** Lo que la pintura de píxeles necesita de la aplicación. */
export interface PixelHost {
  scene3d: THREE.Scene;
  renderer: { domElement: HTMLCanvasElement };
  controls: { enabled: boolean };
  model: ModelScene;
  statusEl: HTMLElement;
  textureLayer: { add(piece: Piece): void; preview(piece: Piece, faceIndex: number, texture: FaceTexture): void };
  /** Piezas ocultas (no reciben texturas). */
  hidden: Set<number>;
  /** Planos de fondo de la sala (no son piezas). */
  backdrops: THREE.Object3D[];
  symmetry(): Symmetry;
  mode(): string;
  color(): number;
  setColor(color: number): void;
  /** Anota el color como usado recientemente. */
  useColor(color: number): void;
  castRay(event: PointerEvent, includeGround: boolean): THREE.Intersection | undefined;
  findFace(hit: THREE.Intersection): PixelFaceHit | undefined;
  /** Quita el resaltado de la cara apuntada. */
  clearFaceHover(): void;
  /** Un pulsar que se queda esta herramienta no debe tomarse luego por un clic. */
  consumed(): void;
}

export interface PixelPanel {
  /** ¿Se pinta casilla a casilla (Pintar con la casilla «Píxeles»)? */
  painting(): boolean;
  /** La cara apuntada en modo píxeles: la que abre el botón «Plano». */
  noteFace(piece: Piece, face: Vec3[]): void;
  hasLastFace(): boolean;
  syncActions(): void;
  /** Elige una herramienta de píxeles y entra en el modo píxeles (el modo Pintar lo pone quien llama). */
  useTool(tool: string): void;
  /** Vuelve a pintar caras enteras. */
  wholeFaces(): void;
  openFaceEditor(): void;
  readonly editorOpen: boolean;
  closeEditor(): void;
  copy(): void;
  paste(): void;
  /** Termina (o cancela) el trazo o la región en curso; devuelve si había uno. */
  finish(commit: boolean): boolean;
  /** Engancha el trazo al lienzo (el orden de los escuchas del lienzo importa, por eso lo pide la aplicación). */
  bindPointer(): void;
}

/** Pintura de píxeles: dentro de Pintar, con la casilla «Píxeles» se pinta casilla a casilla en lugar de cara entera. */
export function createPixelPanel(host: PixelHost): PixelPanel {
  const { scene3d, renderer, controls, model, statusEl, textureLayer } = host;
  const pixelModeEl = document.getElementById('pixelMode') as HTMLInputElement;
  const pixelToolEl = document.getElementById('pixelTool') as HTMLSelectElement;
  const pixelSizeEl = document.getElementById('pixelSize') as HTMLSelectElement;
  const pixelActionsEl = document.getElementById('pixelActions')!;
  const pixelShapeEl = document.getElementById('pixelShape') as HTMLSelectElement;
  const pixelMirrorXEl = document.getElementById('pixelMirrorX') as HTMLInputElement;
  const pixelMirrorYEl = document.getElementById('pixelMirrorY') as HTMLInputElement;
  /** Forma del pincel y espejo dentro de la cara, según los controles del panel. */
  const brushOptions = (): BrushOptions => ({ round: pixelShapeEl.value === 'round', mirrorX: pixelMirrorXEl.checked, mirrorY: pixelMirrorYEl.checked });
  const pixelPainting = (): boolean => host.mode() === 'paint' && pixelModeEl.checked;
  /** Última cara tocada en modo píxeles: la que abre el botón "Plano". */
  let lastPixelFace: { piece: Piece; faceIndex: number } | null = null;
  // Los botones con icono mandan sobre los controles ocultos (casilla de píxeles, herramienta y forma) y marcan el que está puesto.
  for (const el of pixelActionsEl.querySelectorAll<HTMLElement>('[data-icon]')) el.innerHTML = iconSvg(el.dataset.icon!);
  const wholeButton = document.getElementById('pixelWhole') as HTMLButtonElement;
  const toolButtons = [...pixelActionsEl.querySelectorAll<HTMLButtonElement>('button[data-pixeltool]')];
  const shapeButtons = [...pixelActionsEl.querySelectorAll<HTMLButtonElement>('button[data-brushshape]')];
  function syncButtons(): void {
    wholeButton.classList.toggle('active', !pixelModeEl.checked);
    for (const b of toolButtons) b.classList.toggle('active', pixelModeEl.checked && b.dataset.pixeltool === pixelToolEl.value);
    for (const b of shapeButtons) b.classList.toggle('active', b.dataset.brushshape === pixelShapeEl.value);
  }
  function setPixelMode(on: boolean): void {
    pixelModeEl.checked = on;
    pixelModeEl.dispatchEvent(new Event('change'));
  }
  pixelModeEl.addEventListener('change', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    host.clearFaceHover();
    syncButtons();
  });
  wholeButton.addEventListener('click', () => {
    wholeButton.blur();
    setPixelMode(false);
  });
  for (const button of toolButtons) {
    button.addEventListener('click', () => {
      button.blur();
      pixelToolEl.value = button.dataset.pixeltool!;
      setPixelMode(true);
    });
  }
  for (const button of shapeButtons) {
    button.addEventListener('click', () => {
      button.blur();
      pixelShapeEl.value = button.dataset.brushshape!;
      syncButtons();
    });
  }
  syncButtons();

  /** Una cara que recibe el trazo: la pulsada o su reflejo con simetría (`reflect` lleva el punto pintado hasta ella). */
  interface StrokeTarget {
    piece: Piece;
    faceIndex: number;
    texture: FaceTexture;
    reflect: ((p: Vec3) => Vec3) | null;
    last: { x: number; y: number } | null;
    start: { x: number; y: number } | null;
    base: FaceTexture | null;
    selection?: Rect | null;
    copy?: boolean;
    shift?: { x: number; y: number };
  }
  /** Trazo en curso: se pinta en copias de las texturas y solo al soltar pasan al modelo, como un único cambio. */
  let pixelStroke: { piece: Piece; faceIndex: number; targets: StrokeTarget[]; changed: boolean } | null = null;

  /** Dibuja las texturas provisionales del trazo (una pieza puede recibir en varias caras a la vez). */
  function previewStroke(stroke: NonNullable<typeof pixelStroke>): void {
    const ids = new Set(stroke.targets.map((t) => t.piece.id));
    for (const id of ids) {
      const mine = stroke.targets.filter((t) => t.piece.id === id);
      const piece = mine[0].piece;
      const textures = piece.faces.map((_, i) => mine.find((t) => t.faceIndex === i)?.texture ?? piece.faceTextures?.[i] ?? null);
      textureLayer.add({ ...piece, faceTextures: textures });
    }
  }

  function applyPixelTool(stroke: NonNullable<typeof pixelStroke>, point: Vec3): void {
    const tool = pixelToolEl.value;
    const size = Number(pixelSizeEl.value);
    let changed = 0;
    for (const target of stroke.targets) {
      const cell = texelAt(target.piece.faces[target.faceIndex], target.texture, target.reflect ? target.reflect(point) : point);
      if (!cell) continue;
      // Entre dos movimientos se pinta la recta de casillas, para que un arrastre rápido no deje huecos.
      changed += paintCell(target.texture, target, tool, cell, size, host.color(), { ...brushOptions(), faceColor: faceColorOf(target.piece, target.faceIndex) });
    }
    if (changed === 0) return;
    stroke.changed = true;
    previewStroke(stroke);
  }

  /** Región elegida en la vista 3D con la herramienta Elegir de los píxeles: sobre qué cara y qué casillas. La sigue un recuadro amarillo. */
  let pixelSelection: { pieceId: number; faceIndex: number; rect: Rect } | null = null;
  let pixelSelecting: { piece: Piece; faceIndex: number; start: { x: number; y: number }; moved: boolean } | null = null;
  const pixelSelectionBox = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd24a, depthTest: false }));
  pixelSelectionBox.renderOrder = 999;
  pixelSelectionBox.frustumCulled = false;
  pixelSelectionBox.visible = false;
  scene3d.add(pixelSelectionBox);

  /** Pone o quita el recuadro según la selección (y que su pieza siga en el modelo). */
  function syncPixelSelection(): void {
    const sel = pixelSelection;
    const piece = sel && model.get(sel.pieceId);
    if (!sel || !piece || !piece.faces[sel.faceIndex]) {
      if (sel && !piece) pixelSelection = null;
      pixelSelectionBox.visible = false;
      return;
    }
    const face = piece.faces[sel.faceIndex];
    const { w, h } = textureOfFace(piece, sel.faceIndex);
    const { x0, y0, x1, y1 } = sel.rect;
    const corners = [pointOf(face, x0 / w, y0 / h), pointOf(face, (x1 + 1) / w, y0 / h), pointOf(face, (x1 + 1) / w, (y1 + 1) / h), pointOf(face, x0 / w, (y1 + 1) / h)];
    pixelSelectionBox.geometry.dispose();
    pixelSelectionBox.geometry = new THREE.BufferGeometry().setFromPoints(corners.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    pixelSelectionBox.visible = true;
  }
  model.subscribe(() => syncPixelSelection());

  /** Voltear, girar, contorno y tono: sobre la selección (o toda la cara) del editor plano si está abierto y, si no, de la vista 3D. */
  function applyPixelEdit(edit: PixelEdit): void {
    let done: boolean;
    if (faceEditor.isOpen) {
      done = faceEditor.edit(edit);
    } else {
      const sel = pixelSelection && model.get(pixelSelection.pieceId) ? pixelSelection : null;
      const piece = sel ? model.get(sel.pieceId)! : lastPixelFace && model.get(lastPixelFace.piece.id);
      const faceIndex = sel ? sel.faceIndex : lastPixelFace?.faceIndex;
      if (!piece || faceIndex === undefined) {
        statusEl.textContent = 'Pasa el cursor por una cara en modo píxeles para elegirla';
        return;
      }
      const next = editRegion(textureOfFace(piece, faceIndex), sel?.rect ?? null, edit, host.color());
      done = next !== null;
      if (next) {
        const updated = withFaceTexture(piece, faceIndex, next);
        model.apply({ added: [updated], removed: [piece] });
        lastPixelFace = { piece: updated, faceIndex };
        if (sel) pixelSelection = { pieceId: updated.id, faceIndex, rect: sel.rect };
        syncPixelSelection();
      }
    }
    if (!done) statusEl.textContent = edit === 'rotate' ? 'Girar necesita una región cuadrada (o una cara cuadrada)' : 'No hay nada que cambiar';
  }
  document.querySelectorAll<HTMLButtonElement>('button[data-pixeledit]').forEach((button) =>
    button.addEventListener('click', () => {
      button.blur();
      applyPixelEdit(button.dataset.pixeledit as PixelEdit);
    }),
  );

  /** Ctrl+C en modo píxeles: copia la región elegida o, sin ella, toda la última cara tocada. */
  function copyPixels(): void {
    const sel = pixelSelection && model.get(pixelSelection.pieceId) ? pixelSelection : null;
    const piece = sel ? model.get(sel.pieceId)! : lastPixelFace && model.get(lastPixelFace.piece.id);
    const faceIndex = sel ? sel.faceIndex : lastPixelFace?.faceIndex;
    if (!piece || faceIndex === undefined) {
      statusEl.textContent = 'Pasa el cursor por una cara en modo píxeles para copiarla';
      return;
    }
    pixelClipboard.value = copyRegion(textureOfFace(piece, faceIndex), sel?.rect ?? null);
    statusEl.textContent = 'Píxeles copiados';
  }

  /** Ctrl+V en modo píxeles: pega en la cara elegida (con su esquina en la de la selección) o en la última tocada. */
  function pastePixels(): void {
    const clip = pixelClipboard.value;
    const sel = pixelSelection && model.get(pixelSelection.pieceId) ? pixelSelection : null;
    const piece = sel ? model.get(sel.pieceId)! : lastPixelFace && model.get(lastPixelFace.piece.id);
    const faceIndex = sel ? sel.faceIndex : lastPixelFace?.faceIndex;
    if (!clip || !piece || faceIndex === undefined) {
      statusEl.textContent = clip ? 'Pasa el cursor por una cara en modo píxeles para pegar' : 'No hay píxeles copiados';
      return;
    }
    const pasted = pasteRegion(textureOfFace(piece, faceIndex), clip, sel?.rect.x0 ?? 0, sel?.rect.y0 ?? 0);
    const next = withFaceTexture(piece, faceIndex, pasted.texture);
    model.apply({ added: [next], removed: [piece] });
    lastPixelFace = { piece: next, faceIndex };
    pixelSelection = { pieceId: next.id, faceIndex, rect: pasted.rect };
    syncPixelSelection();
  }

  function startPixelStroke(event: PointerEvent): void {
    if (!pixelPainting() || event.button !== 0) return;
    const hit = host.castRay(event, false);
    const found = hit && !host.backdrops.includes(hit.object) ? host.findFace(hit) : undefined;
    if (!found) return;
    const faceIndex = found.piece.faces.indexOf(found.face);
    const texture = textureOfFace(found.piece, faceIndex);
    if (event.altKey) {
      const cell = texelAt(found.face, texture, [found.point.x, found.point.y, found.point.z]);
      if (cell) host.setColor(visibleColor(texture, cell.x, cell.y, faceColorOf(found.piece, faceIndex)));
      return;
    }
    if (pixelToolEl.value === 'stamp' && !pixelClipboard.value) {
      statusEl.textContent = 'El sello está vacío: elige una región (Elegir), cópiala (Copiar o Ctrl+C) y vuelve al sello';
    }
    controls.enabled = false;
    try {
      renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // Sin captura el trazo sigue mientras el puntero esté sobre el lienzo.
    }
    lastPixelFace = { piece: found.piece, faceIndex };
    if (pixelToolEl.value === 'select') {
      const cell = texelAt(found.face, texture, [found.point.x, found.point.y, found.point.z]);
      if (!cell) return;
      pixelSelecting = { piece: found.piece, faceIndex, start: cell, moved: false };
      pixelSelection = { pieceId: found.piece.id, faceIndex, rect: rectBetween(cell, cell) };
      syncPixelSelection();
      return;
    }
    const targets: StrokeTarget[] = [{ piece: found.piece, faceIndex, texture, reflect: null, last: null, start: null, base: null }];
    // Con simetría el trazo se repite en los reflejos de la cara, cada uno sobre su propia copia de la textura.
    const centre = faceCentre(found.face);
    for (const reflection of reflections(host.symmetry())) {
      for (const image of facesAt(model.all(), reflection.point(centre), reflection.dir(found.normal))) {
        if (targets.some((t) => t.piece.id === image.piece.id && t.faceIndex === image.index)) continue;
        targets.push({ piece: image.piece, faceIndex: image.index, texture: textureOfFace(image.piece, image.index), reflect: reflection.point, last: null, start: null, base: null });
      }
    }
    if (pixelToolEl.value === 'move') {
      const sel = pixelSelection && pixelSelection.pieceId === found.piece.id && pixelSelection.faceIndex === faceIndex ? pixelSelection.rect : null;
      // Con una región elegida solo se mueve esa cara: los reflejos no tienen la misma región.
      if (sel) targets.splice(1);
      for (const t of targets) {
        t.selection = sel;
        t.copy = event.ctrlKey || event.metaKey;
      }
    }
    pixelStroke = { piece: found.piece, faceIndex, targets, changed: false };
    applyPixelTool(pixelStroke, [found.point.x, found.point.y, found.point.z]);
  }

  function movePixelStroke(event: PointerEvent): void {
    if (pixelSelecting) {
      const hit = host.castRay(event, false);
      const found = hit ? host.findFace(hit) : undefined;
      if (!found || found.piece.id !== pixelSelecting.piece.id || found.face !== pixelSelecting.piece.faces[pixelSelecting.faceIndex]) return;
      const cell = texelAt(found.face, textureOfFace(found.piece, pixelSelecting.faceIndex), [found.point.x, found.point.y, found.point.z]);
      if (!cell) return;
      pixelSelecting.moved = pixelSelecting.moved || cell.x !== pixelSelecting.start.x || cell.y !== pixelSelecting.start.y;
      pixelSelection = { pieceId: pixelSelecting.piece.id, faceIndex: pixelSelecting.faceIndex, rect: rectBetween(pixelSelecting.start, cell) };
      syncPixelSelection();
      return;
    }
    if (!pixelStroke) return;
    const hit = host.castRay(event, false);
    const found = hit ? host.findFace(hit) : undefined;
    // El trazo se queda en la cara donde empezó.
    if (!found || found.piece.id !== pixelStroke.piece.id || found.face !== pixelStroke.piece.faces[pixelStroke.faceIndex]) return;
    applyPixelTool(pixelStroke, [found.point.x, found.point.y, found.point.z]);
  }

  /** Editor plano: la misma pintura de píxeles sobre la textura ampliada de una cara. */
  const faceEditor = new FaceEditor(document.getElementById('faceEditor')!, document.getElementById('faceCanvas') as HTMLCanvasElement, {
    tool: () => pixelToolEl.value,
    size: () => Number(pixelSizeEl.value),
    brush: brushOptions,
    color: () => host.color(),
    pickColor: (c) => host.setColor(c),
    stillThere: (piece) => model.all().some((p) => p.id === piece.id),
    preview: (piece, faceIndex, texture) => textureLayer.preview(piece, faceIndex, texture),
    revert: (piece) => {
      const current = model.get(piece.id);
      if (current && !host.hidden.has(current.id)) textureLayer.add(current);
    },
    commit: (piece, faceIndex, texture) => {
      const next = withFaceTexture(piece, faceIndex, texture);
      model.apply({ added: [next], removed: [piece] });
      host.useColor(host.color());
      return next;
    },
  });

  function openFaceEditor(): void {
    const target = lastPixelFace && model.all().find((p) => p.id === lastPixelFace!.piece.id);
    if (!target || !lastPixelFace) {
      statusEl.textContent = 'Pasa el cursor por una cara en modo píxeles y vuelve a pulsar Plano';
      return;
    }
    lastPixelFace = { piece: target, faceIndex: lastPixelFace.faceIndex };
    faceEditor.open(target, lastPixelFace.faceIndex);
  }
  document.getElementById('pixelFlat')!.addEventListener('click', openFaceEditor);
  document.getElementById('pixelCopy')!.addEventListener('click', copyPixels);
  document.getElementById('pixelPaste')!.addEventListener('click', pastePixels);
  document.getElementById('faceEditorClose')!.addEventListener('click', () => faceEditor.close());
  renderer.domElement.addEventListener('dblclick', (e) => {
    if (!pixelPainting()) return;
    const hit = host.castRay(e as PointerEvent, false);
    const found = hit && !host.backdrops.includes(hit.object) ? host.findFace(hit) : undefined;
    if (!found) return;
    lastPixelFace = { piece: found.piece, faceIndex: found.piece.faces.indexOf(found.face) };
    openFaceEditor();
  });

  function finishPixelStroke(commit: boolean): boolean {
    if (pixelSelecting) {
      // Un clic sin arrastrar quita la selección.
      if (!pixelSelecting.moved) pixelSelection = null;
      pixelSelecting = null;
      controls.enabled = true;
      syncPixelSelection();
      return true;
    }
    const stroke = pixelStroke;
    if (!stroke) return false;
    pixelStroke = null;
    controls.enabled = true;
    if (commit && stroke.changed) {
      // Una pieza puede recibir en varias caras: se encadenan sobre la versión ya modificada.
      const latest = new Map<number, Piece>();
      for (const target of stroke.targets) {
        latest.set(target.piece.id, withFaceTexture(latest.get(target.piece.id) ?? target.piece, target.faceIndex, target.texture));
      }
      const primary = stroke.targets[0];
      const moved = pixelSelection && pixelSelection.pieceId === primary.piece.id && pixelSelection.faceIndex === primary.faceIndex && primary.shift ? primary.shift : null;
      model.apply({ added: [...latest.values()], removed: stroke.targets.filter((t, i, all) => all.findIndex((o) => o.piece.id === t.piece.id) === i).map((t) => t.piece) });
      // La última cara tocada sigue siendo la misma en la pieza nueva.
      const renewed = lastPixelFace && latest.get(lastPixelFace.piece.id);
      if (lastPixelFace && renewed) lastPixelFace = { piece: renewed, faceIndex: lastPixelFace.faceIndex };
      // La selección sigue al contenido movido y a la pieza nueva que lo lleva.
      if (pixelSelection && pixelSelection.pieceId === primary.piece.id) {
        const next = latest.get(primary.piece.id)!;
        const r = pixelSelection.rect;
        const shifted = moved && pixelToolEl.value === 'move' ? { x0: r.x0 + moved.x, y0: r.y0 + moved.y, x1: r.x1 + moved.x, y1: r.y1 + moved.y } : r;
        pixelSelection = { pieceId: next.id, faceIndex: pixelSelection.faceIndex, rect: shifted };
        syncPixelSelection();
      }
      host.useColor(host.color());
    } else {
      // Sin cambios o cancelado: vuelve a dibujarse la pieza tal como está en el modelo.
      for (const target of stroke.targets) textureLayer.add(target.piece);
    }
    return true;
  }

  return {
    painting: pixelPainting,
    noteFace: (piece, face) => {
      lastPixelFace = { piece, faceIndex: piece.faces.indexOf(face) };
    },
    hasLastFace: () => lastPixelFace !== null,
    syncActions: () => {
      pixelActionsEl.hidden = host.mode() !== 'paint';
    },
    useTool: (tool) => {
      pixelToolEl.value = tool;
      setPixelMode(true);
    },
    wholeFaces: () => setPixelMode(false),
    openFaceEditor,
    get editorOpen() {
      return faceEditor.isOpen;
    },
    closeEditor: () => faceEditor.close(),
    copy: copyPixels,
    paste: pastePixels,
    finish: finishPixelStroke,
    bindPointer: () => {
      renderer.domElement.addEventListener('pointerdown', startPixelStroke, { capture: true });
      renderer.domElement.addEventListener('pointermove', movePixelStroke);
      renderer.domElement.addEventListener(
        'pointerup',
        (e) => {
          if (finishPixelStroke(true)) {
            e.stopImmediatePropagation();
            host.consumed();
          }
        },
        { capture: true },
      );
    },
  };
}
