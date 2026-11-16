import { MODE_INFO, GUIDE, setupHelp } from './ui/help';
import { isPanMode, toolKey, verticalMoveKey, type KeyMode } from './core/shortcuts';
import * as THREE from 'three';
import { axisAllowed, lockLabel, planeNormal, type AxisLock } from './core/axisLock';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, buildPieces } from './core/catalog';
import { coplanarRegion, type FaceOf } from './core/region';
import type { Change } from './core/cut';
import type { ExportMode } from './core/export';
import { extrudeFace, faceAt, unitNormal } from './core/extrude';
import { pieceKey, reflectPiece, reflections, withSymmetry, withSymmetryPoints, type Symmetry } from './core/symmetry';
import type { Piece, Vec3 } from './core/piece';
import { STEP_XZ, STEP_Y, mirrorChange, mirrorCopyChange, moveChange, rotateChange, rotateQuarterChange, translatePiece, type Axis } from './core/transform';
import { alignChange, distributeChange, groundChange, partsOf, resizeLongestChange } from './core/arrange';
import type { Command } from './core/commands';
import { parseHexColors, parsePalettes, toHexText, upsertPalette, type Palette } from './core/palettes';
import { serializeProject } from './core/project';
import { createFiles } from './ui/files';
import { createKeyboard, type KeyActions } from './ui/keyboard';
import { createPlacement } from './ui/placement';
import { createPixelPanel } from './ui/pixelPanel';
import { createLayersPanel } from './ui/layersPanel';
import { createMeshPanel } from './ui/meshPanel';
import { applyShortcutLabels } from './ui/shortcutLabels';
import { createCommandPalette } from './ui/commandPalette';
import { createReferencesPanel } from './ui/referencesPanel';
import { emptyAnimation, pruneTracks } from './core/animation';
import { createAnimationPanel } from './ui/animationPanel';
import { downloadBlob, exportGlb } from './render/glb';
import { TextureLayer } from './render/textures';
import { PieceBatches } from './render/batches';
import { createPieceObject, disposeObject, isWireframeView, setHighlight, setSmoothShading, setWireframeView } from './render/meshes';
import { ModelScene } from './scene';
import { Selection } from './selection';
import type { Guides } from './core/guides';
import { CutTool, snapPoint, type SnapOptions } from './tools/cutTool';
import { FillTool } from './tools/fillTool';
import { OutlineTool } from './tools/outlineTool';
import { boundsOf, centerChange, rotateFreeChange, scaleChange } from './core/transform';
import { connectedPieces, sizeOf } from './core/connected';
import { bevelChange, edgeBetween, nearestEdge, type PieceEdge } from './core/bevel';
import { buildShape, MAX_RINGS, MAX_SIDES, MIN_RINGS, MIN_SIDES, SECTIONS, SHAPES, type ShapeKind, type ShapeSpec, type SphereSection } from './core/shapes';
import { facesAt, paintChange, type FaceRef } from './core/paint';
import { faceCentre, faceColorOf, newGroupId, reserveGroupIds, withGroup } from './core/piece';
import { VertexTool } from './tools/vertexTool';
import { AXIS_COLORS } from './tools/meshTool';
import { isConvex } from './core/convex';
import { excavateChange, extrudeFaceChange, findSlivers, joinChange, mergeChange, repeatChange, sinkCutters, sinkFacesChange, splitFaceChange, triangleCount } from './core/modeling';

const DEFAULT_GRID_SIZE = 24;
const MIN_GRID_SIZE = 4;
const MAX_GRID_SIZE = 128;
const CLICK_MAX_MOVE = 4;

// La app se llamó Novoxel y luego Polygrid: los ajustes guardados en el navegador con esos nombres pasan a las claves nuevas la primera vez.
try {
  for (const name of ['triBudget', 'recentColors', 'collapsed']) {
    if (localStorage.getItem(`gridfacet.${name}`) !== null) continue;
    for (const legacy of ['polygrid', 'novoxel']) {
      const old = localStorage.getItem(`${legacy}.${name}`);
      if (old === null) continue;
      localStorage.setItem(`gridfacet.${name}`, old);
      break;
    }
  }
} catch {
  // Sin almacenamiento no hay nada que migrar.
}

const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
// Más de 2× no se nota y cuesta mucho: en pantallas muy densas la tarjeta gráfica trabaja el doble o el triple.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene3d = new THREE.Scene();
scene3d.background = new THREE.Color(0x1c1f26);
scene3d.add(new THREE.HemisphereLight(0xffffff, 0x454a56, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(6, 12, 8);
scene3d.add(sun);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(8, 7, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;

// La sala: suelo y dos paredes de fondo (x y z mínimos), como en MagicaVoxel. Cada una tiene su cuadrícula visible
// y una superficie invisible sobre la que también se puede colocar. Su tamaño (en celdas, siempre par) se puede cambiar.
let gridSize = DEFAULT_GRID_SIZE;
let gridVisible = true;
const room = new THREE.Group();
scene3d.add(room);
const gridLines: THREE.Object3D[] = [];
const backdrops: THREE.Object3D[] = [];

function buildRoom(): void {
  for (const child of [...room.children]) {
    room.remove(child);
    if (child instanceof THREE.GridHelper) child.dispose();
    else if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
  gridLines.length = 0;
  backdrops.length = 0;
  const half = gridSize / 2;

  const floor = new THREE.GridHelper(gridSize, gridSize, 0x5b6272, 0x343944);
  gridLines.push(floor);
  room.add(floor);
  // Plano invisible en y = 0 para colocar piezas sobre el suelo.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gridSize, gridSize).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
  backdrops.push(ground);
  room.add(ground);

  for (const axis of ['x', 'z'] as const) {
    const grid = new THREE.GridHelper(gridSize, gridSize, 0x5b6272, 0x2a2e38);
    grid.rotation[axis === 'x' ? 'z' : 'x'] = Math.PI / 2;
    grid.position.set(axis === 'x' ? -half : 0, half, axis === 'z' ? -half : 0);
    gridLines.push(grid);
    room.add(grid);
    // La geometría ya sale orientada hacia dentro de la sala, porque el rayo solo cuenta la cara frontal.
    const plane = new THREE.PlaneGeometry(gridSize, gridSize);
    plane.rotateY(axis === 'x' ? Math.PI / 2 : 0);
    plane.translate(axis === 'x' ? -half : 0, half, axis === 'z' ? -half : 0);
    const wall = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ visible: false }));
    backdrops.push(wall);
    room.add(wall);
  }
  for (const line of gridLines) line.visible = gridVisible;
}
buildRoom();

const statusEl = document.getElementById('status')!;
const model = new ModelScene();
const objects = new Map<number, THREE.Object3D>();
const selection = new Selection();
const batches = new PieceBatches();
scene3d.add(batches.group);
// Simetría: lo que se coloca, borra, hace crecer, rellena o corta se repite reflejado en los ejes activos.
const symmetry: Symmetry = { x: false, y: false, z: false, center: [0, 12, 0] };
const expand = (pieces: Piece[]): Piece[] => withSymmetry(pieces, symmetry);
const vertexTool = new VertexTool(
  scene3d,
  model,
  () => model.all().filter((piece) => selection.has(piece.id)),
  (message) => (statusEl.textContent = message),
  (points) => withSymmetryPoints(points, symmetry),
);
/** Crecer (false) o hundir (true) la figura marcada con la herramienta Figura. */
let outlineSink = false;
const outlineTool = new OutlineTool(scene3d, model, () => outlineSink, (normal) => growClickDistance(normal), (message) => (statusEl.textContent = message), (pieces) => expand(pieces));
const fillTool = new FillTool(scene3d, model, () => color, (message) => (statusEl.textContent = message), expand);
const cutTool = new CutTool(scene3d, model, selection, (message) => (statusEl.textContent = message), () => symmetry);

const files = createFiles({
  model,
  statusEl,
  renderer,
  serialize: (withReferences) => serializeProject(model.all(), model.points(), gridSize, layers.toJSON(), pruneTracks(animationPanel.animation, model.all()), withReferences ? referencesPanel.references : undefined),
  layerName: (id) => layers.get(id)?.name ?? `Capa_${id}`,
  animation: () => animationPanel.animation,
  visiblePieces: () => model.all().filter((piece) => !hidden.has(piece.id)),
  loadProject: (project) => {
    const { pieces: loaded, marks, gridSize: savedSize, layers: savedLayers, animation: savedAnimation, references: savedReferences } = project;
    if (savedSize !== undefined) setGridSize(savedSize);
    if (mode === 'cut') cutTool.cancel();
    // Las piezas abiertas traen su capa: las nuevas no deben tomar la activa de antes.
    model.activeLayer = 1;
    selection.clear();
    animationPanel.stop();
    // Los grupos del proyecto abierto quedan reservados: uno nuevo no debe fundirse con ellos.
    reserveGroupIds(loaded);
    model.apply({ added: loaded, removed: model.all(), marksAdded: marks, marksRemoved: model.points() });
    model.clearHistory();
    animationPanel.load(savedAnimation ?? emptyAnimation());
    layers.load(savedLayers, loaded);
    applyLayerState();
    referencesPanel.set(savedReferences);
  },
});
files.syncFileName();

// El modelo manda; la escena 3D solo refleja sus cambios.
// Las piezas sin elegir se dibujan fundidas por zonas; solo las elegidas son objetos propios (para resaltarlas y arrastrarlas).
model.subscribe(({ added, removed, marksAdded, marksRemoved }) => {
  for (const piece of removed) {
    batches.remove(piece.id);
    textureLayer.remove(piece.id);
    const object = objects.get(piece.id);
    if (!object) continue;
    scene3d.remove(object);
    disposeObject(object);
    objects.delete(piece.id);
  }
  for (const id of removed.map((piece) => piece.id)) hidden.delete(id);
  for (const piece of added) showPiece(piece);
  for (const piece of added) if (!hidden.has(piece.id)) textureLayer.add(piece);
  const toHide = added.filter((piece) => layers.isHidden(piece) && !hidden.has(piece.id)).map((piece) => piece.id);
  if (toHide.length > 0) hidePieces(toHide);
  setEraseHover(undefined);
  if (marksAdded?.length || marksRemoved?.length) refreshMarks();
  files.markDirty();
  files.scheduleAutosave();
  files.syncFileName();
  // Una pieza que vuelve con el mismo id (vértices movidos) sigue elegida y se resalta de nuevo.
  const returned = new Set(added.map((piece) => piece.id));
  selection.remove(removed.map((piece) => piece.id).filter((id) => !returned.has(id)));
  for (const piece of added) {
    if (!selection.has(piece.id) || objects.has(piece.id)) continue;
    batches.remove(piece.id);
    const object = createPieceObject(piece);
    setHighlight(object, true);
    objects.set(piece.id, object);
    scene3d.add(object);
  }
  meshTool.refresh();
  syncInspector();
  refreshGroups();
  refreshLayers();
  syncTriangles();
  if (mode === 'fill' && added.length > 0) useColor(color);
});

selection.subscribe(() => {
  for (const [id, object] of objects) {
    if (selection.has(id)) continue;
    scene3d.remove(object);
    disposeObject(object);
    objects.delete(id);
    const piece = model.get(id);
    if (piece) showPiece(piece);
  }
  for (const id of selection.list()) {
    const piece = model.get(id);
    if (!piece || objects.has(id)) continue;
    batches.remove(id);
    const object = createPieceObject(piece);
    setHighlight(object, true);
    objects.set(id, object);
    scene3d.add(object);
  }
  if (mode !== 'cut') statusEl.textContent = selection.size > 0 ? selectionLabel() : '';
  syncSelectionActions();
  syncInspector();
  layersPanel.syncSelection();
});

if (import.meta.env.DEV) {
  const dev = window as unknown as Record<string, unknown>;
  dev.__scene = scene3d;
  dev.__model = model;
  dev.__cut = cutTool;
  dev.__fill = fillTool;
  dev.__camera = camera;
  dev.__controls = controls;
  dev.__ghost = () => placement.ghost && new THREE.Box3().setFromObject(placement.ghost);
  // Utilidades de medición: rellenan la escena con cubos y miden el coste de dibujo.
  dev.__stress = (count: number) => {
    const side = Math.ceil(Math.cbrt(count));
    const pieces: Piece[] = [];
    for (let x = 0; x < side && pieces.length < count; x++)
      for (let y = 0; y < side && pieces.length < count; y++)
        for (let z = 0; z < side && pieces.length < count; z++)
          pieces.push(...buildPieces(CATALOG[(x + y + z) % 3 === 0 ? 2 : 0], x * 2 - side, y * 3, z * 2 - side, 0, 0x3b8bd4 + ((x * 7 + z) % 5) * 0x101010));
    const start = performance.now();
    model.apply({ added: pieces, removed: [] });
    return { pieces: pieces.length, applyMs: Math.round(performance.now() - start) };
  };
  // Dibuja de forma síncrona y espera a la GPU, así no depende de que el navegador pinte fotogramas.
  dev.__perf = () => {
    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    const frames = 30;
    batches.flush();
    renderer.render(scene3d, camera);
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      renderer.render(scene3d, camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    const { calls, triangles } = renderer.info.render;
    return { frameMs: +((performance.now() - start) / frames).toFixed(1), drawCalls: calls, triangles };
  };
}

type Mode = KeyMode;
let mode: Mode = 'place';
let selected = 0;
let rotation = 0;
let color = 0xd9534f;
let snapped: ReturnType<typeof snapPoint> | null = null;

const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

function castRay(event: PointerEvent, includeGround: boolean): THREE.Intersection | undefined {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  batches.flush();
  const targets = [...objects.values(), ...batches.meshes()];
  if (includeGround) targets.push(...(gridVisible ? backdrops : [backdrops[0]]));
  // Los contornos (líneas) no tienen cara y estorbarían al apuntar a una pieza.
  const first = raycaster.intersectObjects(targets, true).find((hit) => hit.object instanceof THREE.Mesh);
  // Una pieza bloqueada tapa lo que hay detrás, pero las herramientas que la modificarían no la ven.
  if (first && EDIT_MODES.has(mode)) {
    const id = pieceIdOf(first);
    const piece = id === undefined ? undefined : model.get(id);
    if (piece && layers.isLocked(piece)) return undefined;
  }
  return first;
}

/** Modos que modifican la pieza apuntada: no actúan sobre capas bloqueadas. */
const EDIT_MODES = new Set<string>(['select', 'erase', 'paint', 'face', 'shape', 'bevel', 'grow', 'sink']);

function pieceIdOf(hit: THREE.Intersection | undefined): number | undefined {
  if (!hit) return undefined;
  return (hit.object.userData.pieceId as number | undefined) ?? batches.pieceIdAt(hit);
}

function updateCursor(overPiece: boolean): void {
  const canvas = renderer.domElement;
  if (drag) canvas.style.cursor = 'grabbing';
  else if (mode === 'cut' || mode === 'fill' || mode === 'vertex' || mode === 'outline') canvas.style.cursor = 'crosshair';
  else if (growDrag) canvas.style.cursor = 'grabbing';
  else if (mode === 'select') canvas.style.cursor = overPiece ? 'grab' : 'default';
  else if (mode === 'erase' || mode === 'grow' || mode === 'sink' || mode === 'paint' || mode === 'shape' || mode === 'bevel' || mode === 'face') canvas.style.cursor = overPiece ? 'pointer' : 'default';
  else canvas.style.cursor = 'default';
}

// Plano de trabajo: con uno activo, los puntos de Cortar y Rellenar se marcan sobre él en vez de sobre las piezas.
const AXES: Record<string, number> = { x: 0, y: 1, z: 2 };
let workPlane: { axis: number; value: number } | null = null;
let workPlaneMesh: THREE.Mesh | null = null;
const planeAxisEl = document.getElementById('planeAxis') as HTMLSelectElement;
const planeValueEl = document.getElementById('planeValue') as HTMLInputElement;
function syncWorkPlane(): void {
  const axis = planeAxisEl.value;
  if (workPlaneMesh) {
    scene3d.remove(workPlaneMesh);
    workPlaneMesh.geometry.dispose();
    (workPlaneMesh.material as THREE.Material).dispose();
    workPlaneMesh = null;
  }
  if (!axis) {
    workPlane = null;
    return;
  }
  const value = Number(planeValueEl.value);
  workPlane = { axis: AXES[axis], value: Number.isFinite(value) ? value : 0 };
  workPlaneMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(gridSize, gridSize),
    new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  );
  if (workPlane.axis === 1) workPlaneMesh.rotation.x = -Math.PI / 2;
  else if (workPlane.axis === 0) workPlaneMesh.rotation.y = Math.PI / 2;
  workPlaneMesh.position.set(0, gridSize / 2, 0);
  workPlaneMesh.position.setComponent(workPlane.axis, workPlane.value);
  workPlaneMesh.raycast = () => {};
  scene3d.add(workPlaneMesh);
}
planeAxisEl.addEventListener('change', () => {
  syncWorkPlane();
  planeAxisEl.blur();
});
planeValueEl.addEventListener('change', syncWorkPlane);
document.querySelectorAll<HTMLButtonElement>('[data-plane]').forEach((button) =>
  button.addEventListener('click', () => {
    planeValueEl.value = String((Number(planeValueEl.value) || 0) + (button.dataset.plane === '+' ? 0.5 : -0.5));
    syncWorkPlane();
  }),
);
planeValueEl.value = '0';

/** Aristas prolongadas y vértices virtuales de la zona que apunta el cursor, para ver de dónde sale cada punto. */
const guideOverlay = new THREE.Group();
scene3d.add(guideOverlay);
const GUIDE_RADIUS = 1.5;
const MAX_GUIDE_LINES = 60;

/** Muestra solo los puntos de las caras que se ven (no los que quedan detrás de otra cara). */
let visibleVerticesOnly = true;
const visibleOnlyEl = document.getElementById('visibleOnly') as HTMLInputElement;
visibleOnlyEl.addEventListener('change', () => {
  visibleVerticesOnly = visibleOnlyEl.checked;
  visibleOnlyEl.blur();
});

function showGuides(guides: Guides | null, center?: Vec3): void {
  for (const child of [...guideOverlay.children]) {
    guideOverlay.remove(child);
    disposeObject(child);
  }
  if (!guides || !center) return;
  const near = (p: Vec3) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) < GUIDE_RADIUS;
  const positions: number[] = [];
  for (const [a, b] of guides.lines.slice(0, MAX_GUIDE_LINES)) positions.push(...a, ...b);
  const shadows: number[] = [];
  for (const [a, b] of guides.projected.slice(0, MAX_GUIDE_LINES)) shadows.push(...a, ...b);
  // Naranja: aristas prolongadas del mismo plano; turquesa tenue: aristas de piezas vecinas proyectadas sobre la cara.
  for (const [coords, color, opacity] of [[positions, 0xffb020, 0.8], [shadows, 0x35d0c0, 0.45]] as const) {
    if (coords.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords as number[], 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    lines.renderOrder = 9;
    guideOverlay.add(lines);
  }
  // Con "solo vértices visibles" los puntos se dibujan con profundidad: los que quedan detrás de una cara no se ven.
  const dotMaterial = (color: number, opacity?: number): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color, transparent: opacity !== undefined, opacity: opacity ?? 1, depthTest: visibleVerticesOnly, depthWrite: false });
  // Con muchos puntos (Máximo) cada uno como malla propia sería lento: todos van en una sola malla instanciada.
  const gridNear = guides.grid.filter(near);
  if (gridNear.length > 0) {
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 6, 4), dotMaterial(0xd8dcea, 0.85), gridNear.length);
    const at = new THREE.Matrix4();
    gridNear.forEach((p, k) => dots.setMatrixAt(k, at.makeTranslation(p[0], p[1], p[2])));
    dots.renderOrder = 9;
    dots.frustumCulled = false;
    guideOverlay.add(dots);
  }
  for (const p of guides.points.filter(near)) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), dotMaterial(0x9a7bff));
    dot.position.set(p[0], p[1], p[2]);
    dot.renderOrder = 9;
    guideOverlay.add(dot);
  }
}

