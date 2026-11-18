import type * as THREE from 'three';
import { meshNeedReason, titleWithReason } from '../core/meshNeeds';
import { FACE_BEHIND, FACE_DOUBLE, FACE_UNLIT, type Piece } from '../core/piece';
import type { Symmetry } from '../core/symmetry';
import type { ModelScene } from '../scene';
import { MeshTool } from '../tools/meshTool';

/** Lo que el panel de Malla necesita de la aplicación. */
export interface MeshPanelHost {
  scene3d: THREE.Scene;
  camera: THREE.Camera;
  renderer: { domElement: HTMLCanvasElement };
  controls: { enabled: boolean };
  model: ModelScene;
  statusEl: HTMLElement;
  selectedPieces(): Piece[];
  /** ¿La pieza está oculta (ella o su capa)? */
  isHidden(piece: Piece): boolean;
  symmetry(): Symmetry;
  /** Celdas por lado de la sala (tope de los tamaños recordados). */
  gridSize(): number;
  /** ¿Está activa la herramienta Malla? */
  inMeshMode(): boolean;
  /** Un clic que Malla se queda no llega al resto: el «pulsar» pendiente del lienzo quedaría viejo. */
  consumed(): void;
  /** Repinta la fila «Mover en / Plano» (compartida con Elegir). */
  syncAxisRow(): void;
}

export interface MeshPanel {
  readonly tool: MeshTool;
  /** Repinta el panel: avisos, botones apagados con su motivo y casillas. */
  sync(): void;
}

