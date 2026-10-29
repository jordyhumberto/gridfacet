import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, SLAB_THICKNESS, buildPieces, buildSlab } from './core/catalog';
import { clearanceLift } from './core/placement';
import { coplanarRegion, type FaceOf } from './core/region';
import type { Change } from './core/cut';
import type { ExportMode } from './core/export';
import { extrudeFace, faceAt, unitNormal } from './core/extrude';
import { pieceKey, reflectPiece, reflections, withSymmetry, withSymmetryPoints, type Symmetry } from './core/symmetry';
import type { Piece, Vec3 } from './core/piece';
import { STEP_XZ, STEP_Y, mirrorChange, moveChange, rotateChange, translatePiece, type Axis } from './core/transform';
import { parseProjectFull, serializeProject } from './core/project';
import { canPickOpen, canPickSave, pickOpen, pickSave, writeHandle, type FileHandle } from './fileAccess';
import { downloadBlob, exportGlb } from './render/glb';
import { PieceBatches } from './render/batches';
import { createPieceObject, disposeObject, isWireframeView, setHighlight, setSmoothShading, setWireframeView } from './render/meshes';
import { ModelScene } from './scene';
import { Selection } from './selection';
import { CutTool, snapPoint } from './tools/cutTool';
import { FillTool } from './tools/fillTool';
import { boundsOf, centerChange, rotateFreeChange, scaleChange } from './core/transform';
import { connectedPieces, sizeOf } from './core/connected';
import { bevelChange, edgeBetween, nearestEdge, type PieceEdge } from './core/bevel';
import { buildShape, MAX_SIDES, MIN_SIDES, SHAPES, type ShapeKind, type ShapeSpec } from './core/shapes';
import { facesAt, paintChange, type FaceRef } from './core/paint';
import { faceColorOf, newGroupId, withGroup } from './core/piece';
import { VertexTool } from './tools/vertexTool';
import { excavateChange, extrudeFaceChange, mergeChange, repeatChange, splitFaceChange, triangleCount } from './core/modeling';

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
renderer.setPixelRatio(window.devicePixelRatio);
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
const fillTool = new FillTool(scene3d, model, () => color, (message) => (statusEl.textContent = message), expand);
const cutTool = new CutTool(scene3d, model, selection, (message) => (statusEl.textContent = message), () => symmetry);

// Nombre del archivo abierto o guardado; el punto avisa de cambios sin guardar.
const fileNameEl = document.getElementById('fileName')!;
let fileName = 'Sin título';
let dirty = false;
function syncFileName(): void {
  const label = `${dirty ? '● ' : ''}${fileName}`;
  fileNameEl.textContent = label;
  document.title = `${label} · Gridfacet`;
}
syncFileName();

// El modelo manda; la escena 3D solo refleja sus cambios.
// Las piezas sin elegir se dibujan fundidas por zonas; solo las elegidas son objetos propios (para resaltarlas y arrastrarlas).
model.onChange = ({ added, removed, marksAdded, marksRemoved }) => {
  for (const piece of removed) {
    batches.remove(piece.id);
    const object = objects.get(piece.id);
    if (!object) continue;
    scene3d.remove(object);
    disposeObject(object);
    objects.delete(piece.id);
  }
  for (const id of removed.map((piece) => piece.id)) hidden.delete(id);
  for (const piece of added) showPiece(piece);
  setEraseHover(undefined);
  if (marksAdded?.length || marksRemoved?.length) refreshMarks();
  dirty = true;
  syncFileName();
  selection.remove(removed.map((piece) => piece.id));
  syncInspector();
  refreshGroups();
  syncTriangles();
  if (mode === 'fill' && added.length > 0) useColor(color);
};

selection.onChange = () => {
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
  syncGroupName();
};

if (import.meta.env.DEV) {
  const dev = window as unknown as Record<string, unknown>;
  dev.__model = model;
  dev.__cut = cutTool;
  dev.__fill = fillTool;
  dev.__camera = camera;
  dev.__controls = controls;
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

type Mode = 'place' | 'cut' | 'select' | 'erase' | 'grow' | 'fill' | 'vertex' | 'paint' | 'shape' | 'bevel' | 'face';
let mode: Mode = 'place';
let selected = 0;
let rotation = 0;
let color = 0xd9534f;
let ghost: THREE.Object3D | null = null;
let target = { cx: 0, cy: 0, cz: 0, ox: 0, oz: 0 };
let hasTarget = false;
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
  return raycaster.intersectObjects(targets, true).find((hit) => hit.object instanceof THREE.Mesh);
}

function pieceIdOf(hit: THREE.Intersection | undefined): number | undefined {
  if (!hit) return undefined;
  return (hit.object.userData.pieceId as number | undefined) ?? batches.pieceIdAt(hit);
}