/** «Puntos por arista»: en cuántas partes se divide cada arista y cada cara para marcar puntos en Cortar, Rellenar, Figura y Punto guía, y al añadir un vértice en Malla (0: solo vértices / libre). */
let snapDivisions = 4;
const snapRowEl = document.getElementById('snapRow')!;
const snapDensityEl = document.getElementById('snapDensity') as HTMLSelectElement;
snapDensityEl.addEventListener('change', () => {
  snapDivisions = Number(snapDensityEl.value);
  vertexTool.setDivisions(snapDivisions);
  meshTool.edgeDivisions = snapDivisions;
  snapDensityEl.blur();
});

/** Verdadero si ninguna cara tapa el punto visto desde la cámara (los que están sobre una cara visible cuentan). */
const visibilityRay = new THREE.Raycaster();
function pointVisible(p: Vec3): boolean {
  const from = camera.position;
  const dir = new THREE.Vector3(p[0] - from.x, p[1] - from.y, p[2] - from.z);
  const distance = dir.length();
  if (distance < 1e-6) return true;
  visibilityRay.set(from, dir.divideScalar(distance));
  batches.flush();
  const first = visibilityRay.intersectObjects([...objects.values(), ...batches.meshes()], true).find((hit) => hit.object instanceof THREE.Mesh);
  return !first || first.distance > distance - 0.03;
}

/** A cuántos píxeles del cursor un vértice se "agarra" al marcar puntos, aunque el rayo del cursor no toque la pieza (esquinas del contorno). */
const VERTEX_GRAB_PX = 12;
const viewProjection = new THREE.Matrix4();

/**
 * El vértice (de una pieza o punto de referencia) más cercano al cursor en pantalla, si está a menos de VERTEX_GRAB_PX.
 * Sirve para esquinas de otra figura que el rayo roza sin tocar: sin esto el punto caía al suelo o a la cara de atrás.
 */
function screenVertex(event: PointerEvent): Vec3 | null {
  const rect = renderer.domElement.getBoundingClientRect();
  camera.updateMatrixWorld();
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = viewProjection.elements;
  const candidates: { p: Vec3; dist: number }[] = [];
  const consider = (p: Vec3): void => {
    const w = e[3] * p[0] + e[7] * p[1] + e[11] * p[2] + e[15];
    if (w <= 0) return;
    const x = rect.left + (((e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12]) / w + 1) / 2) * rect.width;
    const y = rect.top + ((1 - (e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13]) / w) / 2) * rect.height;
    const dist = Math.hypot(x - event.clientX, y - event.clientY);
    if (dist < VERTEX_GRAB_PX) candidates.push({ p, dist });
  };
  for (const p of model.points()) consider(p);
  for (const piece of model.all()) {
    if (hidden.has(piece.id)) continue;
    for (const face of piece.faces) for (const p of face) consider(p);
  }
  candidates.sort((a, b) => a.dist - b.dist);
  // El más cercano a la vista que no esté tapado (con "Solo visibles"); sin la casilla, el más cercano al cursor.
  for (const { p } of candidates.slice(0, 12)) if (!visibleVerticesOnly || pointVisible(p)) return p;
  return null;
}

/** Punto que se marcaría ahora: sobre el plano de trabajo si hay uno, si no sobre lo que apunta el cursor. */
function markTarget(event: PointerEvent, hit: THREE.Intersection | undefined): Vec3 | null {
  const center = (point: THREE.Vector3): Vec3 => [point.x, point.y, point.z];
  const options = (point: THREE.Vector3): SnapOptions => ({ edge: event.altKey, divisions: snapDivisions, isVisible: visibleVerticesOnly ? pointVisible : undefined, onGuides: (guides) => showGuides(guides, center(point)) });
  if (!workPlane) {
    // Un vértice a pocos píxeles del cursor gana a todo lo demás: así se pueden marcar las esquinas de otra figura.
    const grabbed = screenVertex(event);
    if (grabbed) {
      showGuides(null);
      return grabbed;
    }
    if (!hit) showGuides(null);
    return hit ? snapPoint(hit.point, model, options(hit.point)) : null;
  }
  const normal = new THREE.Vector3();
  normal.setComponent(workPlane.axis, 1);
  const point = raycaster.ray.intersectPlane(new THREE.Plane(normal, -workPlane.value), new THREE.Vector3());
  if (!point) return null;
  const snapped = snapPoint(point, model, options(point));
  // Un candidato fuera del plano se descarta: el punto va a la rejilla, dentro del plano.
  if (Math.abs(snapped[workPlane.axis] - workPlane.value) < 1e-4) return snapped;
  const grid: Vec3 = [Math.round(point.x / 0.5) * 0.5, Math.round(point.y / (1 / 6)) * (1 / 6), Math.round(point.z / 0.5) * 0.5];
  grid[workPlane.axis] = workPlane.value;
  return grid;
}

/** Muestra las coordenadas del punto que se marcaría, para poder comprobarlo antes de hacer clic. */
function showPointInfo(point: Vec3 | null): void {
  if (!point) return;
  const r = (v: number) => (Math.round(v * 1000) / 1000).toString();
  statusEl.textContent = `Punto (${r(point[0])}, ${r(point[1])}, ${r(point[2])}) · X, Y, Z · Alt: sobre la arista`;
}

/** Añade un punto a Cortar o Rellenar; si el cursor está a pocos píxeles del primero, cierra en vez de marcar uno nuevo. */
function addToolPoint(tool: CutTool | FillTool | OutlineTool, point: Vec3, minToClose: number, event: PointerEvent): void {
  const first = tool.firstPoint;
  if (first && tool.pointCount >= minToClose) {
    const s = screenOf(first);
    if (s && Math.hypot(s.x - event.clientX, s.y - event.clientY) < 14) point = first;
  }
  tool.addPoint(point);
}

/** Ctrl (o Cmd en Mac) pulsado: el modificador de los clics (sumar a la selección, borrar al colocar, toda la pieza, etc.). */
function withCtrl(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey;
}

function updateHover(event: PointerEvent): void {
  // La herramienta de malla lleva su propio ratón.
  if (mode === 'mesh') return;
  if (mode === 'vertex' && !marquee && !drag && !growDrag) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const view = camera.matrixWorld.elements.map((v) => v.toFixed(3)).join(',');
    vertexTool.hoverAt({ x: event.clientX, y: event.clientY }, raycaster.ray, screenOf, event.altKey, visibleVerticesOnly ? pointVisible : null, view);
    updateCursor(false);
    return;
  }
  if (marquee) {
    updateMarquee(event);
    return;
  }
  if (growDrag) {
    updateGrowDrag(event);
    updateCursor(true);
    return;
  }
  if (drag) {
    updateDrag(event);
    updateCursor(true);
    return;
  }
  const hit = castRay(event, true);
  updateCursor(hit !== undefined && !backdrops.includes(hit.object));
  if (mode !== 'cut' && mode !== 'fill' && mode !== 'outline') showGuides(null);
  if (mode === 'cut') {
    snapped = markTarget(event, hit);
    showPointInfo(snapped);
    cutTool.setHover(snapped);
    setFaceHover(withCtrl(event) && hit && !backdrops.includes(hit.object) ? findFace(hit) : undefined);
    return;
  }
  if (mode === 'fill') {
    snapped = markTarget(event, hit);
    showPointInfo(snapped);
    fillTool.setHover(snapped);
    return;
  }
  if (mode === 'outline') {
    snapped = markTarget(event, hit);
    showPointInfo(snapped);
    outlineTool.setHover(snapped);
    return;
  }
  if (mode === 'grow' || mode === 'sink') {
    setFaceHover(hit && !backdrops.includes(hit.object) ? findFace(hit) : undefined, growWhole(event));
    return;
  }
  if (mode === 'paint') {
    const found = hit && !backdrops.includes(hit.object) ? findFace(hit) : undefined;
    setFaceHover(found);
    if (found && pixelPanel.painting()) pixelPanel.noteFace(found.piece, found.face);
    statusEl.textContent = found ? (pixelPanel.painting() ? 'Arrastra: pintar píxeles · Alt: tomar el color del píxel' : 'Clic: pintar la cara · Ctrl: toda la pieza · Alt: tomar su color') : '';
    return;
  }
  if (mode === 'face') {
    const found = hit && !backdrops.includes(hit.object) ? findFace(hit) : undefined;
    setFaceHover(found);
    statusEl.textContent = found ? faceToolLabel() : '';
    return;
  }
  if (mode === 'erase') {
    const mark = markUnder(event);
    if (mark) {
      setEraseHover(undefined);
      setMarkHover(mark);
      statusEl.textContent = 'Clic para borrar el punto guía';
      return;
    }
    setMarkHover(null);
    const id = pieceIdOf(hit);
    setEraseHover(id === undefined ? undefined : model.get(id));
    if (id === undefined) statusEl.textContent = '';
  }
  if (mode === 'shape') {
    setShapeHover(hit && hit.face ? hit : undefined);
    return;
  }
  if (mode === 'bevel') {
    setBevelHover(hit && !backdrops.includes(hit.object) ? hit : undefined);
    return;
  }
  if (mode === 'select' || mode === 'erase') {
    placement.release();
    return;
  }
  placement.aim(hit);
}

function removeAt(event: PointerEvent): void {
  const mark = markUnder(event);
  if (mark) {
    model.apply({ added: [], removed: [], marksRemoved: withSymmetryPoints([mark], symmetry) });
    setMarkHover(null);
    return;
  }
  const id = pieceIdOf(castRay(event, false));
  const piece = id === undefined ? undefined : model.get(id);
  if (piece) model.apply({ added: [], removed: counterparts(piece) });
}

// Piezas ocultas, capas y lista de grupos (ui/layersPanel.ts).
const layersPanel = createLayersPanel({
  model,
  selection,
  batches,
  textureLayer: { add: (piece) => textureLayer.add(piece), remove: (id) => textureLayer.remove(id) },
  selectedPieces: () => selectedPieces(),
  selectTool: () => setMode('select'),
  markEdited: () => {
    files.markDirty();
    files.syncFileName();
  },
  scheduleAutosave: () => files.scheduleAutosave(),
});
const { hidden, layers, showPiece, hidePieces, showHidden, hideSelected, isolateSelected, applyLayerState, refreshLayers, refreshGroups } = layersPanel;

// Colocar: la sombra de la pieza y dónde cae (ui/placement.ts).
const placement = createPlacement({
  scene3d,
  model,
  hidden,
  mode: () => mode,
  selected: () => selected,
  rotation: () => rotation,
  color: () => color,
  gridSize: () => gridSize,
  placeSize: () => placeSizeOf(),
  slabThick: () => slabThickOf(),
  expand: (pieces) => expand(pieces),
  useColor: (c) => useColor(c),
  pieceIdOf: (hit) => pieceIdOf(hit),
});

// Panel «Selección»: las acciones sobre las piezas elegidas (selActions) y sus campos de centro, tamaño y giro (inspectorFields).
// Aparece al elegir algo; con el portapapeles lleno y nada elegido se queda solo con las acciones (para poder pegar).
const inspectorEl = document.getElementById('inspector')!;
const inspectorFieldsEl = document.getElementById('inspectorFields')!;
const selActionsEl = document.getElementById('selActions')!;
const insInput = (name: string) => inspectorEl.querySelector<HTMLInputElement>(`[data-ins="${name}"]`)!;
let rotSign = 1;
function syncInspector(): void {
  const box = boundsOf(selectedPieces());
  inspectorFieldsEl.hidden = !box;
  inspectorEl.hidden = !box && selActionsEl.hidden;
  if (!box || inspectorEl.contains(document.activeElement)) return;
  const r = (v: number) => String(Math.round(v * 1000) / 1000);
  (['x', 'y', 'z'] as const).forEach((axis, i) => {
    insInput(`p${axis}`).value = r((box.min[i] + box.max[i]) / 2);
    insInput(`s${axis}`).value = r(box.max[i] - box.min[i]);
  });
}
inspectorEl.addEventListener('change', (e) => {
  const name = (e.target as HTMLElement).dataset.ins;
  const pieces = selectedPieces();
  const box = boundsOf(pieces);
  if (!name || !box || pieces.length === 0) return;
  const i = 'xyz'.indexOf(name[1]);
  const value = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return syncInspector();
  if (name[0] === 'p') {
    const center = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2) as Vec3;
    center[i] = value;
    commitTransform(centerChange(pieces, center));
  } else {
    const current = box.max[i] - box.min[i];
    const factors: Vec3 = [1, 1, 1];
    factors[i] = value / (current || 1);
    commitTransform(scaleChange(pieces, factors));
  }
  (document.activeElement as HTMLElement | null)?.blur();
  syncInspector();
});
inspectorEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.dataset.rotSign) {
    rotSign = -rotSign;
    target.textContent = rotSign > 0 ? '±' : '∓';
    return;
  }
  const axis = target.dataset.rot as 'x' | 'y' | 'z' | undefined;
  if (!axis) return;
  const angle = Number((document.getElementById('rotAngle') as HTMLInputElement).value);
  if (!Number.isFinite(angle) || angle === 0) return;
  commitTransform(rotateFreeChange(selectedPieces(), axis, angle * rotSign));
  syncInspector();
});

/** Ids de la pieza y de las demás de su grupo, si lo tiene. */
function groupIds(id: number): number[] {
  const piece = model.get(id);
  if (!piece || piece.group === undefined) return [id];
  return model.all().filter((other) => other.group === piece.group).map((other) => other.id);
}

/** Añade o quita de la selección una pieza y todo su grupo: si ya estaba entera elegida la quita, si no la suma. */
function toggleGroup(id: number): void {
  const ids = groupIds(id);
  if (ids.every((member) => selection.has(member))) selection.remove(ids);
  else selection.set([...selection.list(), ...ids]);
}

/** Texto de estado con el número de piezas elegidas y la caja que ocupan (en celdas). */
function selectionLabel(): string {
  const size = sizeOf(selectedPieces());
  if (!size) return '';
  const round = (v: number) => Math.round(v * 100) / 100;
  return `${selection.size} elegida(s) · ${round(size[0])} × ${round(size[2])} celdas, alto ${round(size[1])} celdas (X × Z, Y)`;
}