/** Malla: elegir y mover los vértices de las piezas. Una pieza con un vértice hundido deja de ser convexa y pasa a ser malla libre. */
export function createMeshPanel(host: MeshPanelHost): MeshPanel {
  const { statusEl } = host;
  const meshActionsEl = document.getElementById('meshActions')!;
  const meshInfoEl = document.getElementById('meshInfo')!;
  const meshDoubleEl = document.getElementById('meshDouble') as HTMLInputElement;
  /** Lo que se deja elegido en el panel de Malla se recuerda entre sesiones (sin fallar si el navegador no deja guardar). */
  const meshPref = {
    get: (name: string): string | null => {
      try {
        return localStorage.getItem(`gridfacet.mesh.${name}`);
      } catch {
        return null;
      }
    },
    set: (name: string, value: string): void => {
      try {
        localStorage.setItem(`gridfacet.mesh.${name}`, value);
      } catch {
        // Sin almacenamiento la opción vale solo para esta sesión.
      }
    },
  };
  const meshAutoFlatEl = document.getElementById('meshAutoFlat') as HTMLInputElement;
  meshAutoFlatEl.checked = meshPref.get('autoFlat') === '1';
  meshAutoFlatEl.addEventListener('change', () => {
    meshPref.set('autoFlat', meshAutoFlatEl.checked ? '1' : '0');
    meshTool.flattenOnRelease = meshAutoFlatEl.checked;
    statusEl.textContent = meshAutoFlatEl.checked ? 'Aplanar al soltar activado: al soltar un vértice, las caras que queden torcidas se aplanan solas' : 'Aplanar al soltar desactivado: las caras torcidas solo se marcan en naranja';
  });
  const meshTipFacesEl = document.getElementById('meshTipFaces') as HTMLInputElement;
  meshTipFacesEl.checked = meshPref.get('tipFaces') === '1';
  meshTipFacesEl.addEventListener('change', () => {
    meshPref.set('tipFaces', meshTipFacesEl.checked ? '1' : '0');
    meshTool.tipFaces = meshTipFacesEl.checked;
    statusEl.textContent = meshTipFacesEl.checked ? 'Punta con caras: la copia se une al original con caras nuevas' : 'Punta sin caras: la copia se une al original solo con un segmento; las caras las creas tú (Crear cara, F)';
  });
  const meshUnlitEl = document.getElementById('meshUnlit') as HTMLInputElement;
  const meshBehindEl = document.getElementById('meshBehind') as HTMLInputElement;
  const meshTool = new MeshTool({
    scene: host.scene3d,
    camera: host.camera,
    domElement: host.renderer.domElement,
    setOrbit: (on) => {
      host.controls.enabled = on;
    },
    model: host.model,
    selectedPieces: () => host.selectedPieces(),
    isHidden: (piece) => host.isHidden(piece),
    symmetry: () => host.symmetry(),
    status: (message) => (statusEl.textContent = message),
    consumed: () => host.consumed(),
    onSelectionChange: () => syncMeshActions(),
  });
  host.model.onHistory = (kind) => meshTool.historyMoved(kind);
  /** Un botón o casilla de Malla apagado dice en su título qué hay que elegir (el título de siempre se guarda en `data-title`). */
  function setReasonTitle(element: HTMLElement, reason: string | null): void {
    element.dataset.title ??= element.title;
    element.title = titleWithReason(element.dataset.title, reason);
  }
  function syncMeshActions(): void {
    meshActionsEl.hidden = !host.inMeshMode();
    const count = meshTool.count;
    const warped = meshTool.warpedCount;
    const fullFaces = meshTool.faceFlagCount(FACE_DOUBLE).total;
    const unpaired = meshTool.unpairedCount;
    const symmetry = host.symmetry();
    meshInfoEl.textContent = (count === 0 ? 'Ningún vértice elegido' : `${count} vértice(s) elegidos`) + (warped > 0 ? ` · ${warped} cara(s) torcida(s) en naranja` : '') + (unpaired > 0 ? ` · ${unpaired} vértice(s) sin gemelo en rosa (Simetrizar)` : '');
    document.getElementById('meshAdd')!.classList.toggle('active', meshTool.addMode);
    document.getElementById('meshSlide')!.classList.toggle('active', meshTool.slideMode);
    document.getElementById('meshRemove')!.classList.toggle('active', meshTool.removeMode);
    host.syncAxisRow();
    meshActionsEl.querySelectorAll<HTMLButtonElement>('button[data-mesh]').forEach((button) => {
      const reason = meshNeedReason(button.dataset.mesh!, { count, mostInOnePiece: meshTool.mostInOnePiece, fullFaces, symmetric: symmetry.x || symmetry.y || symmetry.z });
      button.disabled = reason !== null;
      setReasonTitle(button, reason);
    });
    // Las casillas reflejan las caras elegidas (todos sus vértices): marcadas si todas la tienen, a medias si solo algunas.
    for (const [input, flag] of [[meshDoubleEl, FACE_DOUBLE], [meshUnlitEl, FACE_UNLIT], [meshBehindEl, FACE_BEHIND]] as const) {
      const { total, on } = meshTool.faceFlagCount(flag);
      input.disabled = total === 0;
      setReasonTitle(input.parentElement!, total === 0 ? 'necesita elegir caras con todos sus vértices elegidos (no hay ninguna)' : null);
      input.checked = total > 0 && on === total;
      input.indeterminate = on > 0 && on < total;
    }
  }
  for (const [input, flag] of [[meshDoubleEl, FACE_DOUBLE], [meshUnlitEl, FACE_UNLIT], [meshBehindEl, FACE_BEHIND]] as const) {
    input.addEventListener('change', () => meshTool.setFaceFlag(flag, input.checked));
  }
  document.getElementById('meshSlide')!.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).blur();
    meshTool.setSlideMode(!meshTool.slideMode);
  });
  document.getElementById('meshRemove')!.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).blur();
    meshTool.setRemoveMode(!meshTool.removeMode);
  });
  const meshGrowAmountEl = document.getElementById('meshGrowAmount') as HTMLInputElement;
  {
    const saved = Number(meshPref.get('grow'));
    if (saved > 0 && saved <= host.gridSize()) {
      meshGrowAmountEl.value = String(saved);
      meshTool.growDistance = saved;
    }
  }
  meshGrowAmountEl.addEventListener('input', () => {
    const value = Number(meshGrowAmountEl.value);
    if (value > 0 && value <= host.gridSize()) {
      meshTool.growDistance = value;
      meshPref.set('grow', String(value));
    }
  });
  // El tamaño del chaflán es uno solo: lo comparten la herramienta Chaflán (J) y la acción «Chaflán» de Malla, y se recuerda entre sesiones.
  const bevelSizeEl = document.getElementById('bevelSize') as HTMLInputElement;
  const meshBevelSizeEl = document.getElementById('meshBevelSize') as HTMLInputElement;
  function setBevelSize(value: number): void {
    meshTool.bevelSize = value;
    meshPref.set('bevel', String(value));
    for (const input of [bevelSizeEl, meshBevelSizeEl]) if (Number(input.value) !== value) input.value = String(value);
  }
  {
    const saved = Number(meshPref.get('bevel'));
    if (saved > 0 && saved <= host.gridSize()) setBevelSize(saved);
  }
  for (const input of [bevelSizeEl, meshBevelSizeEl]) {
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (value > 0 && value <= host.gridSize()) setBevelSize(value);
    });
  }
  const meshWeldDistanceEl = document.getElementById('meshWeldDistance') as HTMLInputElement;
  {
    const saved = Number(meshPref.get('weld'));
    if (saved > 0 && saved <= 1) {
      meshWeldDistanceEl.value = String(saved);
      meshTool.weldDistance = saved;
    }
  }
  meshWeldDistanceEl.addEventListener('input', () => {
    const value = Number(meshWeldDistanceEl.value);
    if (value > 0 && value <= 1) {
      meshTool.weldDistance = value;
      meshPref.set('weld', String(value));
    }
  });
  const meshSeeBehindEl = document.getElementById('meshSeeBehind') as HTMLInputElement;
  // La casilla arranca con lo último que se eligió y la herramienta con ella (si no, se veían los vértices al revés).
  meshSeeBehindEl.checked = meshPref.get('seeBehind') !== '0';
  meshTool.setSeeBehind(meshSeeBehindEl.checked, false);
  meshTool.flattenOnRelease = meshAutoFlatEl.checked;
  meshTool.tipFaces = meshTipFacesEl.checked;
  meshSeeBehindEl.addEventListener('change', () => {
    meshPref.set('seeBehind', meshSeeBehindEl.checked ? '1' : '0');
    meshTool.setSeeBehind(meshSeeBehindEl.checked);
    meshSeeBehindEl.blur();
  });
  document.getElementById('meshAdd')!.addEventListener('click', (event) => {
    (event.currentTarget as HTMLButtonElement).blur();
    meshTool.setAddMode(!meshTool.addMode);
  });
  meshActionsEl.querySelectorAll<HTMLButtonElement>('button[data-mesh]').forEach((button) =>
    button.addEventListener('click', () => {
      button.blur();
      // Con un arrastre, un giro o un recuadro en marcha, las acciones del panel no hacen nada.
      if (meshTool.busy) return;
      const action = button.dataset.mesh;
      if (action === 'all') meshTool.selectAll();
      else if (action === 'merge') meshTool.mergeSelected();
      else if (action === 'delete') meshTool.deleteSelected();
      else if (action === 'snap') meshTool.snapToGrid();
      else if (action === 'weld') meshTool.weldNearby();
      else if (action === 'rotate') meshTool.beginTransform('rotate');
      else if (action === 'scale') meshTool.beginTransform('scale');
      else if (action === 'taper') meshTool.beginTransform('taper');
      else if (action === 'twist') meshTool.beginTransform('twist');
      else if (action === 'bend') meshTool.beginTransform('bend');
      else if (action === 'face') meshTool.createFace();
      else if (action === 'delface') meshTool.deleteFacesSelected();
      else if (action === 'fillhole') meshTool.fillHolesSelected();
      else if (action === 'flip') meshTool.flipSelected();
      else if (action === 'triangulate') meshTool.triangulateSelected();
      else if (action === 'extrude') meshTool.extrudeSelected();
      else if (action === 'tip') meshTool.tipSelected();
      else if (action === 'push') meshTool.beginTransform('push');
      else if (action === 'growedge') meshTool.growFaceFromEdge();
      else if (action === 'connect') meshTool.connectSelected();
      else if (action === 'ring') meshTool.ringCutSelected();
      else if (action === 'bevel') meshTool.bevelSelected();
      else if (action === 'dissolve') meshTool.dissolveSelected();
      else if (action === 'straighten') meshTool.straightenSelected();
      else if (action === 'flatten') meshTool.flattenSelected();
      else if (action === 'symmetrize') meshTool.symmetrizeAll();
    }),
  );
  return { tool: meshTool, sync: syncMeshActions };
}