function updateCursor(overPiece: boolean): void {
  const canvas = renderer.domElement;
  if (drag) canvas.style.cursor = 'grabbing';
  else if (mode === 'cut' || mode === 'fill' || mode === 'vertex') canvas.style.cursor = 'crosshair';
  else if (growDrag) canvas.style.cursor = 'grabbing';
  else if (mode === 'select') canvas.style.cursor = overPiece ? 'grab' : 'default';
  else if (mode === 'erase' || mode === 'grow' || mode === 'paint' || mode === 'shape' || mode === 'bevel' || mode === 'face') canvas.style.cursor = overPiece ? 'pointer' : 'default';
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

/** Punto que se marcaría ahora: sobre el plano de trabajo si hay uno, si no sobre lo que apunta el cursor. */
function markTarget(event: PointerEvent, hit: THREE.Intersection | undefined): Vec3 | null {
  if (!workPlane) return hit ? snapPoint(hit.point, model, { edge: event.altKey }) : null;
  const normal = new THREE.Vector3();
  normal.setComponent(workPlane.axis, 1);
  const point = raycaster.ray.intersectPlane(new THREE.Plane(normal, -workPlane.value), new THREE.Vector3());
  if (!point) return null;
  const snapped = snapPoint(point, model, { edge: event.altKey });
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
function addToolPoint(tool: CutTool | FillTool, point: Vec3, minToClose: number, event: PointerEvent): void {
  const first = tool.firstPoint;
  if (first && tool.pointCount >= minToClose) {
    const s = screenOf(first);
    if (s && Math.hypot(s.x - event.clientX, s.y - event.clientY) < 14) point = first;
  }
  tool.addPoint(point);
}

function updateHover(event: PointerEvent): void {
  if (mode === 'vertex' && !marquee && !drag && !growDrag) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    vertexTool.hoverAt({ x: event.clientX, y: event.clientY }, raycaster.ray, screenOf, event.altKey);
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
  if (mode === 'cut') {
    snapped = markTarget(event, hit);
    showPointInfo(snapped);
    cutTool.setHover(snapped);
    setFaceHover(event.shiftKey && hit && !backdrops.includes(hit.object) ? findFace(hit) : undefined);
    return;
  }
  if (mode === 'fill') {
    snapped = markTarget(event, hit);
    showPointInfo(snapped);
    fillTool.setHover(snapped);
    return;
  }
  if (mode === 'grow') {
    setFaceHover(hit && !backdrops.includes(hit.object) ? findFace(hit) : undefined, growWhole(event));
    return;
  }
  if (mode === 'paint') {
    const found = hit && !backdrops.includes(hit.object) ? findFace(hit) : undefined;
    setFaceHover(found);
    statusEl.textContent = found ? 'Clic: pintar la cara · Shift: toda la pieza · Alt: tomar su color' : '';
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
      statusEl.textContent = 'Clic para borrar el punto de referencia';
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
    if (hasTarget) {
      hasTarget = false;
      refreshGhost();
    }
    return;
  }
  if (!hit || !hit.face) {
    hasTarget = false;
    refreshGhost();
    return;
  }
  // Apoyada sobre una cara horizontal, la pieza admite medias placas; al lado de otra, queda a ras de placa.
  // Se avanza un poco por la normal para caer en la celda vecina a la cara tocada.
  const probe = hit.point.clone().addScaledVector(hit.face.normal, 0.001);
  if (CATALOG[selected].grows) {
    slabTarget = slabAt(hit, probe);
    hasTarget = slabTarget !== null;
    refreshGhost();
    return;
  }
  // Sobre una cara plana la pieza se apoya justo en ella, aunque no caiga en la rejilla de placas (por ejemplo encima de una lámina);
  // sobre una inclinada se alinea a media placa.
  const flatTop = hit.face.normal.y > 0.999;
  target = {
    cx: Math.floor(probe.x),
    cy: flatTop ? (Math.round(hit.point.y * 1e4) / 1e4) * 3 : Math.abs(hit.face.normal.y) > 0.5 ? Math.floor(probe.y * 6 + 1e-6) / 2 : Math.floor(probe.y * 3),
    cz: Math.floor(probe.z),
    ox: 0,
    oz: 0,
  };
  // Las piezas menores que una celda se colocan en el trozo de la celda sobre el que apunta el cursor (mitades, tercios, cuartos...).
  const scale = placeSizeOf() ?? 1;
  const turned = rotation % 2 !== 0;
  const footW = CATALOG[selected].footprint[turned ? 1 : 0] * scale;
  const footD = CATALOG[selected].footprint[turned ? 0 : 1] * scale;
  if (footW < 1) target.ox = centeredOffset(probe.x - target.cx, footW);
  if (footD < 1) target.oz = centeredOffset(probe.z - target.cz, footD);
  hasTarget = Math.abs(target.cx + 0.5) < gridSize / 2 && Math.abs(target.cz + 0.5) < gridSize / 2 && target.cy >= 0 && target.cy < gridSize * 3;
  refreshGhost();
}

/**
 * Dónde empieza (dentro de la celda, de 0 a 1 − tamaño) una pieza de `size` < 1 centrada en el cursor `frac`.
 * Salta de medio en medio tamaño, así una pieza de ½ cabe en las dos esquinas y también en el centro de la celda.
 */
function centeredOffset(frac: number, size: number): number {
  const step = size / 2;
  const offset = Math.round((frac - size / 2) / step) * step;
  return Math.min(Math.max(offset, 0), 1 - size);
}

function refreshGhost(): void {
  if (ghost) {
    scene3d.remove(ghost);
    disposeObject(ghost);
    ghost = null;
  }
  if (mode !== 'place' || !hasTarget) return;
  const group = new THREE.Group();
  for (const piece of currentParts()) group.add(createPieceObject(piece, true));
  ghost = group;
  scene3d.add(ghost);
}

/** Lámina que crece desde la cara apuntada: eje y sentido de la cara, dónde está y la esquina de su celda en los otros ejes. */
let slabTarget: { axis: 0 | 1 | 2; sign: 1 | -1; surface: number; tangentMin: Vec3 } | null = null;

function slabAt(hit: THREE.Intersection, probe: THREE.Vector3): typeof slabTarget {
  const n = hit.face!.normal;
  const components = [n.x, n.y, n.z];
  const axis = components.map(Math.abs).indexOf(Math.max(...components.map(Math.abs))) as 0 | 1 | 2;
  const sign: 1 | -1 = components[axis] >= 0 ? 1 : -1;
  const surface = Math.round(hit.point.getComponent(axis) * 1e4) / 1e4;
  // El lado de la lámina es el "Tamaño" del panel. Menor que una celda, se coloca en el trozo de la celda al que apunta el cursor.
  const side = placeSizeOf() ?? 1;
  const snap = (value: number): number => {
    const cell = Math.floor(value);
    return side < 1 ? cell + centeredOffset(value - cell, side) : cell;
  };
  const tangentMin: Vec3 = [snap(probe.x), Math.floor(probe.y * 3) / 3, snap(probe.z)];
  // De costado, la lámina arranca desde la base de la pieza a la que se pega, así queda a ras aunque esa pieza no siga la rejilla de placas.
  if (axis !== 1) {
    const id = pieceIdOf(hit);
    const piece = id === undefined ? undefined : model.get(id);
    const box = piece ? boundsOf([piece]) : null;
    // Medida desde la base de la pieza; una lámina pequeña puede ir más arriba, centrada en el cursor, sin pasarse del alto de una celda.
    if (box) tangentMin[1] = box.min[1] + (side < 1 ? centeredOffset(probe.y - box.min[1], side) : 0);
    else if (side < 1) tangentMin[1] = snap(probe.y);
  }
  const [x, y, z] = tangentMin;
  if (Math.abs(x + 0.5) >= gridSize / 2 || Math.abs(z + 0.5) >= gridSize / 2 || y < 0 || y >= gridSize) return null;
  return { axis, sign, surface, tangentMin: [x, y, z] };
}

/** Piezas que se colocarían ahora; un elemento del catálogo puede componerse de varias partes convexas. */
function currentParts(): Piece[] {
  const def = CATALOG[selected];
  const others = model.all().filter((piece) => !hidden.has(piece.id));
  if (def.grows) {
    if (!slabTarget) return [];
    const { axis, sign, surface, tangentMin } = slabTarget;
    let slab = buildSlab(axis, sign, surface, tangentMin, color, placeSizeOf() ?? 1, slabThickOf() ?? SLAB_THICKNESS);
    // Sobre una cara de arriba, si la celda cubre algo más alto se apoya encima en vez de atravesarlo.
    if (axis === 1 && sign > 0) slab = translatePiece(slab, 0, clearanceLift([slab], others), 0);
    return expand([slab]);
  }
  const parts = buildPieces(def, target.cx + target.ox, target.cy, target.cz + target.oz, rotation, color, placeSizeOf() ?? 1);
  const lift = clearanceLift(parts, others);
  return expand(lift > 0 ? parts.map((part) => translatePiece(part, 0, lift, 0)) : parts);
}

function placePiece(): void {
  if (!hasTarget) return;
  model.apply({ added: currentParts(), removed: [] });
  useColor(color);
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

// Piezas ocultas: no se dibujan ni se pueden apuntar; siguen en el modelo (y en la exportación).
const hidden = new Set<number>();
function showPiece(piece: Piece): void {
  if (!hidden.has(piece.id)) batches.add(piece);
}
function hidePieces(ids: number[]): void {
  for (const id of ids) hidden.add(id);
  selection.remove(ids);
  for (const id of ids) batches.remove(id);
  refreshHidden();
}
function showHidden(ids: number[] = [...hidden]): void {
  for (const id of ids) {
    hidden.delete(id);
    const piece = model.get(id);
    if (piece && !selection.has(id)) batches.add(piece);
  }
  refreshHidden();
}
const showHiddenButton = document.getElementById('showHidden')!;
function refreshHidden(): void {
  showHiddenButton.hidden = hidden.size === 0;
  showHiddenButton.textContent = `Mostrar ocultas (${hidden.size})`;
  refreshGroups();
}
showHiddenButton.addEventListener('click', () => showHidden());
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
      setMode('select');
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
  const pieces = selectedPieces();
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

// Inspector de la selección: centro, tamaño y giro con números.
const inspectorEl = document.getElementById('inspector')!;
const insInput = (name: string) => inspectorEl.querySelector<HTMLInputElement>(`[data-ins="${name}"]`)!;
let rotSign = 1;
function syncInspector(): void {
  const box = boundsOf(selectedPieces());
  inspectorEl.hidden = !box;
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

/** Texto de estado con el número de piezas elegidas y la caja que ocupan (celdas y placas de alto). */
function selectionLabel(): string {
  const size = sizeOf(selectedPieces());
  if (!size) return '';
  const round = (v: number) => Math.round(v * 100) / 100;
  return `${selection.size} seleccionada(s) · ${round(size[0])} × ${round(size[2])} celdas, alto ${round(size[1] * 3)} placas (X × Z, Y)`;
}

/** Clic elige una pieza (y su grupo); Shift+clic la añade o quita; clic en vacío limpia la selección. */
function selectAt(event: PointerEvent): void {
  const id = pieceIdOf(castRay(event, false));
  if (id === undefined) {
    if (!event.shiftKey) selection.clear();
    return;
  }
  if (event.shiftKey) toggleGroup(id);
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

const selActionsEl = document.getElementById('selActions')!;
function syncSelectionActions(): void {
  selActionsEl.hidden = mode === 'cut' || mode === 'fill' || mode === 'vertex' || (selection.size === 0 && clipboard.length === 0);
  for (const button of selActionsEl.querySelectorAll<HTMLButtonElement>('button')) {
    button.disabled = button.dataset.sel === 'paste' ? clipboard.length === 0 : selection.size === 0;
  }
}
selActionsEl.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).dataset.sel;
  if (action === 'hide') hideSelected();
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

interface Drag {
  id: number;
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

const snapTo = (value: number, step: number): number => Math.round(value / step) * step || 0;

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

/** Shift + arrastrar desde un hueco dibuja un recuadro; al soltar se suman a la selección las piezas cuyo centro queda dentro. */
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

/** Une las piezas elegidas en una sola si su unión es convexa. */
function mergeSelected(): void {
  const result = mergeChange(selectedPieces());
  if ('error' in result) {
    statusEl.textContent = result.error;
    return;
  }
  commitTransform(result.change);
  statusEl.textContent = 'Piezas fusionadas en una';
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
let shapeCenter: Vec3 | null = null;

function rebuildShapeBase(): void {
  shapeBase = buildShape(shapeSpec, [0, 0, 0], color);
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
  if (!shapeBase) shapeBase = buildShape(shapeSpec, [0, 0, 0], color);
  if (!shapeBase) return;
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const half = shapeSpec.size.map((v) => v / 2);
  const raw = [hit.point.x + normal.x * half[0], hit.point.y + normal.y * half[1], hit.point.z + normal.z * half[2]];
  // Se ajusta el centro a un cuarto de celda para que la forma caiga sobre la rejilla.
  shapeCenter = [Math.round(raw[0] / 0.25) * 0.25, Math.round(raw[1] / (1 / 12)) * (1 / 12), Math.round(raw[2] / 0.25) * 0.25];
  shapeGhost = new THREE.Group();
  shapeGhost.add(createPieceObject({ ...shapeBase, color }, true));
  shapeGhost.position.set(...shapeCenter);
  scene3d.add(shapeGhost);
}

function placeShape(): void {
  if (!shapeCenter) return;
  const piece = buildShape(shapeSpec, shapeCenter, color);
  if (piece) {
    model.apply({ added: expand([piece]), removed: [] });
    useColor(color);
  }
}

const shapeActionsEl = document.getElementById('shapeActions')!;
const shapeKindEl = document.getElementById('shapeKind') as HTMLSelectElement;
for (const { kind, name } of SHAPES) shapeKindEl.add(new Option(name, kind));
function syncShapeActions(): void {
  shapeActionsEl.hidden = mode !== 'shape';
}
function readShapeInputs(): void {
  const num = (id: string, fallback: number) => {
    const value = Number((document.getElementById(id) as HTMLInputElement).value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  shapeSpec.kind = shapeKindEl.value as ShapeKind;
  shapeSpec.size = [num('shapeW', 1), num('shapeH', 1), num('shapeD', 1)];
  shapeSpec.sides = Math.max(MIN_SIDES, Math.min(MAX_SIDES, Math.round(num('shapeSides', 12))));
  rebuildShapeBase();
}
for (const id of ['shapeKind', 'shapeW', 'shapeH', 'shapeD', 'shapeSides']) document.getElementById(id)!.addEventListener('change', readShapeInputs);

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

const faceCentre = (face: Vec3[]): Vec3 => [
  face.reduce((s, p) => s + p[0], 0) / face.length,
  face.reduce((s, p) => s + p[1], 0) / face.length,
  face.reduce((s, p) => s + p[2], 0) / face.length,
];

/** Clic en modo pintar: pinta la cara; con Shift, toda la pieza; con Alt, toma su color como color actual. */
function paintAt(event: PointerEvent): void {
  const hit = castRay(event, false);
  const found = hit ? findFace(hit) : undefined;
  if (!found) return;
  if (event.altKey) {
    setColor(faceColorOf(found.piece, found.piece.faces.indexOf(found.face)));
    return;
  }
  model.apply(paintChange(paintTargets(found, event.shiftKey), color));
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
/** ¿Crece toda la cara conectada? La casilla lo decide y Mayús lo invierte mientras se pulsa. */
const growWhole = (event: { shiftKey: boolean }): boolean => growAllEl.checked !== event.shiftKey;
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
  preview: THREE.Object3D | null;
}
let growDrag: GrowDrag | null = null;

/** Paso fino al arrastrar: media celda en horizontal, un sexto de celda (media placa) en vertical. */
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
const placeSizeOf = bindAmount('place-size', document.getElementById('placeSizeInput') as HTMLInputElement, 1, () => 4, refreshGhost);
const slabThickOf = bindAmount('thick', document.getElementById('slabThickInput') as HTMLInputElement, 0.25, () => 4, refreshGhost);
const growAmountOf = bindAmount('grow-amount', document.getElementById('growAmount') as HTMLInputElement, null, () => gridSize);

/** Un clic sin arrastrar hace crecer lo elegido en el panel; en automático, una celda en horizontal o una placa en vertical. */
const growClickDistance = (normal: Vec3): number => growAmountOf() ?? (Math.abs(normal[1]) > 0.5 ? 1 / 3 : 1);

function showGrowPreview(): void {
  if (!growDrag) return;
  if (growDrag.preview) {
    scene3d.remove(growDrag.preview);
    disposeObject(growDrag.preview);
    growDrag.preview = null;
  }
  const preview = new THREE.Group();
  for (const piece of expand(grownPieces(growDrag.faces, growDrag.distance))) preview.add(createPieceObject(piece, true));
  growDrag.preview = preview;
  scene3d.add(growDrag.preview);
}

/** Un prisma por cada cara, del color de esa cara. */
const grownPieces = (faces: FaceOf[], distance: number): Piece[] =>
  faces.map(({ piece, face }) => extrudeFace(face, faceColorOf(piece, piece.faces.indexOf(face)), distance));

function startGrow(event: PointerEvent): void {
  if (mode !== 'grow' || event.button !== 0) return;
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
  growDrag = { face: found, faces, startX: event.clientX, startY: event.clientY, moved: false, distance: growClickDistance(found.normal), preview: null };
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
  growDrag.distance = Math.max(step, snapTo(t, step));
  statusEl.textContent = `Crecer ${+growDrag.distance.toFixed(3)} (Esc cancela)`;
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
  if (event.shiftKey && pieceIdOf(castRay(event, false)) === undefined) {
    startMarquee(event);
    return;
  }
  const hit = castRay(event, false);
  const id = pieceIdOf(hit);
  if (!hit || id === undefined) return;

  const wasSelected = selection.has(id);
  if (!wasSelected) {
    if (event.shiftKey) toggleGroup(id);
    else selection.set(groupIds(id));
  }

  const plane = new THREE.Plane();
  let vertical = event.altKey;
  if (vertical) {
    const facing = camera.getWorldDirection(new THREE.Vector3());
    facing.y = 0;
    if (facing.length() < 1e-3) vertical = false;
    else plane.setFromNormalAndCoplanarPoint(facing.normalize(), hit.point);
  }
  if (!vertical) plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hit.point);

  controls.enabled = false;
  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch {
    // Sin captura el arrastre sigue funcionando mientras el puntero esté sobre el lienzo.
  }
  drag = {
    id,
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
  if (drag.vertical) {
    drag.offset.set(0, snapTo(delta.y, event.shiftKey ? 2 * STEP_Y : STEP_Y), 0);
  } else {
    const step = event.shiftKey ? 2 * STEP_XZ : STEP_XZ;
    drag.offset.set(snapTo(delta.x, step), 0, snapTo(delta.z, step));
  }
  for (const object of selectedObjects()) object.position.copy(drag.offset);
  const { x, y, z } = drag.offset;
  statusEl.textContent = `Mover: X ${x}, Y ${+y.toFixed(3)}, Z ${z} (Esc cancela)`;
}

function finishDrag(commit: boolean, event?: PointerEvent): void {
  const current = drag;
  if (!current) return;
  drag = null;
  controls.enabled = true;
  for (const object of selectedObjects()) object.position.set(0, 0, 0);
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
    if (event?.shiftKey) toggleGroup(current.id);
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
    if (e.shiftKey) {
      const hit = castRay(e, false);
      const found = hit ? findFace(hit) : undefined;
      if (found) {
        setFaceHover(undefined);
        cutTool.useFace(found.face);
      } else statusEl.textContent = 'Shift+clic sobre una cara de una pieza para cortar con su plano';
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
  if (mode === 'erase') {
    removeAt(e);
    setEraseHover(undefined);
    updateHover(e);
    return;
  }
  if (mode === 'paint') {
    paintAt(e);
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
  if (mode === 'grow') return;
  if (e.shiftKey) removeAt(e);
  else placePiece();
  updateHover(e);
});
renderer.domElement.addEventListener('pointerleave', () => {
  hasTarget = false;
  snapped = null;
  refreshGhost();
  if (mode === 'cut') cutTool.setHover(null);
  if (mode === 'fill') fillTool.setHover(null);
  if (mode === 'vertex') vertexTool.clearHover();
  if (mode === 'erase') setEraseHover(undefined);
  if ((mode === 'grow' && !growDrag) || mode === 'paint' || mode === 'face') setFaceHover(undefined);
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
document.getElementById('gridToggle')!.addEventListener('change', (e) => {
  const visible = (e.target as HTMLInputElement).checked;
  gridVisible = visible;
  for (const line of gridLines) line.visible = visible;
});

// Panel
const toolsEl = document.getElementById('tools')!;
const piecesEl = document.getElementById('pieces')!;
const pieceButtons = CATALOG.map((def, i) => {
  const button = document.createElement('button');
  button.textContent = `${(i + 1) % 10} ${def.short}`;
  button.title = def.name;
  button.addEventListener('click', () => selectPiece(i));
  piecesEl.appendChild(button);
  return button;
});
const cutButton = document.createElement('button');
cutButton.textContent = 'C Cortar';
cutButton.addEventListener('click', () => setMode(mode === 'cut' ? 'place' : 'cut'));
toolsEl.appendChild(cutButton);
const selectButton = document.createElement('button');
selectButton.textContent = 'S Elegir';
selectButton.addEventListener('click', () => setMode(mode === 'select' ? 'place' : 'select'));
toolsEl.appendChild(selectButton);
const eraseButton = document.createElement('button');
eraseButton.textContent = 'B Borrar';
eraseButton.title = 'Clic en una pieza la borra';
eraseButton.addEventListener('click', () => setMode(mode === 'erase' ? 'place' : 'erase'));
toolsEl.appendChild(eraseButton);
const fillButton = document.createElement('button');
fillButton.textContent = 'L Rellenar';
fillButton.title = 'Marca puntos y se llena el volumen que encierran';
fillButton.addEventListener('click', () => setMode(mode === 'fill' ? 'place' : 'fill'));
toolsEl.appendChild(fillButton);
const vertexButton = document.createElement('button');
vertexButton.textContent = 'V Vértice';
vertexButton.title = 'Añade un vértice de referencia a la pieza elegida';
vertexButton.addEventListener('click', () => setMode(mode === 'vertex' ? 'place' : 'vertex'));
toolsEl.appendChild(vertexButton);
const bevelButton = document.createElement('button');
bevelButton.textContent = 'J Chaflán';
bevelButton.title = 'Corta una arista en chaflán';
bevelButton.addEventListener('click', () => setMode(mode === 'bevel' ? 'place' : 'bevel'));
toolsEl.appendChild(bevelButton);
const faceButton = document.createElement('button');
faceButton.textContent = 'F Cara';
faceButton.title = 'Extruye, cava o divide a partir de una cara';
faceButton.addEventListener('click', () => setMode(mode === 'face' ? 'place' : 'face'));
toolsEl.appendChild(faceButton);
const shapeButton = document.createElement('button');
shapeButton.textContent = 'T Forma';
shapeButton.title = 'Esfera, cilindro, cono o cápsula con medidas y lados a elegir';
shapeButton.addEventListener('click', () => setMode(mode === 'shape' ? 'place' : 'shape'));
toolsEl.appendChild(shapeButton);
const paintButton = document.createElement('button');
paintButton.textContent = 'P Pintar';
paintButton.title = 'Pinta una cara con el color elegido';
paintButton.addEventListener('click', () => setMode(mode === 'paint' ? 'place' : 'paint'));
toolsEl.appendChild(paintButton);
const growButton = document.createElement('button');
growButton.textContent = 'G Crecer';
growButton.title = 'Clic en una cara la hace crecer; arrastrar elige cuánto';
growButton.addEventListener('click', () => setMode(mode === 'grow' ? 'place' : 'grow'));
toolsEl.appendChild(growButton);

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
const vertexInfoEl = document.getElementById('vertexInfo')!;
function syncVertexActions(): void {
  vertexActionsEl.hidden = mode !== 'vertex';
  vertexInfoEl.textContent = `×${vertexTool.divisions}`;
}
vertexTool.onPhaseChange = syncVertexActions;
vertexActionsEl.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).dataset.vertex;
  if (action === 'more') vertexTool.morePoints();
  else if (action === 'less') vertexTool.fewerPoints();
  else if (action === 'done') setMode('place');
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
  if (mode === 'vertex') vertexTool.deactivate();
  if (mode === 'erase') setEraseHover(undefined);
  if (mode === 'grow') {
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
  if (mode === 'vertex') vertexTool.activate();
  hasTarget = false;
  refreshGhost();
  syncButtons();
  syncCutActions();
  syncFillActions();
  syncVertexActions();
  syncShapeActions();
  syncBevelActions();
  syncFaceActions();
  growActionsEl.hidden = mode !== 'grow';
  syncPlaceRows();
  syncSelectionActions();
}

/** El tamaño solo se muestra al colocar; el grosor, solo con la lámina. */
const placeSizeRow = document.getElementById('placeSize')!;
const slabThickRow = document.getElementById('slabThick')!;
function syncPlaceRows(): void {
  placeSizeRow.hidden = mode !== 'place';
  slabThickRow.hidden = mode !== 'place' || !CATALOG[selected].grows;
}

function selectPiece(index: number): void {
  selected = index;
  setMode('place');
  syncButtons();
  syncPlaceRows();
  refreshGhost();
}

function syncButtons(): void {
  pieceButtons.forEach((b, i) => b.classList.toggle('active', mode === 'place' && i === selected));
  cutButton.classList.toggle('active', mode === 'cut');
  selectButton.classList.toggle('active', mode === 'select');
  eraseButton.classList.toggle('active', mode === 'erase');
  growButton.classList.toggle('active', mode === 'grow');
  paintButton.classList.toggle('active', mode === 'paint');
  shapeButton.classList.toggle('active', mode === 'shape');
  bevelButton.classList.toggle('active', mode === 'bevel');
  faceButton.classList.toggle('active', mode === 'face');
  fillButton.classList.toggle('active', mode === 'fill');
  vertexButton.classList.toggle('active', mode === 'vertex');
}
syncButtons();

const colorInputEl = document.getElementById('color') as HTMLInputElement;
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
function setColor(next: number): void {
  color = next;
  colorInputEl.value = hex(next);
  shapeBase = null;
  refreshGhost();
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
function renderRecentColors(): void {
  recentEl.replaceChildren();
  for (let i = 0; i < RECENT_MAX; i++) {
    const swatch = document.createElement('button');
    const c = recentColors[i];
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
renderRecentColors();
document.getElementById('keepBoth')!.addEventListener('change', (e) => {
  cutTool.keepBoth = (e.target as HTMLInputElement).checked;
});

const openFileEl = document.getElementById('openFile') as HTMLInputElement;

/** Archivo del sistema vinculado al proyecto: Guardar escribe ahí sin volver a preguntar. */
let fileHandle: FileHandle | null = null;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : 'error desconocido');

/** Guardar escribe sobre el archivo actual; "Guardar como" (o un proyecto nuevo) abre el diálogo para elegir carpeta y nombre. */
async function saveProject(asNew = false): Promise<void> {
  const pieces = model.all();
  const data = serializeProject(pieces, model.points(), gridSize);
  const suggested = fileName === 'Sin título' ? 'gridfacet-proyecto.json' : fileName.replace(/(\.json)?$/i, '.json');
  let name = suggested;
  try {
    if (canPickSave()) {
      let handle = asNew ? null : fileHandle;
      if (!handle) {
        handle = await pickSave(suggested, 'Proyecto de Gridfacet', 'application/json', '.json');
        if (!handle) return;
      }
      await writeHandle(handle, data);
      fileHandle = handle;
      name = handle.name;
    } else {
      downloadBlob(data, suggested, 'application/json');
    }
  } catch (error) {
    statusEl.textContent = `No se pudo guardar: ${errorText(error)}`;
    return;
  }
  fileName = name;
  dirty = false;
  syncFileName();
  statusEl.textContent = `Guardado ${name} (${pieces.length} piezas)`;
}

/** Abrir reemplaza la escena como un cambio más, así que se puede deshacer. */
async function openProject(file: File, handle: FileHandle | null = null): Promise<void> {
  try {
    const { pieces: loaded, marks, gridSize: savedSize } = parseProjectFull(await file.text());
    if (savedSize !== undefined) setGridSize(savedSize);
    if (mode === 'cut') cutTool.cancel();
    model.apply({ added: loaded, removed: model.all(), marksAdded: marks, marksRemoved: model.points() });
    fileHandle = handle;
    fileName = file.name;
    dirty = false;
    syncFileName();
    statusEl.textContent = `Abierto ${file.name} (${loaded.length} piezas). Ctrl+Z para volver atrás`;
  } catch (error) {
    statusEl.textContent = error instanceof Error ? `No se pudo abrir: ${error.message}` : 'No se pudo abrir el archivo';
  }
}

/** Con el selector del sistema se conserva el archivo para poder guardar encima; si no, se usa el campo de archivo clásico. */
async function requestOpen(): Promise<void> {
  if (!canPickOpen()) {
    openFileEl.click();
    return;
  }
  try {
    const handle = await pickOpen('Proyecto de Gridfacet', 'application/json', '.json');
    if (handle) await openProject(await handle.getFile(), handle);
  } catch (error) {
    statusEl.textContent = `No se pudo abrir: ${errorText(error)}`;
  }
}

document.getElementById('save')!.addEventListener('click', () => void saveProject(false));
document.getElementById('saveAs')!.addEventListener('click', () => void saveProject(true));
document.getElementById('open')!.addEventListener('click', () => void requestOpen());
openFileEl.addEventListener('change', () => {
  const file = openFileEl.files?.[0];
  openFileEl.value = '';
  if (file) void openProject(file);
});

document.getElementById('export')!.addEventListener('click', async () => {
  const pieces = model.all();
  if (pieces.length === 0) {
    statusEl.textContent = 'No hay piezas que exportar';
    return;
  }
  const exportMode = (document.getElementById('exportMode') as HTMLSelectElement).value as ExportMode;
  const suggested = fileName === 'Sin título' ? 'gridfacet.glb' : fileName.replace(/\.json$/i, '') + '.glb';
  try {
    const data = await exportGlb(pieces, exportMode);
    let saved = suggested;
    if (canPickSave()) {
      const handle = await pickSave(suggested, 'Modelo GLB', 'model/gltf-binary', '.glb');
      if (!handle) return;
      await writeHandle(handle, data);
      saved = handle.name;
    } else {
      downloadBlob(data, suggested, 'model/gltf-binary');
    }
    statusEl.textContent = `Exportado ${saved} (${pieces.length} piezas)`;
  } catch (error) {
    statusEl.textContent = `No se pudo exportar: ${errorText(error)}`;
  }
});

if (import.meta.env.DEV) {
  // Utilidad de verificación: exporta y vuelve a cargar el GLB para inspeccionarlo.
  (window as unknown as { __glbCheck: unknown }).__glbCheck = async (exportMode: ExportMode) => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const buffer = await exportGlb(model.all(), exportMode);
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
    return { bytes: buffer.byteLength, meshes };
  };
}

const hudBody = document.getElementById('hudBody')!;
const hudToggle = document.getElementById('hudToggle')!;
function toggleHud(): void {
  hudBody.hidden = !hudBody.hidden;
  hudToggle.textContent = hudBody.hidden ? 'Mostrar menú' : 'Ocultar menú';
}
hudToggle.addEventListener('click', toggleHud);

const helpModal = document.getElementById('helpModal')!;
const setHelp = (open: boolean): void => {
  helpModal.hidden = !open;
};
document.getElementById('helpOpen')!.addEventListener('click', () => setHelp(true));
document.getElementById('helpClose')!.addEventListener('click', () => setHelp(false));
helpModal.addEventListener('pointerdown', (e) => {
  if (e.target === helpModal) setHelp(false);
});

/** Rehacer: con un corte o relleno a medias repone el punto quitado; si no, rehace el último bloque. */
function redo(): void {
  const tool = mode === 'cut' ? cutTool : mode === 'fill' ? fillTool : null;
  if (tool?.hasRedo) tool.redoPoint();
  else model.redo();
}

// Barra de ayuda contextual: dice qué se puede hacer ahora y cambia con el modo, la fase y la selección.
const hintEl = document.getElementById('hint')!;
const MODE_INFO: Record<Mode, { name: string; color: string }> = {
  place: { name: 'Colocar', color: '#3b6fd4' },
  select: { name: 'Elegir', color: '#6cc3ee' },
  erase: { name: 'Borrar', color: '#ff5a5a' },
  cut: { name: 'Cortar', color: '#ff9a3d' },
  fill: { name: 'Rellenar', color: '#45d19a' },
  vertex: { name: 'Vértice', color: '#ffd34d' },
  grow: { name: 'Crecer', color: '#b58cff' },
  paint: { name: 'Pintar', color: '#ff7ad1' },
  shape: { name: 'Forma', color: '#7ad1ff' },
  bevel: { name: 'Chaflán', color: '#ffb36b' },
  face: { name: 'Cara', color: '#8ce08c' },
};

function hintText(): string {
  switch (mode) {
    case 'place':
      if (CATALOG[selected].grows) return 'Clic: la lámina crece pegada a la cara que apuntas (arriba, abajo o de costado) · Shift+clic: borrar';
      return `Clic: colocar ${CATALOG[selected].name} · R: rotar · Shift+clic: borrar · arrastra para orbitar la vista`;
    case 'select':
      return selection.size === 0
        ? 'Clic en una pieza para elegirla · Shift+clic suma o quita · Shift+arrastrar en un hueco dibuja un recuadro · Ctrl+A elige todo'
        : 'Arrastra para mover · flechas, E y Q mueven · R gira · M, N, U espejo · Ctrl+G agrupa · K suma conectadas · Supr borra';
    case 'erase':
      return 'Clic en la pieza marcada en rojo para borrarla (también puntos de referencia)';
    case 'grow':
      return (growAllEl.checked ? 'Crece toda la cara conectada (Mayús: solo el cuadrito apuntado)' : 'Clic en una cara la hace crecer (Mayús: toda la cara conectada)') +
        ` · cantidad ${growAmountOf() === null ? 'automática' : `${+growAmountOf()!.toFixed(3)} celda(s)`} en el panel; arrastra para otra distancia · Esc cancela`;
    case 'bevel':
      return 'Clic en una arista (marcada en amarillo) para cortarla en chaflán · Tamaño en el panel · Esc sale';
    case 'face':
      return 'Clic en una cara: extruir (distancia positiva sale, negativa cava; “Punta” estrecha el extremo) o dividir la pieza · Esc sale';
    case 'shape':
      return `Clic: apoyar ${SHAPES.find((s) => s.kind === shapeSpec.kind)?.name.toLowerCase()} sobre lo que apuntas · cambia medidas y lados en el panel · Esc sale`;
    case 'paint':
      return 'Clic: pintar la cara · Shift+clic: toda la pieza · Alt+clic: tomar su color · el color se elige junto a “Piezas”';
    case 'vertex':
      return 'Clic en un punto amarillo para crear un punto de referencia · Alt: libre sobre la arista · + / − puntos cambia la densidad · Esc sale';
    case 'fill': {
      const n = fillTool.pointCount;
      if (n === 0) return 'Rellenar: marca 4 o más puntos que no estén en un mismo plano; se pegan a vértices y a la rejilla';
      if (n < 4) return `Rellenar: ${n} punto(s) marcados · faltan ${4 - n} como mínimo · Ctrl+Z quita el último`;
      return `Rellenar: ${n} puntos · clic en el primero (o Enter) crea la pieza que los une · Ctrl+Z quita el último`;
    }
    case 'cut': {
      if (cutTool.isClosed) return 'Región cerrada · F cambia el lado que se borra (el rojo) · Enter corta · Ctrl+Z reabre · Esc cancela';
      const n = cutTool.pointCount;
      if (n === 0) return 'Cortar: marca los puntos de una región sobre las piezas · Shift+clic en una cara la usa como plano';
      if (n < 3) return `Cortar: ${n} punto(s) marcados · marca al menos 3 · Ctrl+Z quita el último`;
      return `Cortar: ${n} puntos · clic en el primero (o Enter) cierra la región · Ctrl+Z quita el último`;
    }
  }
}

let shownHint = '';
function updateHint(): void {
  const info = MODE_INFO[mode];
  const axes = (['x', 'y', 'z'] as const).filter((axis) => symmetry[axis]).map((axis) => axis.toUpperCase());
  const text = hintText() + (axes.length > 0 ? ` · Simetría ${axes.join(' ')} activa` : '');
  const key = `${mode}|${text}`;
  if (key === shownHint) return;
  shownHint = key;
  hintEl.style.setProperty('--mode', info.color);
  document.getElementById('hud')!.style.setProperty('--mode', info.color);
  hintEl.replaceChildren();
  const chip = document.createElement('b');
  chip.textContent = info.name;
  const body = document.createElement('span');
  body.textContent = text;
  hintEl.append(chip, body);
}
// Las herramientas cambian de fase con clics y teclas; revisar unas cuantas veces por segundo es más sencillo que enganchar cada cambio.
setInterval(updateHint, 120);

// Secciones del panel plegables; se recuerda cuáles estaban plegadas.
const COLLAPSE_KEY = 'gridfacet.collapsed';
let collapsed: string[] = [];
try {
  collapsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]');
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

// Tamaño de la malla: número de celdas por lado (par, para que la cuadrícula siga alineada con las piezas).
const sizeInput = document.getElementById('gridSize') as HTMLInputElement;
const sizeLabel = document.getElementById('sizeLabel')!;
function setGridSize(requested: number): void {
  const even = Math.round(requested / 2) * 2;
  gridSize = Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Number.isFinite(even) ? even : gridSize));
  buildRoom();
  if (typeof syncSymmetry === 'function') syncSymmetry();
  sizeInput.value = String(gridSize);
  sizeLabel.textContent = `${gridSize} × ${gridSize} × ${gridSize} celdas (${gridSize * 3} placas de alto)`;
  const outside = model.all().filter((piece) => piece.faces.some((face) => face.some((p) => Math.abs(p[0]) > gridSize / 2 || Math.abs(p[2]) > gridSize / 2 || p[1] > gridSize))).length;
  statusEl.textContent = outside > 0 ? `Malla de ${gridSize}: ${outside} pieza(s) quedan fuera; se conservan` : `Malla de ${gridSize} × ${gridSize} × ${gridSize}`;
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
  refreshGhost();
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
  selection.onChange();
  refreshGhost();
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
  selection.onChange();
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

const PAN_KEYS: Record<string, [number, number]> = {
  arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1],
};
const panKeys = new Set<string>();
let panFast = false;
const panVelocity = new THREE.Vector3();
window.addEventListener('keyup', (e) => panKeys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => panKeys.clear());

/** Desplaza cámara y punto de mira juntos por el plano de la pantalla, con aceleración suave. */
function updatePan(dt: number): void {
  const want = new THREE.Vector3();
  for (const key of panKeys) want.x += PAN_KEYS[key][0], want.y += PAN_KEYS[key][1];
  const speed = camera.position.distanceTo(controls.target) * (panFast ? 1.6 : 0.7);
  want.multiplyScalar(speed);
  panVelocity.lerp(want, 1 - Math.exp(-dt * 10));
  if (panVelocity.lengthSq() < 1e-6) return;
  const move = new THREE.Vector3(panVelocity.x, panVelocity.y, 0).multiplyScalar(dt).applyQuaternion(camera.quaternion);
  camera.position.add(move);
  controls.target.add(move);
}

window.addEventListener('keydown', (e) => {
  if (!helpModal.hidden) {
    if (e.key === 'Escape' || e.key === '?') setHelp(false);
    return;
  }
  if (e.key === '?' || e.key === 'F1') {
    e.preventDefault();
    setHelp(true);
    return;
  }
  // Con el foco en un selector las teclas le pertenecen a él.
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.target instanceof HTMLInputElement && e.target.type === 'number') return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault();
    // Con una herramienta a medias, Ctrl+Z retrocede un punto en vez de deshacer el último bloque.
    const tool = mode === 'cut' ? cutTool : mode === 'fill' ? fillTool : null;
    if (!e.shiftKey && tool?.hasPoints) {
      tool.undoPoint();
      return;
    }
    if (e.shiftKey) redo();
    else model.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 's') {
    e.preventDefault();
    void saveProject(e.shiftKey);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'o') {
    e.preventDefault();
    void requestOpen();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'g') {
    e.preventDefault();
    if (e.shiftKey) ungroupSelected();
    else groupSelected();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'a') {
    e.preventDefault();
    selection.set(model.all().filter((piece) => !hidden.has(piece.id)).map((piece) => piece.id));
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'c') {
    e.preventDefault();
    copySelected();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'v') {
    e.preventDefault();
    pasteClipboard();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'd') {
    e.preventDefault();
    copySelected();
    pasteClipboard();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (key === 'escape' && (drag || growDrag || marquee)) {
    finishMarquee(false);
    finishDrag(false);
    finishGrow(false);
    return;
  }

  // Sin selección (o cortando) las flechas desplazan la cámara en pantalla; con selección mueven las piezas.
  if (key in PAN_KEYS && (mode === 'cut' || mode === 'fill' || mode === 'vertex' || selection.size === 0)) {
    e.preventDefault();
    panKeys.add(key);
    panFast = e.shiftKey;
    return;
  }

  if (mode !== 'cut' && mode !== 'fill' && mode !== 'vertex' && selection.size > 0) {
    // Shift duplica el paso: de media celda a una celda, y de media placa a una placa.
    const stepXZ = e.shiftKey ? 2 * STEP_XZ : STEP_XZ;
    const stepY = e.shiftKey ? 2 * STEP_Y : STEP_Y;
    const { forward, right } = cameraAxes();
    const arrows: Record<string, [number, number]> = {
      arrowup: forward,
      arrowdown: [-forward[0], -forward[1]],
      arrowright: right,
      arrowleft: [-right[0], -right[1]],
    };
    const dir = arrows[key];
    if (dir) {
      e.preventDefault();
      commitTransform(moveChange(selectedPieces(), dir[0] * stepXZ, 0, dir[1] * stepXZ));
      return;
    }
    if (key === 'pageup' || key === 'e') {
      commitTransform(moveChange(selectedPieces(), 0, stepY, 0));
      return;
    }
    if (key === 'pagedown' || key === 'q') {
      commitTransform(moveChange(selectedPieces(), 0, -stepY, 0));
      return;
    }
  }

  const n = Number(e.key);
  if (n >= 1 && n <= Math.min(9, CATALOG.length)) selectPiece(n - 1);
  if (key === 'c') setMode(mode === 'cut' ? 'place' : 'cut');
  if (key === 's') setMode(mode === 'select' ? 'place' : 'select');
  if (key === 'b') setMode(mode === 'erase' ? 'place' : 'erase');
  if (key === 'g') setMode(mode === 'grow' ? 'place' : 'grow');
  if (key === 'p') setMode(mode === 'paint' ? 'place' : 'paint');
  if (key === 'o') {
    if (e.shiftKey) showHidden();
    else hideSelected();
  }
  if (key === 'i') isolateSelected();
  if (key === 't') setMode(mode === 'shape' ? 'place' : 'shape');
  if (key === 'j') setMode(mode === 'bevel' ? 'place' : 'bevel');
  if (key === 'l') setMode(mode === 'fill' ? 'place' : 'fill');
  if (key === 'f' && mode !== 'cut') setMode(mode === 'face' ? 'place' : 'face');
  if (key === 'v') setMode(mode === 'vertex' ? 'place' : 'vertex');
  if (key === 'h') toggleHud();
  if (key === 'w') setWireframe(!isWireframeView());
  if (key === 'x' || key === 'y' || key === 'z') toggleSymmetry(key);
  if (mode !== 'cut' && mode !== 'fill' && mode !== 'vertex') {
    if (key === 'm') mirrorSelected('x');
    if (key === 'n') mirrorSelected('z');
    if (key === 'u') mirrorSelected('y');
    if (key === 'k') selectConnected();
  }
  if (key === 'delete' || key === 'backspace') deleteSelected();
  if (mode === 'cut') {
    if (key === 'enter') {
      e.preventDefault();
      cutTool.apply();
    }
    if (key === 'f') cutTool.flip();
    if (key === 'escape') cutTool.cancel();
  } else if (mode === 'vertex' || mode === 'paint' || mode === 'erase' || mode === 'shape' || mode === 'bevel' || mode === 'face') {
    if (key === 'escape') setMode('place');
  } else if (mode === 'fill') {
    if (key === 'enter') {
      e.preventDefault();
      fillTool.apply();
    }
    if (key === 'escape') fillTool.cancel();
  } else if (key === 'escape') {
    selection.clear();
  } else if (key === 'r' && mode === 'select' && selection.size > 0) {
    commitTransform(rotateChange(selectedPieces(), e.shiftKey ? 3 : 1));
  } else if (key === 'r' && mode === 'place') {
    rotation = (rotation + 1) % 4;
    refreshGhost();
  }
});

function resize(): void {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let lastFrame = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  updatePan(dt);
  controls.update();
  batches.flush();
  renderer.render(scene3d, camera);
});