/** Clic elige una pieza (y su grupo); Ctrl+clic la añade o quita; clic en vacío limpia la selección. */
function selectAt(event: PointerEvent): void {
  const id = pieceIdOf(castRay(event, false));
  if (id === undefined) {
    if (!withCtrl(event)) selection.clear();
    return;
  }
  if (withCtrl(event)) toggleGroup(id);
  else selection.set(groupIds(id));
}

/** Une las piezas elegidas en un grupo nuevo; entra en el historial. */
function groupSelected(): void {
  const pieces = selectedPieces();
  if (pieces.length < 2) {
    statusEl.textContent = 'Elige al menos dos piezas para agruparlas';
    return;
  }
  const group = newGroupId();
  const added = pieces.map((piece) => withGroup(piece, group));
  model.apply({ added, removed: pieces });
  selection.set(added.map((piece) => piece.id));
  statusEl.textContent = `Grupo de ${added.length} piezas: se eligen y mueven juntas`;
}

/** Deshace los grupos de las piezas elegidas. */
function ungroupSelected(): void {
  const pieces = selectedPieces().filter((piece) => piece.group !== undefined);
  if (pieces.length === 0) return;
  const added = pieces.map((piece) => withGroup(piece, undefined));
  model.apply({ added, removed: pieces });
  selection.set(added.map((piece) => piece.id));
  statusEl.textContent = 'Grupo deshecho';
}

/** Suma a la selección todas las piezas que tocan a las elegidas, directa o indirectamente. */
function selectConnected(): void {
  if (selection.size === 0) return;
  const found = connectedPieces(selectedPieces(), model.all());
  const ids = new Set(found.map((piece) => piece.id));
  for (const piece of found) for (const id of groupIds(piece.id)) ids.add(id);
  selection.set(ids);
}

function deleteSelected(): void {
  const pieces = model.all().filter((piece) => selection.has(piece.id));
  if (pieces.length > 0) model.apply({ added: [], removed: pieces });
}

/** Mover o girar sustituye las piezas por copias transformadas, así que entra en el historial. */
function commitTransform(change: Change): void {
  model.apply(change);
  selection.set(change.added.map((piece) => piece.id));
}

function selectedPieces(): Piece[] {
  return model.all().filter((piece) => selection.has(piece.id));
}

let clipboard: Piece[] = [];
let pasteCount = 0;

function copySelected(): void {
  const pieces = selectedPieces();
  if (pieces.length === 0) return;
  clipboard = pieces;
  pasteCount = 0;
  statusEl.textContent = `Copiadas ${pieces.length} pieza(s). Ctrl+V para pegar`;
  syncSelectionActions();
}

/** Pega copias desplazadas una celda en X y Z (más con cada pegado) y las deja seleccionadas para moverlas. */
function pasteClipboard(): void {
  if (clipboard.length === 0) return;
  pasteCount++;
  // Cada grupo copiado pasa a ser un grupo propio: la copia no se une al original.
  const groupMap = new Map<number, number>();
  const added = clipboard.map((piece) => {
    const copy = translatePiece(piece, pasteCount, 0, pasteCount);
    if (piece.group === undefined) return copy;
    if (!groupMap.has(piece.group)) groupMap.set(piece.group, newGroupId());
    return withGroup(copy, groupMap.get(piece.group), piece.groupName);
  });
  setMode('select');
  model.apply({ added, removed: [] });
  selection.set(added.map((piece) => piece.id));
  statusEl.textContent = `Pegadas ${added.length} pieza(s): muévelas con las flechas o arrastrando`;
}

function mirrorSelected(axis: Axis): void {
  if (selection.size === 0) return;
  commitTransform(mirrorChange(selectedPieces(), axis));
}

/** Copia reflejada de la selección respecto al plano de simetría (por defecto el origen); la copia queda elegida para moverla. */
function mirrorCopySelected(axis: 'x' | 'z'): void {
  if (selection.size === 0) return;
  const center = symmetry.center[axis === 'x' ? 0 : 2];
  const change = mirrorCopyChange(selectedPieces(), axis, center, newGroupId);
  model.apply(change);
  selection.set(change.added.map((piece) => piece.id));
  statusEl.textContent = `Copia reflejada sobre ${axis.toUpperCase()} = ${center}: ${change.added.length} pieza(s)`;
}

function syncSelectionActions(): void {
  selActionsEl.hidden = mode === 'cut' || mode === 'fill' || mode === 'outline' || mode === 'vertex' || mode === 'mesh' || (selection.size === 0 && clipboard.length === 0);
  inspectorEl.hidden = selActionsEl.hidden && inspectorFieldsEl.hidden;
  const parts = partsOf(selectedPieces()).length;
  for (const button of selActionsEl.querySelectorAll<HTMLButtonElement>('button')) {
    const action = button.dataset.sel;
    button.disabled = action === 'paste' ? clipboard.length === 0 : action === 'slivers' ? false : action === 'align' ? parts < 2 : action === 'distribute' ? parts < 3 : selection.size === 0;
  }
}

/** Alinea a ras las partes de la selección (un grupo cuenta como una) por el borde menor, el centro o el borde mayor. */
function alignSelected(axis: 'x' | 'y' | 'z', edge: 'min' | 'center' | 'max'): void {
  commitTransform(alignChange(selectedPieces(), axis, edge));
}
/** Reparte las partes de la selección con huecos iguales; las de los extremos no se mueven. */
function distributeSelected(axis: 'x' | 'y' | 'z'): void {
  commitTransform(distributeChange(selectedPieces(), axis));
}
function groundSelected(): void {
  commitTransform(groundChange(selectedPieces()));
}
/** Pregunta la medida de la dimensión mayor y escala la selección conservando las proporciones. */
function resizeSelected(): void {
  const box = boundsOf(selectedPieces());
  if (!box) return;
  const current = Math.max(...[0, 1, 2].map((k) => box.max[k] - box.min[k]));
  const text = window.prompt('Medida de la dimensión mayor, en celdas (se conservan las proporciones)', String(Math.round(current * 1000) / 1000));
  const value = text === null ? NaN : Number(text.replace(',', '.'));
  if (Number.isFinite(value) && value > 0) commitTransform(resizeLongestChange(selectedPieces(), value));
}
/** Quita las piezas diminutas que dejan los cortes muy seguidos: con selección actúa sobre ella; sin selección, sobre las piezas que se pueden editar. */
function cleanSlivers(): void {
  const scope = selection.size > 0 ? selectedPieces() : model.editable();
  const slivers = findSlivers(scope);
  if (slivers.length === 0) {
    statusEl.textContent = 'No hay astillas: ninguna pieza es tan pequeña';
    return;
  }
  model.apply({ added: [], removed: slivers });
  statusEl.textContent = `Quitadas ${slivers.length} astilla(s). Ctrl+Z para volver atrás`;
}
const alignEdgeEl = document.getElementById('alignEdge') as HTMLSelectElement;
alignEdgeEl.addEventListener('change', () => alignEdgeEl.blur());

selActionsEl.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('[data-sel]');
  const action = button?.dataset.sel;
  const axis = button?.dataset.ax as 'x' | 'y' | 'z' | undefined;
  if (action === 'align' && axis) alignSelected(axis, alignEdgeEl.value as 'min' | 'center' | 'max');
  else if (action === 'distribute' && axis) distributeSelected(axis);
  else if (action === 'ground') groundSelected();
  else if (action === 'resize') resizeSelected();
  else if (action === 'slivers') cleanSlivers();
  else if (action === 'mirror-copy-x') mirrorCopySelected('x');
  else if (action === 'mirror-copy-z') mirrorCopySelected('z');
  else if (action === 'hide') hideSelected();
  else if (action === 'isolate') isolateSelected();
  else if (action === 'group') groupSelected();
  else if (action === 'ungroup') ungroupSelected();
  else if (action === 'connected') selectConnected();
  else if (action === 'copy') copySelected();
  else if (action === 'paste') pasteClipboard();
  else if (action === 'excavate') excavateSelected();
  else if (action === 'merge') mergeSelected();
  else if (action === 'mirror-x') mirrorSelected('x');
  else if (action === 'mirror-y') mirrorSelected('y');
  else if (action === 'mirror-z') mirrorSelected('z');
  else if (action === 'delete') deleteSelected();
});

/** Ejes del suelo más alineados con la vista, para que las flechas sigan lo que ves en pantalla. */
function cameraAxes(): { forward: [number, number]; right: [number, number] } {
  const d = camera.getWorldDirection(new THREE.Vector3());
  const forward: [number, number] = Math.abs(d.x) > Math.abs(d.z) ? [Math.sign(d.x), 0] : [0, Math.sign(d.z)];
  return { forward, right: [-forward[1], forward[0]] };
}

/** Eje al que se limita el arrastre de piezas con la herramienta Elegir (sin valor: libre). */
let pieceAxis: AxisLock = null;

interface Drag {
  id: number;
  axis: AxisLock;
  wasSelected: boolean;
  vertical: boolean;
  plane: THREE.Plane;
  origin: THREE.Vector3;
  startX: number;
  startY: number;
  moved: boolean;
  offset: THREE.Vector3;
}
let drag: Drag | null = null;

/** Imán al mover piezas y vértices: con él caen en la rejilla, sin él (por defecto) siguen al ratón. Se recuerda en el navegador. */
let magnet = false;
try {
  magnet = localStorage.getItem('gridfacet.magnet') === '1';
} catch {
  // Sin almacenamiento empieza sin imán.
}
const snapTo = (value: number, step: number): number => (magnet ? Math.round(value / step) * step || 0 : value);

function selectedObjects(): THREE.Object3D[] {
  return [...objects].filter(([id]) => selection.has(id)).map(([, object]) => object);
}

interface Marquee {
  startX: number;
  startY: number;
  moved: boolean;
}
let marquee: Marquee | null = null;
const marqueeEl = document.getElementById('marquee')!;

/** Ctrl + arrastrar desde un hueco dibuja un recuadro; al soltar se suman a la selección las piezas cuyo centro queda dentro. */
function startMarquee(event: PointerEvent): void {
  controls.enabled = false;
  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch {
    // Sin captura el recuadro sigue funcionando mientras el puntero esté sobre el lienzo.
  }
  marquee = { startX: event.clientX, startY: event.clientY, moved: false };
}

function updateMarquee(event: PointerEvent): void {
  if (!marquee) return;
  if (!marquee.moved && Math.hypot(event.clientX - marquee.startX, event.clientY - marquee.startY) <= CLICK_MAX_MOVE) return;
  marquee.moved = true;
  const left = Math.min(marquee.startX, event.clientX);
  const top = Math.min(marquee.startY, event.clientY);
  Object.assign(marqueeEl.style, {
    display: 'block',
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.abs(event.clientX - marquee.startX)}px`,
    height: `${Math.abs(event.clientY - marquee.startY)}px`,
  });
}

function finishMarquee(commit: boolean, event?: PointerEvent): void {
  const current = marquee;
  if (!current) return;
  marquee = null;
  controls.enabled = true;
  marqueeEl.style.display = 'none';
  if (!commit || !event || !current.moved) return;

  const rect = renderer.domElement.getBoundingClientRect();
  const x0 = Math.min(current.startX, event.clientX);
  const x1 = Math.max(current.startX, event.clientX);
  const y0 = Math.min(current.startY, event.clientY);
  const y1 = Math.max(current.startY, event.clientY);
  camera.updateMatrixWorld();
  const inside: number[] = [];
  const center = new THREE.Vector3();
  for (const piece of model.all()) {
    // Como Ctrl+A: lo que está oculto (también por su capa) no se elige.
    if (hidden.has(piece.id)) continue;
    center.set(0, 0, 0);
    let count = 0;
    for (const face of piece.faces) for (const p of face) {
      center.x += p[0];
      center.y += p[1];
      center.z += p[2];
      count++;
    }
    center.divideScalar(count).project(camera);
    if (center.z < -1 || center.z > 1) continue;
    const sx = rect.left + ((center.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - center.y) / 2) * rect.height;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) inside.push(piece.id);
  }
  selection.set([...new Set([...selection.list(), ...inside.flatMap(groupIds)])]);
}

interface FaceHit {
  piece: Piece;
  face: Vec3[];
  normal: Vec3;
  point: THREE.Vector3;
}

/** Cara de pieza bajo el puntero (la que se haría crecer). */
function findFace(hit: THREE.Intersection): FaceHit | undefined {
  const id = pieceIdOf(hit);
  const piece = id === undefined ? undefined : model.get(id);
  if (!piece || !hit.face) return undefined;
  const point: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
  const face = faceAt(piece, point, [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z]);
  return face ? { piece, face, normal: unitNormal(face), point: hit.point.clone() } : undefined;
}

const ERASE_COLOR = 0xff3030;
let eraseOverlay: THREE.Object3D | null = null;
let eraseHoverId: number | undefined;

/** Resalta en rojo la pieza que se borraría con un clic; sin argumento, quita el resaltado. */
/** La pieza y, con simetría activa, las que ya existen en sus posiciones reflejadas. */
function counterparts(piece: Piece): Piece[] {
  const keys = new Set(withSymmetry([piece], symmetry).map(pieceKey));
  return keys.size === 1 ? [piece] : model.all().filter((candidate) => candidate.id === piece.id || keys.has(pieceKey(candidate)));
}

// Puntos de referencia: vértices sueltos siempre visibles, con su propio color.
const marksLayer = new THREE.Points(
  new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: 0x40e0ff, size: 8, sizeAttenuation: false, depthTest: false }),
);
marksLayer.renderOrder = 5;
marksLayer.frustumCulled = false;
marksLayer.raycast = () => {};
scene3d.add(marksLayer);
function refreshMarks(): void {
  marksLayer.geometry.dispose();
  marksLayer.geometry = new THREE.BufferGeometry().setFromPoints(model.points().map((p) => new THREE.Vector3(...p)));
}

/** Punto en pantalla de una posición 3D, en coordenadas del navegador; null si queda detrás de la cámara. */
function screenOf(p: Vec3): { x: number; y: number } | null {
  const rect = renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector3(...p).project(camera);
  if (v.z < -1 || v.z > 1) return null;
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
}

/** Punto de referencia bajo el cursor (a menos de 12 px), para borrarlo. */
let markCursor: THREE.Mesh | null = null;
function setMarkHover(point: Vec3 | null): void {
  if (markCursor) {
    scene3d.remove(markCursor);
    markCursor.geometry.dispose();
    (markCursor.material as THREE.Material).dispose();
    markCursor = null;
  }
  if (!point) return;
  markCursor = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3030, depthTest: false }));
  markCursor.position.set(...point);
  markCursor.renderOrder = 14;
  markCursor.raycast = () => {};
  scene3d.add(markCursor);
}
function markUnder(event: PointerEvent): Vec3 | null {
  let best: Vec3 | null = null;
  let bestDist = 12;
  for (const mark of model.points()) {
    const s = screenOf(mark);
    if (!s) continue;
    const dist = Math.hypot(s.x - event.clientX, s.y - event.clientY);
    if (dist < bestDist) {
      bestDist = dist;
      best = mark;
    }
  }
  return best;
}

function setEraseHover(piece: Piece | undefined): void {
  if (!piece) setMarkHover(null);
  if (piece?.id === eraseHoverId) return;
  eraseHoverId = piece?.id;
  if (eraseOverlay) {
    scene3d.remove(eraseOverlay);
    disposeObject(eraseOverlay);
    eraseOverlay = null;
    statusEl.textContent = '';
  }
  if (!piece) return;
  const group = new THREE.Group();
  for (const target of counterparts(piece)) group.add(createPieceObject({ ...target, color: ERASE_COLOR, faceColors: undefined }, true));
  eraseOverlay = group;
  scene3d.add(eraseOverlay);
  statusEl.textContent = 'Clic para borrar la pieza marcada en rojo';
}

let faceOverlay: THREE.Object3D | null = null;

function faceMesh(face: Vec3[], opacity: number): THREE.Mesh {
  const positions: number[] = [];
  for (let i = 1; i < face.length - 1; i++) for (const p of [face[0], face[i], face[i + 1]]) positions.push(...p);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.raycast = () => {};
  return mesh;
}

// Chaflán: la arista bajo el cursor se marca y un clic la corta en diagonal.
let bevelOverlay: THREE.LineSegments | null = null;
let bevelTarget: { piece: Piece; edge: PieceEdge } | null = null;
const bevelSizeEl = document.getElementById('bevelSize') as HTMLInputElement;
const bevelActionsEl = document.getElementById('bevelActions')!;
const syncBevelActions = (): void => {
  bevelActionsEl.hidden = mode !== 'bevel';
};

function setBevelHover(hit: THREE.Intersection | undefined): void {
  if (bevelOverlay) {
    scene3d.remove(bevelOverlay);
    bevelOverlay.geometry.dispose();
    (bevelOverlay.material as THREE.Material).dispose();
    bevelOverlay = null;
  }
  bevelTarget = null;
  if (!hit || mode !== 'bevel') return;
  const id = pieceIdOf(hit);
  const piece = id === undefined ? undefined : model.get(id);
  const edge = piece ? nearestEdge(piece, [hit.point.x, hit.point.y, hit.point.z], 0.35) : null;
  if (!piece || !edge) return;
  bevelTarget = { piece, edge };
  bevelOverlay = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...edge.a), new THREE.Vector3(...edge.b)]),
    new THREE.LineBasicMaterial({ color: 0xffd34d, depthTest: false }),
  );
  bevelOverlay.renderOrder = 15;
  bevelOverlay.raycast = () => {};
  scene3d.add(bevelOverlay);
}

/** Corta la arista marcada y, con simetría, sus reflejos en las piezas que ya existen allí. */
function bevelAt(): void {
  if (!bevelTarget) return;
  const size = Number(bevelSizeEl.value);
  if (!(size > 0)) {
    statusEl.textContent = 'El tamaño del chaflán debe ser mayor que 0';
    return;
  }
  const { piece, edge } = bevelTarget;
  const targets: { piece: Piece; edge: PieceEdge }[] = [{ piece, edge }];
  for (const reflection of reflections(symmetry)) {
    const key = pieceKey(reflectPiece(piece, reflection));
    const a = reflection.point(edge.a);
    const b = reflection.point(edge.b);
    for (const other of model.all()) {
      if (targets.some((t) => t.piece.id === other.id) || pieceKey(other) !== key) continue;
      const found = edgeBetween(other, a, b);
      if (found) targets.push({ piece: other, edge: found });
    }
  }
  const change: Change = { added: [], removed: [] };
  for (const t of targets) {
    const part = bevelChange(t.piece, t.edge, size);
    change.added.push(...part.added);
    change.removed.push(...part.removed);
  }
  if (change.removed.length === 0) {
    statusEl.textContent = 'Ese tamaño no cabe en la arista; prueba con uno menor';
    return;
  }
  model.apply(change);
  setBevelHover(undefined);
}

// Cara: extruir (sacar o cavar) o dividir a partir de la cara bajo el cursor.
const faceActionsEl = document.getElementById('faceActions')!;
const faceOpEl = document.getElementById('faceOp') as HTMLSelectElement;
const faceDistEl = document.getElementById('faceDist') as HTMLInputElement;
const faceTaperEl = document.getElementById('faceTaper') as HTMLInputElement;
const faceFractionEl = document.getElementById('faceFraction') as HTMLInputElement;
const faceInsetEl = document.getElementById('faceInset') as HTMLInputElement;
function syncFaceActions(): void {
  faceActionsEl.hidden = mode !== 'face';
  const extrude = faceOpEl.value === 'extrude';
  faceInsetEl.parentElement!.hidden = !extrude;
  faceDistEl.parentElement!.hidden = !extrude;
  faceTaperEl.parentElement!.hidden = !extrude;
  faceFractionEl.parentElement!.hidden = extrude;
}
faceActionsEl.addEventListener('change', syncFaceActions);

function faceToolLabel(): string {
  if (faceOpEl.value === 'split') return `Clic: dividir la pieza al ${Math.round(Number(faceFractionEl.value) * 100)} % de su fondo`;
  return Number(faceDistEl.value) < 0 ? 'Clic: cavar la cara hacia dentro' : 'Clic: sacar un cuerpo nuevo desde la cara';
}

function faceToolAt(event: PointerEvent): void {
  const hit = castRay(event, false);
  const found = hit ? findFace(hit) : undefined;
  if (!found) return;
  const index = found.piece.faces.indexOf(found.face);
  if (!isConvex(found.piece) && (faceOpEl.value === 'split' || Number(faceDistEl.value) < 0)) {
    statusEl.textContent = 'Es una malla libre: se puede sacar un cuerpo hacia fuera, pero no cavar ni dividir';
    return;
  }
  const change =
    faceOpEl.value === 'split'
      ? splitFaceChange(found.piece, index, Number(faceFractionEl.value))
      : extrudeFaceChange(found.piece, index, Number(faceDistEl.value), Number(faceTaperEl.value), Number(faceInsetEl.value));
  if (change.added.length === 0) {
    statusEl.textContent = 'No se pudo con esos valores: revisa la distancia, la punta o el porcentaje';
    return;
  }
  model.apply(change);
  setFaceHover(undefined);
  updateHover(event);
}

/** Resta de las demás piezas el volumen de las elegidas (cavar, perforar); las elegidas desaparecen. */
function excavateSelected(): void {
  const cutters = selectedPieces();
  if (cutters.length === 0) return;
  const targets = model.all().filter((piece) => !selection.has(piece.id));
  const change = excavateChange(targets, cutters);
  if (change.removed.length === 0) {
    statusEl.textContent = 'La selección no se solapa con ninguna otra pieza: colócala dentro de lo que quieres cavar';
    return;
  }
  commitTransform(change);
  statusEl.textContent = `Excavado: ${change.added.length} pieza(s) resultantes`;
}

/** Une las piezas elegidas en una sola: un cuerpo limpio si su unión es convexa; si no, las junta tal cual con todas sus caras. */
function mergeSelected(): void {
  const pieces = selectedPieces();
  const hull = mergeChange(pieces);
  // Si la unión no es convexa, las piezas se juntan tal cual en un solo bloque, con todas sus caras.
  const result = 'error' in hull ? joinChange(pieces) : hull;
  if ('error' in result) {
    statusEl.textContent = result.error;
    return;
  }
  commitTransform(result.change);
  statusEl.textContent = 'error' in hull ? 'Piezas unidas en un solo bloque (con todas sus caras)' : 'Piezas unidas en una';
}

const repeatEl = document.getElementById('repeatRow')!;
const repeatInput = (name: string): number => Number(repeatEl.querySelector<HTMLInputElement>(`[data-rep="${name}"]`)!.value);
/** Copia la selección en serie con el desplazamiento, giro y escala del panel. */
function repeatSelected(): void {
  const pieces = selectedPieces();
  if (pieces.length === 0) return;
  const change = repeatChange(pieces, {
    count: repeatInput('n'),
    move: [repeatInput('mx'), repeatInput('my'), repeatInput('mz')],
    rotate: [repeatInput('rx'), repeatInput('ry'), repeatInput('rz')],
    scale: repeatInput('s'),
  });
  if (change.added.length === 0) {
    statusEl.textContent = 'Revisa la cantidad (1 a 60) y que la escala sea mayor que 0';
    return;
  }
  model.apply(change);
  selection.set([...selection.list(), ...change.added.map((piece) => piece.id)]);
  statusEl.textContent = `${change.added.length} copias creadas`;
}
repeatEl.querySelector('button')!.addEventListener('click', repeatSelected);

// Triángulos de todas las piezas frente al presupuesto elegido (se recuerda entre sesiones).
const triStatsEl = document.getElementById('triStats')!;
const triBudgetEl = document.getElementById('triBudget') as HTMLInputElement;
const BUDGET_KEY = 'gridfacet.triBudget';
try {
  triBudgetEl.value = localStorage.getItem(BUDGET_KEY) ?? triBudgetEl.value;
} catch {
  // Sin almacenamiento se usa el valor por defecto.
}
function syncTriangles(): void {
  const tris = triangleCount(model.all());
  const budget = Number(triBudgetEl.value);
  triStatsEl.textContent = `${tris.toLocaleString('es')} triángulos · ${model.all().length} piezas`;
  triStatsEl.style.color = budget > 0 && tris > budget ? '#ff7a7a' : '';
}
triBudgetEl.addEventListener('change', () => {
  try {
    localStorage.setItem(BUDGET_KEY, triBudgetEl.value);
  } catch {
    // Sin almacenamiento el presupuesto vale solo para esta sesión.
  }
  syncTriangles();
});
syncTriangles();

// Formas: la forma elegida se previsualiza apoyada sobre lo que apunta el cursor.
const shapeSpec: ShapeSpec = { kind: 'sphere', size: [1, 1, 1], sides: 12 };
let shapeGhost: THREE.Group | null = null;
let shapeBase: Piece | null = null;
let shapeBaseKey = '';
let shapeCenter: Vec3 | null = null;
let shapeUp: Vec3 | undefined;
let shapeAuto = true;

/** Una sección de esfera con la cara plana apoyada en la superficie mira su cúpula hacia fuera de ella. */
function shapeFacing(normal: THREE.Vector3): Vec3 | undefined {
  const sectioned = shapeSpec.kind === 'sphere' && (shapeSpec.section ?? 'full') !== 'full';
  return shapeAuto && sectioned ? [normal.x, normal.y, normal.z] : undefined;
}

function rebuildShapeBase(): void {
  shapeBase = null;
  shapeBaseKey = '';
  setShapeHover(undefined);
}

function setShapeHover(hit: THREE.Intersection | undefined): void {
  if (shapeGhost) {
    scene3d.remove(shapeGhost);
    disposeObject(shapeGhost);
    shapeGhost = null;
  }
  shapeCenter = null;
  if (!hit || !hit.face || mode !== 'shape') return;
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const up = shapeFacing(normal);
  const key = up ? up.map((v) => v.toFixed(3)).join(',') : '-';
  if (!shapeBase || key !== shapeBaseKey) {
    shapeBase = buildShape(shapeSpec, [0, 0, 0], color, up);
    shapeBaseKey = key;
  }
  if (!shapeBase) return;
  // La forma se apoya con su punto más bajo (visto desde la superficie) sobre lo apuntado.
  const lowest = Math.min(...shapeBase.faces.flat().map((p) => p[0] * normal.x + p[1] * normal.y + p[2] * normal.z));
  const raw: Vec3 = [hit.point.x - normal.x * lowest, hit.point.y - normal.y * lowest, hit.point.z - normal.z * lowest];
  // Con una cara alineada con un eje, el centro se ajusta a un cuarto de celda en el plano de la cara y queda a ras en el otro.
  const axes = [normal.x, normal.y, normal.z].map(Math.abs);
  const dominant = axes.indexOf(Math.max(...axes));
  const aligned = axes[dominant] > 0.999;
  const steps = [0.25, 1 / 12, 0.25];
  shapeCenter = raw.map((v, i) => (aligned && i !== dominant ? Math.round(v / steps[i]) * steps[i] : v)) as Vec3;
  shapeUp = up;
  shapeGhost = new THREE.Group();
  shapeGhost.add(createPieceObject({ ...shapeBase, color }, true));
  shapeGhost.position.set(...shapeCenter);
  scene3d.add(shapeGhost);
}

function placeShape(): void {
  if (!shapeCenter) return;
  const piece = buildShape(shapeSpec, shapeCenter, color, shapeUp);
  if (piece) {
    model.apply({ added: expand([piece]), removed: [] });
    useColor(color);
  }
}

const shapeActionsEl = document.getElementById('shapeActions')!;
const sphereActionsEl = document.getElementById('sphereActions')!;
const shapeKindEl = document.getElementById('shapeKind') as HTMLSelectElement;
const shapeSectionEl = document.getElementById('shapeSection') as HTMLSelectElement;
for (const { kind, name } of SHAPES) shapeKindEl.add(new Option(name, kind));
for (const { kind, name } of SECTIONS) shapeSectionEl.add(new Option(name, kind));
function syncShapeActions(): void {
  shapeActionsEl.hidden = mode !== 'shape';
  sphereActionsEl.hidden = mode !== 'shape' || shapeKindEl.value !== 'sphere';
  document.getElementById('shapeCutRow')!.hidden = shapeSectionEl.value !== 'cap';
  document.getElementById('shapeAngleRow')!.hidden = shapeSectionEl.value !== 'wedge';
}
function readShapeInputs(): void {
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const num = (id: string, fallback: number) => {
    const value = Number(input(id).value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const any = (id: string, fallback: number) => {
    const value = Number(input(id).value);
    return Number.isFinite(value) ? value : fallback;
  };
  shapeSpec.kind = shapeKindEl.value as ShapeKind;
  shapeSpec.size = [num('shapeW', 1), num('shapeH', 1), num('shapeD', 1)];
  shapeSpec.sides = Math.max(MIN_SIDES, Math.min(MAX_SIDES, Math.round(num('shapeSides', 12))));
  shapeSpec.section = shapeSectionEl.value as SphereSection;
  shapeSpec.cut = Math.max(-0.9, Math.min(0.9, any('shapeCut', 0.4)));
  shapeSpec.angle = Math.max(10, Math.min(180, any('shapeAngle', 90)));
  shapeSpec.rings = Math.max(MIN_RINGS, Math.min(MAX_RINGS, Math.round(num('shapeRings', 4))));
  shapeSpec.turn = [any('shapeTurnX', 0), any('shapeTurnY', 0), any('shapeTurnZ', 0)];
  shapeAuto = input('shapeAuto').checked;
  syncShapeActions();
  rebuildShapeBase();
}
for (const id of ['shapeKind', 'shapeW', 'shapeH', 'shapeD', 'shapeSides', 'shapeSection', 'shapeCut', 'shapeAngle', 'shapeRings', 'shapeTurnX', 'shapeTurnY', 'shapeTurnZ', 'shapeAuto'])
  document.getElementById(id)!.addEventListener('change', readShapeInputs);
document.querySelectorAll<HTMLButtonElement>('[data-detail]').forEach((button) =>
  button.addEventListener('click', () => {
    const [sides, rings] = button.dataset.detail!.split(',');
    (document.getElementById('shapeSides') as HTMLInputElement).value = sides;
    (document.getElementById('shapeRings') as HTMLInputElement).value = rings;
    readShapeInputs();
  }),
);

/** R sobre una forma: gira 90° la cúpula sobre su eje (Y), para elegir hacia dónde queda el gajo. */
function turnShape(): void {
  const input = document.getElementById('shapeTurnY') as HTMLInputElement;
  input.value = String((((Number(input.value) || 0) + 90 + 180) % 360) - 180);
  readShapeInputs();
}

/** Cara bajo el cursor y sus reflejos, si hay simetría activa. */
function paintTargets(found: FaceHit, wholePiece: boolean): FaceRef[] {
  const index = found.piece.faces.indexOf(found.face);
  const centre = faceCentre(found.face);
  const refs: FaceRef[] = [{ piece: found.piece, index: wholePiece ? -1 : index }];
  for (const reflection of reflections(symmetry)) {
    const where = reflection.point(centre);
    const normal = reflection.dir(found.normal);
    for (const image of facesAt(model.all(), where, normal)) {
      refs.push(wholePiece ? { piece: image.piece, index: -1 } : image);
    }
  }
  return refs;
}

// Pintura de píxeles: dentro de Pintar, con la casilla "Píxeles" se pinta casilla a casilla en lugar de cara entera (ui/pixelPanel.ts).
const textureLayer = new TextureLayer();
scene3d.add(textureLayer.group);
const pixelPanel = createPixelPanel({
  scene3d,
  renderer,
  controls,
  model,
  statusEl,
  textureLayer,
  hidden,
  backdrops,
  symmetry: () => symmetry,
  mode: () => mode,
  color: () => color,
  setColor: (c) => setColor(c),
  useColor: (c) => useColor(c),
  castRay: (event, includeGround) => castRay(event, includeGround),
  findFace: (hit) => findFace(hit),
  clearFaceHover: () => setFaceHover(undefined),
  consumed: () => {
    down = null;
  },
});

// Malla: elegir y mover los vértices de las piezas. Una pieza con un vértice hundido deja de ser convexa y pasa a ser malla libre.
// «Mover en / Plano» es un solo componente: con Elegir limita el arrastre de las piezas (`pieceAxis`) y en Malla el de los vértices (`meshTool.axis`).
const axisRowEl = document.getElementById('axisRow')!;
function syncAxisRow(): void {
  const current = mode === 'mesh' ? meshTool.axis : pieceAxis;
  axisRowEl.querySelectorAll<HTMLButtonElement>('button[data-axis]').forEach((button) => {
    const axis = button.dataset.axis === 'free' ? null : Number(button.dataset.axis);
    button.classList.toggle('active', axis === current);
  });
}
axisRowEl.querySelectorAll<HTMLButtonElement>('button[data-axis]').forEach((button) =>
  button.addEventListener('click', () => {
    button.blur();
    const axis = button.dataset.axis === 'free' ? null : Number(button.dataset.axis);
    if (mode === 'mesh') {
      meshTool.setAxis(axis);
      return;
    }
    pieceAxis = axis;
    syncAxisRow();
    statusEl.textContent = pieceAxis === null ? 'Arrastre libre' : `Las piezas solo se mueven en ${lockLabel(pieceAxis)}`;
  }),
);
applyShortcutLabels();
const meshPanel = createMeshPanel({
  scene3d,
  camera,
  renderer,
  controls,
  model,
  statusEl,
  selectedPieces: () => selectedPieces(),
  isHidden: (piece) => hidden.has(piece.id) || layers.isHidden(piece),
  symmetry: () => symmetry,
  gridSize: () => gridSize,
  inMeshMode: () => mode === 'mesh',
  // Un clic que Malla se queda no llega al resto: el «pulsar» pendiente del lienzo quedaría viejo y el siguiente soltar lo tomaría por un clic.
  consumed: () => {
    down = null;
  },
  syncAxisRow: () => syncAxisRow(),
});
const meshTool = meshPanel.tool;
syncAxisRow();
meshTool.magnet = magnet;
const magnetEl = document.getElementById('magnet') as HTMLInputElement;
magnetEl.checked = magnet;
magnetEl.addEventListener('change', () => {
  magnet = magnetEl.checked;
  meshTool.magnet = magnet;
  magnetEl.blur();
  try {
    localStorage.setItem('gridfacet.magnet', magnet ? '1' : '0');
  } catch {
    // Sin almacenamiento vale solo para esta sesión.
  }
  statusEl.textContent = magnet ? 'Imán activado: piezas y vértices caen en la rejilla' : 'Imán desactivado: piezas y vértices siguen al ratón';
});
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__mesh = meshTool;

pixelPanel.bindPointer();

/** Clic en modo pintar: pinta la cara; con Ctrl, toda la pieza; con Alt, toma su color como color actual. */
function paintAt(event: PointerEvent): void {
  const hit = castRay(event, false);
  const found = hit ? findFace(hit) : undefined;
  if (!found) return;
  if (event.altKey) {
    setColor(faceColorOf(found.piece, found.piece.faces.indexOf(found.face)));
    return;
  }
  model.apply(paintChange(paintTargets(found, withCtrl(event)), color));
  useColor(color);
  setFaceHover(undefined);
  updateHover(event);
}

/** Resalta la cara apuntada; con `whole`, toda la cara conectada de la que forma parte. */
function setFaceHover(found: FaceHit | undefined, whole = false): void {
  if (faceOverlay) {
    scene3d.remove(faceOverlay);
    disposeObject(faceOverlay);
    faceOverlay = null;
  }
  if (!found) return;
  if (!whole) {
    faceOverlay = faceMesh(found.face, 0.4);
  } else {
    const group = new THREE.Group();
    for (const { face } of growFaces(found, true)) group.add(faceMesh(face, 0.4));
    faceOverlay = group;
  }
  scene3d.add(faceOverlay);
}

const growAllEl = document.getElementById('growAll') as HTMLInputElement;
const growActionsEl = document.getElementById('growActions')!;
growAllEl.addEventListener('change', () => growAllEl.blur());
/** ¿Crece toda la cara conectada? La casilla lo decide y Ctrl lo invierte mientras se pulsa. */
const growWhole = (event: { ctrlKey: boolean; metaKey: boolean }): boolean => growAllEl.checked !== withCtrl(event);
/** La cara apuntada, o toda la cara conectada (las caras del mismo plano que enlazan con ella y están a la vista). */
function growFaces(found: FaceHit, whole: boolean): FaceOf[] {
  return whole ? coplanarRegion({ piece: found.piece, face: found.face }, model.all()) : [{ piece: found.piece, face: found.face }];
}

interface GrowDrag {
  face: FaceHit;
  /** Las caras que crecen juntas: la apuntada o toda la cara conectada. */
  faces: FaceOf[];
  startX: number;
  startY: number;
  moved: boolean;
  distance: number;
  /** Hundir en vez de crecer: la distancia se cuenta hacia dentro. */
  sink: boolean;
  preview: THREE.Object3D | null;
}
let growDrag: GrowDrag | null = null;

/** Paso fino al arrastrar: un cuarto de celda, en horizontal y en vertical. */
const growStep = (normal: Vec3): number => (Math.abs(normal[1]) > 0.5 ? STEP_Y : STEP_XZ);
/**
 * Selector de cantidad: botones con valores fijos (`data-<attr>`, "auto" = sin valor) y un campo para un valor exacto.
 * Devuelve una función que da el valor actual (null = automático).
 */
function bindAmount(attr: string, input: HTMLInputElement, initial: number | null, max: () => number, onChange?: () => void): () => number | null {
  let current = initial;
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`)];
  const datasetKey = attr.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  const valueOf = (button: HTMLButtonElement): number | null => {
    const raw = button.dataset[datasetKey];
    return raw === 'auto' ? null : Number(raw);
  };
  const show = (): void => {
    for (const button of buttons) button.classList.toggle('active', valueOf(button) === current);
    input.value = current === null || buttons.some((b) => valueOf(b) === current) ? '' : String(+current.toFixed(3));
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      current = valueOf(button);
      show();
      onChange?.();
    });
  }
  input.addEventListener('input', () => {
    const value = Number(input.value);
    current = input.value !== '' && value > 0 && value <= max() ? value : initial;
    for (const button of buttons) button.classList.toggle('active', valueOf(button) === current && input.value === '');
    onChange?.();
  });
  show();
  return () => current;
}
// Tamaño al colocar: escala de la pieza (o lado de la lámina) y grosor de la lámina.
const placeSizeOf = bindAmount('place-size', document.getElementById('placeSizeInput') as HTMLInputElement, 1, () => 4, () => placement.refresh());
const slabThickOf = bindAmount('thick', document.getElementById('slabThickInput') as HTMLInputElement, 0.25, () => 4, () => placement.refresh());
const growAmountOf = bindAmount('grow-amount', document.getElementById('growAmount') as HTMLInputElement, null, () => gridSize);

/** Un clic sin arrastrar hace crecer lo elegido en el panel; en automático, una celda en horizontal o una placa en vertical. */
const growClickDistance = (normal: Vec3): number => growAmountOf() ?? (Math.abs(normal[1]) > 0.5 ? 1 / 4 : 1);

function showGrowPreview(): void {
  if (!growDrag) return;
  if (growDrag.preview) {
    scene3d.remove(growDrag.preview);
    disposeObject(growDrag.preview);
    growDrag.preview = null;
  }
  const preview = new THREE.Group();
  const shown = growDrag.sink ? sinkCutters(growDrag.faces, growDrag.distance) : expand(grownPieces(growDrag.faces, growDrag.distance));
  for (const piece of shown) preview.add(createPieceObject(piece, true));
  growDrag.preview = preview;
  scene3d.add(growDrag.preview);
}

/** Un prisma por cada cara, del color de esa cara. */
const grownPieces = (faces: FaceOf[], distance: number): Piece[] =>
  faces.map(({ piece, face }) => extrudeFace(face, faceColorOf(piece, piece.faces.indexOf(face)), distance));

function startGrow(event: PointerEvent): void {
  if ((mode !== 'grow' && mode !== 'sink') || event.button !== 0) return;
  const hit = castRay(event, false);
  const found = hit ? findFace(hit) : undefined;
  if (!found) return;
  controls.enabled = false;
  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch {
    // Sin captura el arrastre sigue funcionando mientras el puntero esté sobre el lienzo.
  }
  const faces = growFaces(found, growWhole(event));
  growDrag = { face: found, faces, startX: event.clientX, startY: event.clientY, moved: false, distance: growClickDistance(found.normal), sink: mode === 'sink', preview: null };
  showGrowPreview();
}

/** La distancia sale del punto de la línea de la normal más cercano al rayo del puntero. */
function updateGrowDrag(event: PointerEvent): void {
  if (!growDrag) return;
  if (!growDrag.moved && Math.hypot(event.clientX - growDrag.startX, event.clientY - growDrag.startY) <= CLICK_MAX_MOVE) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const n = new THREE.Vector3(...growDrag.face.normal);
  const d = raycaster.ray.direction;
  const w = growDrag.face.point.clone().sub(raycaster.ray.origin);
  const b = n.dot(d);
  const denominator = 1 - b * b;
  if (denominator < 1e-4) return;
  const t = (b * d.dot(w) - n.dot(w)) / denominator;
  const step = growStep(growDrag.face.normal);
  growDrag.moved = true;
  growDrag.distance = Math.max(step, Math.round((growDrag.sink ? -t : t) / step) * step);
  statusEl.textContent = `${growDrag.sink ? 'Hundir' : 'Crecer'} ${+growDrag.distance.toFixed(3)} (Esc cancela)`;
  showGrowPreview();
}

function finishGrow(commit: boolean): void {
  const current = growDrag;
  if (!current) return;
  growDrag = null;
  controls.enabled = true;
  if (current.preview) {
    scene3d.remove(current.preview);
    disposeObject(current.preview);
  }
  statusEl.textContent = '';
  if (!commit) return;
  if (current.sink) {
    const change = sinkFacesChange(current.faces, model.editable(), current.distance);
    if (change.removed.length === 0) {
      statusEl.textContent = 'No hay nada que hundir ahí';
      return;
    }
    model.apply(change);
    if (current.faces.length > 1) statusEl.textContent = `Se hundieron ${current.faces.length} caras juntas`;
    return;
  }
  model.apply({ added: expand(grownPieces(current.faces, current.distance)), removed: [] });
  if (current.faces.length > 1) statusEl.textContent = `Crecieron ${current.faces.length} caras juntas`;
}

/**
 * Arrastrar una pieza en modo elegir mueve la selección sobre un plano horizontal que pasa por el punto
 * agarrado; con Alt, sobre un plano vertical de cara a la cámara. Las piezas se desplazan en vivo y el
 * cambio solo entra en el modelo al soltar, como un único paso del historial.
 */
function startDrag(event: PointerEvent): void {
  startGrow(event);
  if (mode !== 'select' || event.button !== 0) return;
  if (withCtrl(event) && pieceIdOf(castRay(event, false)) === undefined) {
    startMarquee(event);
    return;
  }
  const hit = castRay(event, false);
  const id = pieceIdOf(hit);
  if (!hit || id === undefined) return;

  const wasSelected = selection.has(id);
  if (!wasSelected) {
    if (withCtrl(event)) toggleGroup(id);
    else selection.set(groupIds(id));
  }

  const plane = new THREE.Plane();
  let vertical = event.altKey || pieceAxis === 1;
  if (vertical) {
    const facing = camera.getWorldDirection(new THREE.Vector3());
    facing.y = 0;
    if (facing.length() < 1e-3) vertical = false;
    else plane.setFromNormalAndCoplanarPoint(facing.normalize(), hit.point);
  }
  if (!vertical) plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hit.point);
  // XY y YZ: un plano vertical fijo (de frente o de lado) en vez del suelo.
  const fixed = planeNormal(pieceAxis);
  if (fixed === 2 || fixed === 0) {
    vertical = false;
    plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(fixed === 0 ? 1 : 0, 0, fixed === 2 ? 1 : 0), hit.point);
  }

  controls.enabled = false;
  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch {
    // Sin captura el arrastre sigue funcionando mientras el puntero esté sobre el lienzo.
  }
  drag = {
    id,
    axis: pieceAxis,
    wasSelected,
    vertical,
    plane,
    origin: hit.point.clone(),
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    offset: new THREE.Vector3(),
  };
}

/**
 * Recorta un desplazamiento para que la selección no salga de la malla (X y Z entre ±mitad, Y de 0 al alto).
 * Una pieza que ya estaba fuera (tras achicar la malla) solo puede volver hacia dentro.
 */
function clampToGrid(dx: number, dy: number, dz: number): [number, number, number] {
  const box = boundsOf(selectedPieces());
  if (!box) return [dx, dy, dz];
  const half = gridSize / 2;
  const limits: [number, number][] = [[-half, half], [0, gridSize], [-half, half]];
  const clamp = (axis: number, d: number): number => {
    const low = Math.min(limits[axis][0] - box.min[axis], 0);
    const high = Math.max(limits[axis][1] - box.max[axis], 0);
    return Math.round(Math.min(Math.max(d, low), high) * 1e6) / 1e6;
  };
  return [clamp(0, dx), clamp(1, dy), clamp(2, dz)];
}

/** Mueve la selección con el teclado sin salirse de la malla. */
function moveSelectionBy(dx: number, dy: number, dz: number): void {
  const [x, y, z] = clampToGrid(dx, dy, dz);
  if (x === 0 && y === 0 && z === 0) {
    statusEl.textContent = 'Límite de la rejilla';
    return;
  }
  commitTransform(moveChange(selectedPieces(), x, y, z));
}

function updateDrag(event: PointerEvent): void {
  if (!drag) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= CLICK_MAX_MOVE) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const point = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
  if (!point) return;

  drag.moved = true;
  const delta = point.sub(drag.origin);
  const fixedAxis = planeNormal(drag.axis);
  if (fixedAxis === 2 || fixedAxis === 0) {
    const step = withCtrl(event) ? 2 * STEP_XZ : STEP_XZ;
    drag.offset.set(fixedAxis === 0 ? 0 : snapTo(delta.x, step), snapTo(delta.y, withCtrl(event) ? 2 * STEP_Y : STEP_Y), fixedAxis === 2 ? 0 : snapTo(delta.z, step));
  } else if (drag.vertical) {
    drag.offset.set(0, snapTo(delta.y, withCtrl(event) ? 2 * STEP_Y : STEP_Y), 0);
  } else {
    const step = withCtrl(event) ? 2 * STEP_XZ : STEP_XZ;
    drag.offset.set(drag.axis === 2 ? 0 : snapTo(delta.x, step), 0, drag.axis === 0 ? 0 : snapTo(delta.z, step));
  }
  drag.offset.set(...clampToGrid(drag.offset.x, drag.offset.y, drag.offset.z));
  for (const object of selectedObjects()) object.position.copy(drag.offset);
  textureLayer.setOffset(selection.list(), drag.offset);
  const { x, y, z } = drag.offset;
  statusEl.textContent = `Mover: X ${x}, Y ${+y.toFixed(3)}, Z ${z} (Esc cancela)`;
}

function finishDrag(commit: boolean, event?: PointerEvent): void {
  const current = drag;
  if (!current) return;
  drag = null;
  controls.enabled = true;
  for (const object of selectedObjects()) object.position.set(0, 0, 0);
  textureLayer.setOffset(selection.list(), new THREE.Vector3());
  if (!commit) {
    statusEl.textContent = selection.size > 0 ? selectionLabel() : '';
    return;
  }

  if (current.moved) {
    const { x, y, z } = current.offset;
    if (x !== 0 || y !== 0 || z !== 0) commitTransform(moveChange(selectedPieces(), x, y, z));
    else statusEl.textContent = selectionLabel();
    return;
  }
  // Sin arrastrar fue un clic: sobre una pieza ya elegida, estrecha o alterna la selección.
  if (current.wasSelected) {
    if (event && withCtrl(event)) toggleGroup(current.id);
    else selection.set(groupIds(current.id));
  }
}

let down: { x: number; y: number } | null = null;
// En fase de captura para desactivar la órbita antes de que la cámara reciba el mismo evento.
renderer.domElement.addEventListener('pointerdown', startDrag, { capture: true });
renderer.domElement.addEventListener(
  'pointerup',
  (e) => {
    if (marquee) {
      finishMarquee(true, e);
      down = null;
      return;
    }
    if (growDrag) {
      finishGrow(true);
      down = null;
      return;
    }
    if (!drag) return;
    finishDrag(true, e);
    down = null;
  },
  { capture: true },
);
renderer.domElement.addEventListener('pointercancel', () => {
  pixelPanel.finish(false);
  finishMarquee(false);
  finishDrag(false);
  finishGrow(false);
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 0) down = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointermove', updateHover);
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > CLICK_MAX_MOVE) return;
  updateHover(e);
  if (mode === 'cut') {
    if (withCtrl(e)) {
      const hit = castRay(e, false);
      const found = hit ? findFace(hit) : undefined;
      if (found) {
        setFaceHover(undefined);
        cutTool.useFace(found.face);
      } else statusEl.textContent = 'Ctrl+clic sobre una cara de una pieza para cortar con su plano';
      return;
    }
    if (snapped) addToolPoint(cutTool, snapped, 3, e);
    return;
  }
  if (mode === 'select') {
    selectAt(e);
    return;
  }
  if (mode === 'vertex') {
    vertexTool.click();
    return;
  }
  if (mode === 'fill') {
    if (snapped) addToolPoint(fillTool, snapped, 4, e);
    return;
  }
  if (mode === 'outline') {
    if (snapped) addToolPoint(outlineTool, snapped, 3, e);
    return;
  }
  if (mode === 'erase') {
    removeAt(e);
    setEraseHover(undefined);
    updateHover(e);
    return;
  }
  if (mode === 'paint') {
    // En píxeles el trazo ya se hizo al pulsar.
    if (!pixelPanel.painting()) paintAt(e);
    return;
  }
  if (mode === 'shape') {
    placeShape();
    return;
  }
  if (mode === 'bevel') {
    bevelAt();
    return;
  }
  if (mode === 'face') {
    faceToolAt(e);
    return;
  }
  if (mode === 'mesh') {
    // Shift+clic que no da en ningún vértice ni cara (un fallo al ir sumando vértices) no suelta lo que ya estaba elegido.
    if (e.shiftKey && meshTool.count > 0) {
      statusEl.textContent = 'Shift+clic en vacío: la elección se queda como estaba (clic sin Shift en vacío la suelta)';
      return;
    }
    // Clic en una pieza la elige (sus vértices son los que se muestran); en vacío suelta todo.
    const id = pieceIdOf(castRay(e, false));
    meshTool.clearSelection();
    if (id !== undefined) selection.set(groupIds(id));
    else selection.clear();
    return;
  }
  if (mode === 'grow' || mode === 'sink') return;
  if (withCtrl(e)) removeAt(e);
  else placement.place();
  updateHover(e);
});
renderer.domElement.addEventListener('pointerleave', () => {
  snapped = null;
  showGuides(null);
  placement.clear();
  if (mode === 'cut') cutTool.setHover(null);
  if (mode === 'fill') fillTool.setHover(null);
  if (mode === 'outline') outlineTool.setHover(null);
  if (mode === 'vertex') vertexTool.clearHover();
  if (mode === 'erase') setEraseHover(undefined);
  if (((mode === 'grow' || mode === 'sink') && !growDrag) || mode === 'paint' || mode === 'face') setFaceHover(undefined);
  if (mode === 'shape') setShapeHover(undefined);
  if (mode === 'bevel') setBevelHover(undefined);
});

// Vistas de cámara: mira al centro desde el eje elegido, a la distancia actual.
const VIEWS: Record<string, [number, number, number]> = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1],
};
function viewFrom(axis: string): void {
  const dir = VIEWS[axis];
  const distance = camera.position.distanceTo(controls.target);
  camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(...dir), distance);
  controls.update();
}
document.querySelectorAll<HTMLButtonElement>('#views button').forEach((button) =>
  button.addEventListener('click', () => viewFrom(button.dataset.view!)),
);

// Brújula de ejes: en una esquina, gira con la cámara y marca hacia dónde apuntan X (rojo), Y (verde) y Z (azul) desde tu vista.
// Con la herramienta Malla, el eje bloqueado se resalta y los otros se atenúan. Un clic en una letra mira desde ese eje.
const compassEl = document.getElementById('axisCompass') as HTMLCanvasElement;
const compassContext = compassEl.getContext('2d')!;
const compassArrows: { axis: number; sign: number; x: number; y: number }[] = [];
let compassKey = '';
function drawCompass(): void {
  const locked = mode === 'mesh' ? meshTool.axis : null;
  const q = camera.quaternion;
  const key = `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)},${locked}`;
  if (key === compassKey) return;
  compassKey = key;
  const size = compassEl.width;
  const centre = size / 2;
  const reach = size * 0.34;
  const inverse = q.clone().invert();
  const ctx = compassContext;
  ctx.clearRect(0, 0, size, size);
  const arrows: { axis: number; sign: number; x: number; y: number; depth: number }[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [1, -1]) {
      const v = new THREE.Vector3(0, 0, 0);
      v.setComponent(axis, sign);
      v.applyQuaternion(inverse);
      arrows.push({ axis, sign, x: centre + v.x * reach, y: centre - v.y * reach, depth: v.z });
    }
  }
  // Lo más lejano se dibuja primero.
  arrows.sort((a, b) => a.depth - b.depth);
  compassArrows.length = 0;
  ctx.lineCap = 'round';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const a of arrows) {
    const color = '#' + AXIS_COLORS[a.axis].toString(16).padStart(6, '0');
    const dim = locked !== null && !axisAllowed(locked, a.axis);
    ctx.globalAlpha = (dim ? 0.3 : 1) * (a.depth < -0.2 ? 0.6 : 1);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = locked !== null && axisAllowed(locked, a.axis) ? 4 : 2.5;
    ctx.beginPath();
    ctx.moveTo(centre, centre);
    ctx.lineTo(a.x, a.y);
    ctx.stroke();
    if (a.sign > 0) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#10121a';
      ctx.fillText('XYZ'[a.axis], a.x, a.y + 0.5);
      compassArrows.push({ axis: a.axis, sign: 1, x: a.x, y: a.y });
    } else {
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
      ctx.fill();
      compassArrows.push({ axis: a.axis, sign: -1, x: a.x, y: a.y });
    }
  }
  ctx.globalAlpha = 1;
}
compassEl.addEventListener('click', (e) => {
  const rect = compassEl.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * compassEl.width;
  const y = ((e.clientY - rect.top) / rect.height) * compassEl.height;
  const hit = compassArrows.filter((a) => Math.hypot(a.x - x, a.y - y) < 11).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  if (!hit) return;
  viewFrom(`${hit.sign > 0 ? '+' : '-'}${'xyz'[hit.axis]}`);
  setOrthographic(true);
});

// Vista ortográfica: sin perspectiva, como las vistas de frente, lado y arriba de un programa de modelado. Se hace con la misma cámara
// y un ángulo de visión mínimo, alejándola lo justo para que el modelo conserve su tamaño en pantalla; así no cambia nada más.
const PERSPECTIVE_FOV = 50;
const ORTHO_FOV = 1;
const orthoEl = document.getElementById('orthoToggle') as HTMLInputElement;
const halfTan = (fov: number): number => Math.tan((fov * Math.PI) / 360);
function setOrthographic(on: boolean): void {
  const to = on ? ORTHO_FOV : PERSPECTIVE_FOV;
  if (camera.fov !== to) {
    const distance = camera.position.distanceTo(controls.target) * (halfTan(camera.fov) / halfTan(to));
    const direction = camera.position.clone().sub(controls.target).normalize();
    camera.fov = to;
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    camera.far = on ? 20000 : 2000;
    camera.updateProjectionMatrix();
    controls.update();
  }
  orthoEl.checked = on;
}
orthoEl.addEventListener('change', () => setOrthographic(orthoEl.checked));
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ortho = setOrthographic;
document.getElementById('gridToggle')!.addEventListener('change', (e) => {
  const visible = (e.target as HTMLInputElement).checked;
  gridVisible = visible;
  for (const line of gridLines) line.visible = visible;
});

// Panel
/** Cada herramienta va en un grupo de la barra (Crear, Elegir, Caras, Vértices, Pintar, Guías). */
const TOOL_GROUPS = ['create', 'pick', 'faces', 'vertices', 'paint', 'guides'] as const;
type ToolGroup = (typeof TOOL_GROUPS)[number];
const toolGroupEls = Object.fromEntries(TOOL_GROUPS.map((name) => [name, document.querySelector(`[data-tools="${name}"]`)!])) as Record<ToolGroup, Element>;
const piecesEl = document.getElementById('pieces')!;
const pieceButtons = CATALOG.map((def, i) => {
  const button = document.createElement('button');
  button.textContent = `${(i + 1) % 10} ${def.short}`;
  button.title = def.name;
  button.addEventListener('click', () => selectPiece(i));
  piecesEl.appendChild(button);
  return button;
});
/** Botón de una herramienta: la tecla sale de la tabla de atajos, así el texto no puede contradecir al teclado. */
function toolButton(tool: KeyMode, group: ToolGroup, label: string, title?: string): HTMLButtonElement {
  const button = document.createElement('button');
  const key = toolKey(tool);
  button.textContent = key ? `${key.toUpperCase()} ${label}` : label;
  if (title) button.title = title;
  button.addEventListener('click', () => setMode(mode === tool ? 'place' : tool));
  toolGroupEls[group].appendChild(button);
  return button;
}
// Los botones se agregan por grupos, en este orden: Crear (con las piezas), Elegir, Caras, Vértices, Pintar y Guías.
const shapeButton = toolButton('shape', 'create', 'Forma', 'Esfera, cilindro, cono o cápsula con medidas y lados a elegir');
const fillButton = toolButton('fill', 'create', 'Rellenar', 'Marca puntos y se llena el volumen que encierran');
const selectButton = toolButton('select', 'pick', 'Elegir', 'Elige piezas y las mueve');
const eraseButton = toolButton('erase', 'pick', 'Borrar', 'Clic en una pieza la borra');
const growButton = toolButton('grow', 'faces', 'Crecer', 'Clic en una cara la hace crecer; arrastrar elige cuánto');
const sinkButton = toolButton('sink', 'faces', 'Hundir', 'Lo contrario de crecer: clic en una cara la hunde hacia dentro; arrastrar elige cuánto');
const faceButton = toolButton('face', 'faces', 'Cara', 'Extruye, cava o divide a partir de una cara');
const outlineButton = toolButton('outline', 'faces', 'Figura', 'Marca los puntos de una figura sobre una superficie y haz crecer o hundir solo esa figura');
const cutButton = toolButton('cut', 'faces', 'Cortar', 'Marca una región y corta las piezas con ella');
const bevelButton = toolButton('bevel', 'faces', 'Chaflán', 'Corta una arista en chaflán');
const meshButton = toolButton('mesh', 'vertices', 'Malla', 'Elige y mueve los vértices de las piezas: estira, tuerce y modela formas libres');
const paintButton = toolButton('paint', 'paint', 'Pintar', 'Pinta una cara con el color elegido, o píxeles sueltos con la casilla «Píxeles»');
const vertexButton = toolButton('vertex', 'guides', 'Punto guía', 'Añade un punto guía (un vértice de referencia que no se exporta) a la pieza elegida');

const cutActionsEl = document.getElementById('cutActions')!;
function syncCutActions(): void {
  cutActionsEl.hidden = mode !== 'cut';
  for (const button of cutActionsEl.querySelectorAll<HTMLButtonElement>('button')) {
    const action = button.dataset.cut;
    if (action === 'close') button.hidden = cutTool.isClosed;
    else if (action === 'undo') button.hidden = !cutTool.hasPoints;
    else if (action === 'cancel') button.hidden = false;
    else button.hidden = !cutTool.isClosed;
  }
}
cutTool.onPhaseChange = syncCutActions;
const vertexActionsEl = document.getElementById('vertexActions')!;
function syncVertexActions(): void {
  vertexActionsEl.hidden = mode !== 'vertex';
}
vertexTool.onPhaseChange = syncVertexActions;
vertexActionsEl.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).dataset.vertex;
  if (action === 'done') setMode('place');
});
document.getElementById('vertexFaces')!.addEventListener('change', (e) => {
  vertexTool.setFaces((e.target as HTMLInputElement).checked);
  (e.target as HTMLInputElement).blur();
});
const fillActionsEl = document.getElementById('fillActions')!;
function syncFillActions(): void {
  fillActionsEl.hidden = mode !== 'fill';
  fillActionsEl.querySelector<HTMLButtonElement>('[data-fill="undo"]')!.hidden = !fillTool.hasPoints;
}
fillTool.onPhaseChange = syncFillActions;
fillActionsEl.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).dataset.fill;
  if (action === 'apply') fillTool.apply();
  else if (action === 'undo') fillTool.undoPoint();
  else if (action === 'cancel') fillTool.cancel();
});
const outlineActionsEl = document.getElementById('outlineActions')!;
function syncOutlineActions(): void {
  outlineActionsEl.hidden = mode !== 'outline';
  snapRowEl.hidden = mode !== 'outline' && mode !== 'cut' && mode !== 'fill' && mode !== 'vertex' && mode !== 'mesh';
  // «Solo visibles» es de los puntos de Cortar, Rellenar, Figura y Punto guía; en Malla lo hace «Ver vértices de atrás».
  document.getElementById('visibleOnlyLabel')!.hidden = mode === 'mesh';
  // El plano de trabajo solo vale al marcar puntos para cortar, rellenar o hacer una figura.
  document.getElementById('planeRow')!.hidden = mode !== 'outline' && mode !== 'cut' && mode !== 'fill';
  outlineActionsEl.querySelector<HTMLButtonElement>('[data-outline="undo"]')!.hidden = !outlineTool.hasPoints;
  outlineActionsEl.querySelector('[data-outline="grow"]')!.classList.toggle('active', !outlineSink);
  outlineActionsEl.querySelector('[data-outline="sink"]')!.classList.toggle('active', outlineSink);
}
outlineTool.onPhaseChange = syncOutlineActions;
outlineActionsEl.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).dataset.outline;
  if (action === 'apply') outlineTool.apply();
  else if (action === 'undo') outlineTool.undoPoint();
  else if (action === 'cancel') outlineTool.cancel();
  else if (action === 'grow' || action === 'sink') {
    outlineSink = action === 'sink';
    outlineTool.update();
  }
});
cutActionsEl.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).dataset.cut;
  if (action === 'close' || action === 'apply') cutTool.apply();
  else if (action === 'flip') cutTool.flip();
  else if (action === 'undo') cutTool.undoPoint();
  else if (action === 'cancel') cutTool.cancel();
});

function setMode(next: Mode): void {
  if (next === mode) return;
  if (next === 'vertex' && !vertexTool.canStart()) return;
  if (mode === 'cut') {
    cutTool.deactivate();
    setFaceHover(undefined);
  }
  if (mode === 'fill') fillTool.deactivate();
  if (mode === 'outline') outlineTool.deactivate();
  if (mode === 'vertex') vertexTool.deactivate();
  if (mode === 'mesh') meshTool.deactivate();
  if (mode === 'erase') setEraseHover(undefined);
  if (mode === 'grow' || mode === 'sink') {
    finishGrow(false);
    setFaceHover(undefined);
  }
  if (mode === 'paint' || mode === 'face') {
    setFaceHover(undefined);
    statusEl.textContent = '';
  }
  if (mode === 'shape') setShapeHover(undefined);
  if (mode === 'bevel') setBevelHover(undefined);
  mode = next;
  if (mode === 'cut') cutTool.activate();
  if (mode === 'fill') fillTool.activate();
  if (mode === 'outline') outlineTool.activate();
  if (mode === 'vertex') vertexTool.activate();
  if (mode === 'mesh') meshTool.activate();
  placement.clear();
  syncButtons();
  syncCutActions();
  syncFillActions();
  syncOutlineActions();
  syncVertexActions();
  meshPanel.sync();
  syncShapeActions();
  syncBevelActions();
  pixelPanel.syncActions();
  syncFaceActions();
  growActionsEl.hidden = mode !== 'grow' && mode !== 'sink' && mode !== 'outline';
  syncPlaceRows();
  syncSelectionActions();
}

/** El tamaño solo se muestra al colocar; el grosor, solo con la lámina. */
const placeSizeRow = document.getElementById('placeSize')!;
const slabThickRow = document.getElementById('slabThick')!;
function syncPlaceRows(): void {
  placeSizeRow.hidden = mode !== 'place';
  slabThickRow.hidden = mode !== 'place' || !CATALOG[selected].grows;
  document.getElementById('slopeRow')!.hidden = mode !== 'place' || CATALOG[selected].grows === true;
}

function selectPiece(index: number): void {
  selected = index;
  setMode('place');
  syncButtons();
  syncPlaceRows();
  placement.refresh();
}

function syncButtons(): void {
  pieceButtons.forEach((b, i) => b.classList.toggle('active', mode === 'place' && i === selected));
  cutButton.classList.toggle('active', mode === 'cut');
  selectButton.classList.toggle('active', mode === 'select');
  axisRowEl.hidden = mode !== 'select' && mode !== 'mesh';
  syncAxisRow();
  eraseButton.classList.toggle('active', mode === 'erase');
  growButton.classList.toggle('active', mode === 'grow');
  sinkButton.classList.toggle('active', mode === 'sink');
  paintButton.classList.toggle('active', mode === 'paint');
  shapeButton.classList.toggle('active', mode === 'shape');
  bevelButton.classList.toggle('active', mode === 'bevel');
  faceButton.classList.toggle('active', mode === 'face');
  fillButton.classList.toggle('active', mode === 'fill');
  outlineButton.classList.toggle('active', mode === 'outline');
  vertexButton.classList.toggle('active', mode === 'vertex');
  meshButton.classList.toggle('active', mode === 'mesh');
}
syncButtons();

const colorInputEl = document.getElementById('color') as HTMLInputElement;
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
function setColor(next: number): void {
  color = next;
  colorInputEl.value = hex(next);
  shapeBase = null;
  placement.refresh();
  renderRecentColors();
}
colorInputEl.addEventListener('input', () => setColor(parseInt(colorInputEl.value.slice(1), 16)));

// Últimos colores usados (al colocar, pintar o rellenar): los 10 más recientes, el último primero; se recuerdan entre sesiones.
const RECENT_KEY = 'gridfacet.recentColors';
const RECENT_MAX = 10;
let recentColors: number[] = [];
try {
  const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
  if (Array.isArray(saved)) recentColors = saved.filter((c): c is number => Number.isInteger(c)).slice(0, RECENT_MAX);
} catch {
  // Sin almacenamiento empieza vacía.
}
const recentEl = document.getElementById('recentColors')!;

// Paletas guardadas: una lista con nombre de colores, que se recuerda entre sesiones y se puede importar o exportar como .hex.
const PALETTES_KEY = 'gridfacet.palettes';
let palettes: Palette[] = [];
try {
  palettes = parsePalettes(JSON.parse(localStorage.getItem(PALETTES_KEY) ?? '[]'));
} catch {
  // Sin almacenamiento o con datos dañados no hay paletas guardadas.
}
const paletteSel = document.getElementById('paletteSel') as HTMLSelectElement;
const paletteFile = document.getElementById('paletteFile') as HTMLInputElement;
const shownPalette = (): Palette | undefined => palettes.find((p) => p.name === paletteSel.value);
function persistPalettes(): void {
  try {
    localStorage.setItem(PALETTES_KEY, JSON.stringify(palettes));
  } catch {
    // Sin almacenamiento valen solo para esta sesión.
  }
}
function refreshPaletteSelect(selectName = paletteSel.value): void {
  paletteSel.replaceChildren(new Option('Recientes', ''), ...palettes.map((p) => new Option(`${p.name} (${p.colors.length})`, p.name)));
  paletteSel.value = palettes.some((p) => p.name === selectName) ? selectName : '';
  (document.getElementById('paletteExport') as HTMLButtonElement).disabled = !shownPalette();
  (document.getElementById('paletteDel') as HTMLButtonElement).disabled = !shownPalette();
  renderRecentColors();
}
function savePalette(name: string, colors: number[]): void {
  const clean = name.trim();
  if (!clean || colors.length === 0) return;
  palettes = upsertPalette(palettes, { name: clean, colors });
  persistPalettes();
  refreshPaletteSelect(clean);
  statusEl.textContent = `Paleta “${clean}” guardada (${colors.length} colores)`;
}
paletteSel.addEventListener('change', () => refreshPaletteSelect());
document.getElementById('paletteSave')!.addEventListener('click', () => {
  if (recentColors.length === 0) {
    statusEl.textContent = 'Aún no hay colores recientes que guardar';
    return;
  }
  const name = window.prompt('Nombre de la paleta (los últimos colores usados)', 'Mi paleta');
  if (name !== null) savePalette(name, recentColors);
});
document.getElementById('paletteImport')!.addEventListener('click', () => paletteFile.click());
paletteFile.addEventListener('change', async () => {
  const file = paletteFile.files?.[0];
  paletteFile.value = '';
  if (!file) return;
  const colors = parseHexColors(await file.text());
  if (colors.length === 0) {
    statusEl.textContent = `${file.name} no tiene colores válidos (un valor de 6 cifras por línea)`;
    return;
  }
  savePalette(file.name.replace(/\.(hex|txt)$/i, ''), colors);
});
document.getElementById('paletteExport')!.addEventListener('click', () => {
  const palette = shownPalette();
  if (palette) downloadBlob(toHexText(palette.colors), `${palette.name.replace(/[\\/:*?"<>|]+/g, '_')}.hex`, 'text/plain');
});
document.getElementById('paletteDel')!.addEventListener('click', () => {
  const palette = shownPalette();
  if (!palette || !window.confirm(`¿Borrar la paleta “${palette.name}”?`)) return;
  palettes = palettes.filter((p) => p !== palette);
  persistPalettes();
  refreshPaletteSelect('');
});

function renderRecentColors(): void {
  recentEl.replaceChildren();
  const palette = shownPalette();
  const slots = palette ? palette.colors.length : RECENT_MAX;
  for (let i = 0; i < slots; i++) {
    const swatch = document.createElement('button');
    const c = palette ? palette.colors[i] : recentColors[i];
    if (c === undefined) {
      swatch.disabled = true;
    } else {
      swatch.style.background = hex(c);
      swatch.title = hex(c);
      swatch.classList.toggle('active', c === color);
      swatch.addEventListener('click', () => setColor(c));
    }
    recentEl.appendChild(swatch);
  }
}
/** Apunta el color como el más reciente; si ya estaba lo sube al principio, y si pasa de 10 sale el más antiguo. */
function useColor(c: number): void {
  if (recentColors[0] === c) return;
  recentColors = [c, ...recentColors.filter((other) => other !== c)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentColors));
  } catch {
    // Sin almacenamiento la lista vale solo para esta sesión.
  }
  renderRecentColors();
}
refreshPaletteSelect('');
document.getElementById('keepBoth')!.addEventListener('change', (e) => {
  cutTool.keepBoth = (e.target as HTMLInputElement).checked;
});
document.getElementById('cutActiveLayer')!.addEventListener('change', (e) => {
  cutTool.activeLayerOnly = (e.target as HTMLInputElement).checked;
});

if (import.meta.env.DEV) {
  // Utilidad de verificación: exporta y vuelve a cargar el GLB para inspeccionarlo.
  (window as unknown as { __glbCheck: unknown }).__glbCheck = async (exportMode: ExportMode) => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const buffer = await exportGlb(model.all(), exportMode, undefined, pruneTracks(animationPanel.animation, model.all()));
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const meshes: { name: string; triangles: number; color: string }[] = [];
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const index = o.geometry.getIndex();
      meshes.push({
        name: o.name,
        triangles: (index ? index.count : o.geometry.getAttribute('position').count) / 3,
        color: (o.material as THREE.MeshStandardMaterial).color.getHexString(),
      });
    });
    const clips = gltf.animations.map((clip) => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.map((t) => `${t.name}:${t.times.length}`) }));
    return { bytes: buffer.byteLength, meshes, clips };
  };
}

const hudBody = document.getElementById('hudBody')!;
const hudToggle = document.getElementById('hudToggle')!;
function toggleHud(): void {
  hudBody.hidden = !hudBody.hidden;
  hudToggle.textContent = hudBody.hidden ? 'Mostrar menú' : 'Ocultar menú';
}
hudToggle.addEventListener('click', toggleHud);

/** Rehacer: con un corte o relleno a medias repone el punto quitado; si no, rehace el último bloque. */
function redo(): void {
  if (mode === 'mesh' && meshTool.busy) return;
  const tool = mode === 'cut' ? cutTool : mode === 'fill' ? fillTool : mode === 'outline' ? outlineTool : null;
  if (tool?.hasRedo) tool.redoPoint();
  else if (!animationPanel.redo()) model.redo();
}

const help = setupHelp();
const setHelp = help.setHelp;

// Barra de ayuda contextual: dice qué se puede hacer ahora y cambia con el modo, la fase y la selección.
const hintEl = document.getElementById('hint')!;

// Comandos (Ctrl+K): busca cualquier acción por nombre y la ejecuta.
const hasSelection = (): boolean => selection.size > 0;
const commands: Command[] = [
  ...(Object.keys(MODE_INFO) as Mode[]).map((name): Command => ({ name: `Herramienta: ${MODE_INFO[name].name}`, keywords: 'modo', run: () => setMode(name) })),
  { name: 'Deshacer', shortcut: 'Ctrl+Z', run: () => undo() },
  { name: 'Rehacer', shortcut: 'Ctrl+Y', run: redo },
  { name: 'Copiar', shortcut: 'Ctrl+C', enabled: hasSelection, run: copySelected },
  { name: 'Pegar', shortcut: 'Ctrl+V', enabled: () => clipboard.length > 0, run: pasteClipboard },
  { name: 'Borrar selección', keywords: 'eliminar suprimir', enabled: hasSelection, run: deleteSelected },
  { name: 'Unir piezas', keywords: 'fusionar merge', enabled: hasSelection, run: mergeSelected },
  { name: 'Agrupar', shortcut: 'Ctrl+G', enabled: hasSelection, run: groupSelected },
  { name: 'Desagrupar', enabled: hasSelection, run: ungroupSelected },
  { name: 'Ocultar selección', enabled: hasSelection, run: hideSelected },
  { name: 'Aislar selección', keywords: 'solo', enabled: hasSelection, run: isolateSelected },
  { name: 'Elegir conectadas', enabled: hasSelection, run: selectConnected },
  { name: 'Excavar', keywords: 'restar hueco', enabled: hasSelection, run: excavateSelected },
  ...(['x', 'y', 'z'] as const).map((axis): Command => ({ name: `Reflejar en ${axis.toUpperCase()}`, keywords: 'espejo reflejar simetria', enabled: hasSelection, run: () => mirrorSelected(axis) })),
  ...(['x', 'z'] as const).map((axis): Command => ({ name: `Reflejar y copiar en ${axis.toUpperCase()}`, keywords: 'duplicar reflejar simetria copia', enabled: hasSelection, run: () => mirrorCopySelected(axis) })),
  ...(['x', 'y', 'z'] as const).map((axis): Command => ({ name: `Girar 90° sobre ${axis.toUpperCase()}`, keywords: 'rotar giro tumbar', enabled: hasSelection, run: () => commitTransform(rotateQuarterChange(selectedPieces(), axis, 1)) })),
  ...(['x', 'y', 'z'] as const).flatMap((axis) =>
    ([['min', 'al borde menor'], ['center', 'al centro'], ['max', 'al borde mayor']] as const).map(([edge, label]): Command => ({
      name: `Alinear en ${axis.toUpperCase()} ${label}`,
      keywords: 'alinear ras',
      enabled: () => partsOf(selectedPieces()).length >= 2,
      run: () => alignSelected(axis, edge),
    })),
  ),
  ...(['x', 'y', 'z'] as const).map((axis): Command => ({
    name: `Distribuir en ${axis.toUpperCase()} con huecos iguales`,
    keywords: 'repartir separar espaciar',
    enabled: () => partsOf(selectedPieces()).length >= 3,
    run: () => distributeSelected(axis),
  })),
  { name: 'Limpiar astillas', keywords: 'cortes diminutas pequeñas quitar basura', run: cleanSlivers },
  { name: 'Mover al suelo', keywords: 'bajar apoyar y 0', enabled: hasSelection, run: groundSelected },
  { name: 'Redimensionar…', keywords: 'escalar tamaño medida proporcion', enabled: hasSelection, run: resizeSelected },
  { name: 'Nueva capa', keywords: 'capas', run: () => layers.add() },
  { name: 'Recuperar el trabajo anterior', keywords: 'copia automatica restaurar sesion anterior', run: files.toggleRecoverList },
  { name: 'Nuevo proyecto', keywords: 'nuevo en blanco lienzo vacio', run: files.newProject },
  { name: 'Guardar', shortcut: 'Ctrl+S', run: () => void files.saveProject(false) },
  { name: 'Guardar como…', shortcut: 'Ctrl+Alt+S', run: () => void files.saveProject(true) },
  { name: 'Abrir…', shortcut: 'Ctrl+O', run: () => void files.requestOpen() },
  { name: 'Exportar GLB', keywords: 'modelo 3d gltf descargar', run: () => document.getElementById('export')!.click() },
  { name: 'Exportar OBJ', keywords: 'modelo 3d wavefront mtl atlas descargar', run: () => document.getElementById('exportObj')!.click() },
  { name: 'Exportar sprites', keywords: 'png vistas hoja spritesheet isometrico descargar', run: () => document.getElementById('exportSprites')!.click() },
  { name: 'Paleta: guardar colores recientes', keywords: 'colores', run: () => document.getElementById('paletteSave')!.click() },
  { name: 'Paleta: importar .hex', keywords: 'colores lospec abrir', run: () => document.getElementById('paletteImport')!.click() },
  { name: 'Paleta: exportar .hex', keywords: 'colores lospec descargar', run: () => document.getElementById('paletteExport')!.click() },
  ...([['pencil', 'Lápiz'], ['eraser', 'Borrador'], ['fill', 'Relleno'], ['line', 'Línea'], ['rect', 'Rectángulo'], ['rectfill', 'Rectángulo lleno'], ['ellipse', 'Elipse'], ['ellipsefill', 'Elipse llena'], ['replace', 'Reemplazar color'], ['dither', 'Tramado'], ['select', 'Seleccionar'], ['move', 'Mover']] as const).map(([tool, label]): Command => ({
    name: `Píxeles: ${label}`,
    keywords: 'pintar textura cara',
    run: () => {
      setMode('paint');
      pixelPanel.useTool(tool);
    },
  })),
  { name: 'Píxeles: abrir la cara en plano', keywords: 'editor 2d ampliar textura', enabled: () => pixelPanel.hasLastFace(), run: pixelPanel.openFaceEditor },
  { name: 'Píxeles: volver a pintar caras enteras', keywords: 'pintar color cara', run: pixelPanel.wholeFaces },
  { name: 'Mostrar ayuda', shortcut: '?', keywords: 'atajos', run: () => setHelp(true) },
];
const commandPalette = createCommandPalette(commands);

/** Línea de “ahora”: dice qué toca hacer en este momento y cambia con la fase de la herramienta y la selección. */
function hintText(): string {
  switch (mode) {
    case 'place':
      if (CATALOG[selected].grows) return 'Clic: la lámina crece pegada a la cara que apuntas (arriba, abajo o de costado)';
      return `Clic: colocar ${CATALOG[selected].name}`;
    case 'select':
      return selection.size === 0 ? 'Clic en una pieza para elegirla' : `${selection.size} elegida(s): arrastra para moverlas o usa las teclas de la lista`;
    case 'erase':
      return 'Clic en la pieza marcada en rojo para borrarla';
    case 'grow':
      return (growAllEl.checked ? 'Crece toda la cara conectada (Ctrl: solo el cuadrito apuntado)' : 'Clic en una cara la hace crecer (Ctrl: toda la cara conectada)') +
        ` · cantidad ${growAmountOf() === null ? 'automática' : `${+growAmountOf()!.toFixed(3)} celda(s)`}`;
    case 'sink':
      return (growAllEl.checked ? 'Hunde toda la cara conectada (Ctrl: solo el cuadrito apuntado)' : 'Clic en una cara la hunde (Ctrl: toda la cara conectada)') +
        ` · cantidad ${growAmountOf() === null ? 'automática' : `${+growAmountOf()!.toFixed(3)} celda(s)`}`;
    case 'bevel':
      return 'Clic en una arista (marcada en amarillo) para cortarla en chaflán';
    case 'face':
      return 'Clic en una cara para extruirla, cavarla o dividir la pieza';
    case 'shape':
      return `Clic: apoyar ${SHAPES.find((s) => s.kind === shapeSpec.kind)?.name.toLowerCase()} sobre lo que apuntas`;
    case 'paint':
      return 'Clic en una cara para pintarla con el color elegido';
    case 'mesh':
      return meshTool.count === 0 ? 'Clic en un vértice para elegirlo y arrástralo para moverlo (Ctrl+arrastrar en vacío: recuadro)' : `${meshTool.count} vértice(s): arrastra o usa Supr (las flechas mueven la cámara)`;
    case 'vertex':
      return 'Clic en un punto amarillo para crear un punto guía';
    case 'fill': {
      const n = fillTool.pointCount;
      if (n === 0) return 'Rellenar: marca 4 o más puntos que no estén en un mismo plano; se pegan a vértices y a la rejilla';
      if (n < 4) return `Rellenar: ${n} punto(s) marcados · faltan ${4 - n} como mínimo`;
      return `Rellenar: ${n} puntos · clic en el primero (o Enter) crea la pieza que los une`;
    }
    case 'outline': {
      const n = outlineTool.pointCount;
      const verb = outlineSink ? 'hundir' : 'crecer';
      if (n === 0) return `Figura: marca los puntos de la figura que quieres ${verb} sobre una cara · se pegan a vértices y a los virtuales`;
      if (n < 3) return `Figura: ${n} punto(s) marcados · faltan ${3 - n} como mínimo`;
      return `Figura: ${n} puntos · clic en el primero (o Enter) para ${verb} solo esa figura`;
    }
    case 'cut': {
      if (cutTool.isClosed) return 'Región cerrada · F cambia el lado que se borra (el rojo) · Enter corta';
      const n = cutTool.pointCount;
      if (n === 0) return 'Cortar: marca los puntos de una región sobre las piezas';
      if (n < 3) return `Cortar: ${n} punto(s) marcados · marca al menos 3`;
      return `Cortar: ${n} puntos · clic en el primero (o Enter) cierra la región`;
    }
  }
}


const HINT_KEY = 'gridfacet.hintHidden';
let hintHidden = false;
try {
  hintHidden = localStorage.getItem(HINT_KEY) === '1';
} catch {
  hintHidden = false;
}
function setHintHidden(hide: boolean): void {
  hintHidden = hide;
  shownHint = '';
  try {
    localStorage.setItem(HINT_KEY, hide ? '1' : '0');
  } catch {
    // Sin almacenamiento la guía simplemente no recuerda si estaba oculta.
  }
  updateHint();
}

let shownHint = '';
function updateHint(): void {
  const info = MODE_INFO[mode];
  const axes = (['x', 'y', 'z'] as const).filter((axis) => symmetry[axis]).map((axis) => axis.toUpperCase());
  const text = hintText() + (axes.length > 0 ? ` · Simetría ${axes.join(' ')} activa` : '');
  const key = `${mode}|${hintHidden}|${text}`;
  if (key === shownHint) return;
  shownHint = key;
  hintEl.style.setProperty('--mode', info.color);
  document.getElementById('hud')!.style.setProperty('--mode', info.color);
  hintEl.classList.toggle('min', hintHidden);
  hintEl.replaceChildren();

  const head = document.createElement('div');
  head.className = 'head';
  const chip = document.createElement('b');
  chip.textContent = info.name;
  head.append(chip);
  if (!hintHidden) {
    const body = document.createElement('span');
    body.className = 'now';
    body.textContent = text;
    head.append(body);
  }
  const toggle = document.createElement('button');
  toggle.textContent = hintHidden ? 'Guía ▸' : 'Ocultar guía ▾';
  toggle.title = 'Mostrar u ocultar la guía de esta herramienta (A)';
  toggle.addEventListener('click', () => setHintHidden(!hintHidden));
  head.append(toggle);
  hintEl.append(head);
  if (hintHidden) return;

  const list = document.createElement('div');
  list.className = 'guide';
  for (const [keys, what] of GUIDE[mode]) {
    const item = document.createElement('div');
    const k = document.createElement('kbd');
    k.textContent = keys;
    item.append(k, ` ${what}`);
    list.append(item);
  }
  hintEl.append(list);
}
// Las herramientas cambian de fase con clics y teclas; revisar unas cuantas veces por segundo es más sencillo que enganchar cada cambio.
setInterval(updateHint, 120);

// Secciones del panel plegables; se recuerda cuáles estaban plegadas.
const COLLAPSE_KEY = 'gridfacet.collapsed';
let collapsed: string[] = [];
try {
  const saved: unknown = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]');
  // Lo guardado puede estar dañado o ser de otra versión: solo vale una lista de textos.
  collapsed = Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : [];
} catch {
  collapsed = [];
}
document.querySelectorAll<HTMLElement>('#hud section').forEach((section) => {
  const title = section.querySelector('h4 .title')?.textContent ?? '';
  section.classList.toggle('collapsed', collapsed.includes(title));
  section.querySelector('h4')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('input')) return;
    section.classList.toggle('collapsed');
    collapsed = [...document.querySelectorAll<HTMLElement>('#hud section.collapsed h4 .title')].map((el) => el.textContent ?? '');
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
    } catch {
      // Sin almacenamiento el panel simplemente no recuerda lo plegado.
    }
  });
});

document.getElementById('helpFloat')!.addEventListener('click', () => setHelp(true));

// Tamaño de la rejilla (la sala): número de celdas por lado (par, para que la cuadrícula siga alineada con las piezas).
const sizeInput = document.getElementById('gridSize') as HTMLInputElement;
const sizeLabel = document.getElementById('sizeLabel')!;
function setGridSize(requested: number): void {
  const even = Math.round(requested / 2) * 2;
  const before = gridSize;
  gridSize = Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Number.isFinite(even) ? even : gridSize));
  buildRoom();
  if (typeof syncSymmetry === 'function') syncSymmetry();
  sizeInput.value = String(gridSize);
  sizeLabel.textContent = `${gridSize} × ${gridSize} × ${gridSize} celdas (${gridSize * 3} placas de alto)`;
  const outside = model.all().filter((piece) => piece.faces.some((face) => face.some((p) => Math.abs(p[0]) > gridSize / 2 || Math.abs(p[2]) > gridSize / 2 || p[1] > gridSize))).length;
  // Cambiar el tamaño de la sala se guarda con el proyecto: cuenta como cambio sin guardar (al abrir un archivo se limpia después).
  if (gridSize !== before) {
    files.markDirty();
    files.syncFileName();
    files.scheduleAutosave();
  }
  statusEl.textContent = outside > 0 ? `Rejilla de ${gridSize}: ${outside} pieza(s) quedan fuera; se conservan` : `Rejilla de ${gridSize} × ${gridSize} × ${gridSize}`;
}
sizeInput.addEventListener('change', () => setGridSize(Number(sizeInput.value)));
document.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((button) =>
  button.addEventListener('click', () => setGridSize(gridSize + (button.dataset.size === '+' ? 2 : -2))),
);

// Simetría: casillas por eje, posición del plano y planos translúcidos en la escena.
const SYMMETRY_COLORS = { x: 0xff5050, y: 0x50d070, z: 0x5080ff } as const;
const symmetryPlanes = {} as Record<'x' | 'y' | 'z', THREE.Mesh>;
for (const axis of ['x', 'y', 'z'] as const) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  if (axis === 'x') geometry.rotateY(Math.PI / 2);
  if (axis === 'y') geometry.rotateX(-Math.PI / 2);
  const plane = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: SYMMETRY_COLORS[axis], transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  );
  plane.raycast = () => {};
  plane.visible = false;
  symmetryPlanes[axis] = plane;
  scene3d.add(plane);
}
const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
function syncSymmetry(): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    const plane = symmetryPlanes[axis];
    plane.visible = symmetry[axis];
    plane.scale.setScalar(gridSize);
    plane.position.set(0, gridSize / 2, 0);
    plane.position.setComponent(AXIS_INDEX[axis], symmetry.center[AXIS_INDEX[axis]]);
    if (axis === 'y') plane.position.set(0, symmetry.center[1], 0);
    const box = document.querySelector<HTMLInputElement>(`[data-sym="${axis}"]`)!;
    box.checked = symmetry[axis];
  }
  placement.refresh();
  meshTool.refresh();
  meshPanel.sync();
}
function toggleSymmetry(axis: 'x' | 'y' | 'z'): void {
  symmetry[axis] = !symmetry[axis];
  syncSymmetry();
  const active = (['x', 'y', 'z'] as const).filter((a) => symmetry[a]).map((a) => a.toUpperCase());
  statusEl.textContent = active.length > 0 ? `Simetría en ${active.join(' + ')}` : 'Simetría desactivada';
}
document.querySelectorAll<HTMLInputElement>('[data-sym]').forEach((box) =>
  box.addEventListener('change', () => {
    symmetry[box.dataset.sym as 'x' | 'y' | 'z'] = box.checked;
    box.blur();
    syncSymmetry();
  }),
);
document.querySelectorAll<HTMLInputElement>('[data-symc]').forEach((input) => {
  input.value = String(symmetry.center[AXIS_INDEX[input.dataset.symc as 'x' | 'y' | 'z']]);
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (Number.isFinite(value)) symmetry.center[AXIS_INDEX[input.dataset.symc as 'x' | 'y' | 'z']] = value;
    syncSymmetry();
  });
});
syncSymmetry();
setGridSize(gridSize);
statusEl.textContent = '';

// Vista de solo líneas y vértices: sin caras, para ver la estructura.
function setSmooth(on: boolean): void {
  setSmoothShading(on);
  batches.setSmooth(on);
  // Las piezas elegidas y los fantasmas son objetos propios: se recrean con las normales nuevas.
  for (const object of objects.values()) {
    scene3d.remove(object);
    disposeObject(object);
  }
  objects.clear();
  selection.notify();
  placement.refresh();
  const box = document.getElementById('smoothToggle') as HTMLInputElement;
  box.checked = on;
  box.blur();
}
document.getElementById('smoothToggle')!.addEventListener('change', (e) => setSmooth((e.target as HTMLInputElement).checked));

function setWireframe(on: boolean): void {
  setWireframeView(on);
  batches.setWireframe(on);
  // Las piezas elegidas son objetos propios: se recrean para que tomen la vista nueva.
  for (const object of objects.values()) {
    scene3d.remove(object);
    disposeObject(object);
  }
  objects.clear();
  selection.notify();
  const box = document.getElementById('wireToggle') as HTMLInputElement;
  box.checked = on;
  box.blur();
  statusEl.textContent = on ? 'Vista de líneas y vértices (W para volver)' : 'Vista sólida';
}
document.getElementById('wireToggle')!.addEventListener('change', (e) => setWireframe((e.target as HTMLInputElement).checked));

// Tras usar un botón o el selector se suelta el foco; si no, Enter o la barra espaciadora los volverían a activar.
document.addEventListener('click', (e) => {
  if (e.target instanceof HTMLButtonElement) e.target.blur();
});
document.getElementById('exportMode')!.addEventListener('change', (e) => (e.target as HTMLSelectElement).blur());

// Teclado (ui/keyboard.ts): cada fila de core/shortcuts.ts apunta a una de estas acciones por su id. Una acción que no corresponde ahora devuelve false.
const ctrlOf = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey;
/** Hacia dónde va cada flecha en pantalla, vista desde la cámara. */
function arrowDirections(): Record<string, [number, number]> {
  const { forward, right } = cameraAxes();
  return { arrowup: forward, arrowdown: [-forward[0], -forward[1]], arrowright: right, arrowleft: [-right[0], -right[1]] };
}
const keyActions: KeyActions = {
  help: (e) => {
    e.preventDefault();
    setHelp(true);
  },
  commands: (e) => {
    e.preventDefault();
    commandPalette.open();
  },
  save: (e) => {
    e.preventDefault();
    void files.saveProject(false);
  },
  saveAs: (e) => {
    e.preventDefault();
    void files.saveProject(true);
  },
  open: (e) => {
    e.preventDefault();
    void files.requestOpen();
  },
  // Con una herramienta a medias, Ctrl+Z retrocede un punto en vez de deshacer el último bloque.
  undo: (e) => {
    e.preventDefault();
    const tool = mode === 'cut' ? cutTool : mode === 'fill' ? fillTool : mode === 'outline' ? outlineTool : null;
    if (tool?.hasPoints) tool.undoPoint();
    else undo();
  },
  redo: (e) => {
    e.preventDefault();
    redo();
  },
  group: (e) => {
    e.preventDefault();
    groupSelected();
  },
  ungroup: (e) => {
    e.preventDefault();
    ungroupSelected();
  },
  selectAll: (e) => {
    e.preventDefault();
    selection.set(model.all().filter((piece) => !hidden.has(piece.id)).map((piece) => piece.id));
  },
  copy: (e) => {
    if (pixelPanel.painting()) return false;
    e.preventDefault();
    copySelected();
  },
  paste: (e) => {
    if (pixelPanel.painting()) return false;
    e.preventDefault();
    pasteClipboard();
  },
  copyPixels: (e) => {
    if (!pixelPanel.painting()) return false;
    e.preventDefault();
    pixelPanel.copy();
  },
  pastePixels: (e) => {
    if (!pixelPanel.painting()) return false;
    e.preventDefault();
    pixelPanel.paste();
  },
  duplicate: (e) => {
    e.preventDefault();
    copySelected();
    pasteClipboard();
  },
  applyCutNow: (e) => {
    e.preventDefault();
    cutTool.applyNow();
  },
  // Teclado numérico, como en Blender: 1 frente, 3 derecha, 7 arriba (con Ctrl, la opuesta) y 5 alterna ortográfica/perspectiva.
  view: (e, row) => {
    e.preventDefault();
    viewFrom(row.arg!);
    setOrthographic(true);
  },
  toggleOrtho: (e) => {
    e.preventDefault();
    setOrthographic(camera.fov !== ORTHO_FOV);
  },
  toggleHud: () => toggleHud(),
  toggleWire: () => setWireframe(!isWireframeView()),
  // Alt+O muestra solo las piezas ocultas una a una: las de capas ocultas siguen ocultas (se muestran con el botón «Mostrar ocultas» o el ojo de la capa).
  showHidden: () => showHidden([...hidden].filter((id) => { const piece = model.get(id); return !piece || !layers.isHidden(piece); })),
  // Con selección, las flechas mueven las piezas (Ctrl duplica el paso: de un cuarto a media celda); sin ella, o en las herramientas de marcar puntos y en Malla, mueven la cámara.
  moveSelection: (e) => {
    if (isPanMode(mode) || selection.size === 0) return false;
    const dir = arrowDirections()[e.key.toLowerCase()];
    if (!dir) return false;
    e.preventDefault();
    const stepXZ = ctrlOf(e) ? 2 * STEP_XZ : STEP_XZ;
    moveSelectionBy(dir[0] * stepXZ, 0, dir[1] * stepXZ);
  },
  // Alt + flechas: tumbar la selección un cuarto de vuelta, la parte de arriba va hacia donde apunta la flecha (según la cámara).
  tumbleSelection: (e) => {
    if (isPanMode(mode) || selection.size === 0 || ctrlOf(e)) return false;
    const dir = arrowDirections()[e.key.toLowerCase()];
    if (!dir) return false;
    e.preventDefault();
    const [dx, dz] = dir;
    // Eje de giro = arriba × dirección, llevado al eje del mundo más cercano.
    const k = [dz, -dx];
    const axis: Axis = Math.abs(k[0]) >= Math.abs(k[1]) ? 'x' : 'z';
    const turns = (axis === 'x' ? k[0] : k[1]) >= 0 ? 1 : -1;
    commitTransform(rotateQuarterChange(selectedPieces(), axis, turns));
  },
  // E y Q no mueven piezas: E entra en Malla y Q es de sus acciones.
  moveVertical: (e) => {
    if (isPanMode(mode) || selection.size === 0) return false;
    const vertical = verticalMoveKey(e.key.toLowerCase());
    if (vertical === 0) return false;
    moveSelectionBy(0, vertical * (ctrlOf(e) ? 2 * STEP_Y : STEP_Y), 0);
  },
  // Las teclas que encienden o apagan una herramienta salen de la tabla de atajos.
  toggleTool: (_e, row) => setMode(mode === row.toggles ? 'place' : row.toggles!),
  selectPiece: (e) => {
    const n = Number(e.key);
    if (!(n >= 1 && n <= Math.min(9, CATALOG.length))) return false;
    selectPiece(n - 1);
  },
  rotatePlace: () => {
    rotation = (rotation + 1) % 4;
    placement.refresh();
  },
  rotateSelection: (e) => {
    if (selection.size === 0) return false;
    commitTransform(rotateChange(selectedPieces(), e.altKey ? 3 : 1));
  },
  turnShape: () => turnShape(),
  flipCut: () => cutTool.flip(),
  cancelDrag: () => {
    if (!(drag || growDrag || marquee)) return false;
    finishMarquee(false);
    finishDrag(false);
    finishGrow(false);
  },
  clearSelection: () => selection.clear(),
  leaveTool: () => setMode('place'),
  cancelTool: () => {
    if (mode === 'cut') cutTool.cancel();
    else if (mode === 'fill') fillTool.cancel();
    else if (mode === 'outline') outlineTool.cancel();
  },
  applyTool: (e) => {
    e.preventDefault();
    if (mode === 'cut') cutTool.apply();
    else if (mode === 'fill') fillTool.apply();
    else if (mode === 'outline') outlineTool.apply();
  },
  hideSelected: () => hideSelected(),
  isolateSelected: () => isolateSelected(),
  toggleHint: () => setHintHidden(!hintHidden),
  toggleSymmetry: (e) => toggleSymmetry(e.key.toLowerCase() as 'x' | 'y' | 'z'),
  mirrorX: () => mirrorSelected('x'),
  mirrorZ: () => mirrorSelected('z'),
  mirrorY: () => mirrorSelected('y'),
  selectConnected: () => selectConnected(),
  // En Malla Supr y Retroceso son de los vértices (MeshTool los toma), nunca borran piezas; Retroceso tampoco en Cortar, Rellenar y Figura.
  deleteSelection: () => deleteSelected(),
};
const keyboard = createKeyboard({
  camera,
  controls,
  mode: () => mode,
  hasSelection: () => selection.size > 0,
  editor: { isOpen: () => pixelPanel.editorOpen, close: () => pixelPanel.closeEditor() },
  help: { isOpen: () => help.isOpen(), isSearch: (target) => help.isSearch(target), set: (open) => setHelp(open) },
  poseKey: (e) => animationPanel.poseKey(e),
  mesh: { handleKey: (e) => meshTool.handleKey(e), count: () => meshTool.count },
  actions: keyActions,
});

// Animación: claves de pose por grupo de piezas (el panel vive en ui/animationPanel.ts).
const animationPanel = createAnimationPanel({
  scene3d,
  renderer,
  camera,
  controls,
  model,
  selection,
  objects,
  batches,
  textureLayer,
  hidden,
  layers,
  statusEl,
  selectedPieces,
  touched: () => {
    files.markDirty();
    files.scheduleAutosave();
    files.syncFileName();
  },
});

function undo(): void {
  // Con un arrastre o un giro de Malla a medias, la vista previa aún no está en el historial: deshacer desharía otro cambio.
  if (mode === 'mesh' && meshTool.busy) return;
  animationPanel.undo();
}

// Imágenes de referencia (ui/referencesPanel.ts).
const referencesPanel = createReferencesPanel({
  scene3d,
  statusEl,
  gridSize: () => gridSize,
  changed: () => {
    files.markDirty();
    files.syncFileName();
    files.scheduleAutosave();
  },
});

files.stashPreviousSession();

function resize(): void {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let lastFrame = performance.now();
/** La escena solo se vuelve a dibujar si algo pudo cambiar: antes se repintaba sin parar a la velocidad de la pantalla y calentaba el equipo. */
let renderUntil = performance.now() + 1500;
let lastRendered = 0;
let lastSerial = -1;
const wakeRender = (): void => {
  renderUntil = performance.now() + 800;
};
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'click', 'input', 'change', 'drop', 'focus', 'resize', 'contextmenu']) {
  window.addEventListener(type, wakeRender, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', wakeRender);
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  keyboard.updatePan(dt);
  if (animationPanel.playing) animationPanel.tick(dt);
  // Con la inercia de la cámara activa, `update` dice si todavía se está moviendo.
  if (controls.update()) wakeRender();
  batches.flush();
  // Dibuja mientras haya actividad, se reproduzca la animación o cambie el modelo; y, por si algo cambia sin avisar (una imagen que termina de cargar), dos veces por segundo.
  if (!animationPanel.playing && now > renderUntil && model.serial === lastSerial && now - lastRendered < 500) return;
  lastSerial = model.serial;
  lastRendered = now;
  renderer.render(scene3d, camera);
  drawCompass();
});
