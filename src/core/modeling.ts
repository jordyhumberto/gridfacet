import type { Change } from './cut';
import { convexHull } from './hull';
import type { FaceOf } from './region';
import { boundsOf } from './transform';
import {
  clipPiece,
  faceColorOf,
  faceNormal,
  keepGroup,
  makePiece,
  newGroupId,
  volume,
  withGroup,
  type Piece,
  type Plane,
  type Vec3,
} from './piece';

/** Más puntos que esto hacen lento el casco convexo (crece con la cuarta potencia). */
export const MAX_HULL_POINTS = 140;
/** Las astillas con menos volumen que esto (celdas cúbicas) se descartan al restar. */
const MIN_VOLUME = 1e-6;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const key = (p: Vec3): string => p.map((v) => Math.round(v * 1e5)).join(',');

const centroid = (points: Vec3[]): Vec3 => {
  const c: Vec3 = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) c[i] += p[i] / points.length;
  return c;
};

const uniquePoints = (pieces: Piece[]): Vec3[] => {
  const seen = new Map<string, Vec3>();
  for (const piece of pieces) for (const face of piece.faces) for (const p of face) seen.set(key(p), p);
  return [...seen.values()];
};

/** Triángulos que tendría la malla de las piezas (cada cara de n lados son n−2). */
export function triangleCount(pieces: Piece[]): number {
  let total = 0;
  for (const piece of pieces) for (const face of piece.faces) total += Math.max(0, face.length - 2);
  return total;
}

const boxesOverlap = (a: Piece, b: Piece): boolean => {
  const [x, y] = [boundsOf([a])!, boundsOf([b])!];
  return [0, 1, 2].every((i) => x.min[i] < y.max[i] - 1e-9 && y.min[i] < x.max[i] - 1e-9);
};

/**
 * Lo que queda de `piece` al quitarle el volumen de `cutter`, como piezas convexas (a lo sumo una por cara del cortador).
 * Devuelve null si no se solapan: la pieza queda igual.
 */
export function subtractConvex(piece: Piece, cutter: Piece): Piece[] | null {
  if (!boxesOverlap(piece, cutter)) return null;
  const parts: Piece[] = [];
  let remaining: Piece | null = piece;
  for (const face of cutter.faces) {
    const n = unit(faceNormal(face));
    const d = dot(n, face[0]);
    // Fuera de este plano del cortador queda material; dentro se sigue recortando.
    const outside = clipPiece(remaining, { n: scale(n, -1), d: -d });
    if (outside) parts.push(outside);
    remaining = clipPiece(remaining, { n, d });
    if (!remaining) return null;
  }
  return parts.filter((part) => volume(part) > MIN_VOLUME);
}

/** Resta cada cortador de las piezas objetivo que toca. Los cortadores se borran salvo que `keepCutters`. */
export function excavateChange(targets: Piece[], cutters: Piece[], keepCutters = false): Change {
  let current = targets;
  for (const cutter of cutters) {
    const next: Piece[] = [];
    for (const piece of current) {
      const parts = subtractConvex(piece, cutter);
      if (parts) next.push(...parts);
      else next.push(piece);
    }
    current = next;
  }
  const kept = new Set(current.map((piece) => piece.id));
  const original = new Set(targets.map((piece) => piece.id));
  const removed = targets.filter((piece) => !kept.has(piece.id));
  const added = current.filter((piece) => !original.has(piece.id));
  if (removed.length === 0) return { added: [], removed: [] };
  if (!keepCutters) removed.push(...cutters);
  return { added, removed };
}

/**
 * Empuja una cara: con distancia positiva sale un cuerpo nuevo pegado a ella; con negativa se cava hacia dentro.
 * `taper` es el tamaño del extremo respecto a la base (1 recto, 0.5 se estrecha a la mitad, 0 acaba en punta).
 * `inset` (0–0.9) separa la base del borde de la cara: deja un reborde alrededor del cráter o del saliente.
 */
export function extrudeFaceChange(piece: Piece, faceIndex: number, distance: number, taper = 1, inset = 0): Change {
  const face = piece.faces[faceIndex];
  if (!face || Math.abs(distance) < 1e-6 || !(taper >= 0) || !(inset >= 0 && inset <= 0.9)) return { added: [], removed: [] };
  const n = unit(faceNormal(face));
  const c = centroid(face);
  const base = 1 - inset;
  const ring = (k: number, shift: number): Vec3[] => face.map((p) => add(add(c, scale(sub(p, c), k * base)), scale(n, shift)));

  if (distance > 0) {
    const faces = convexHull([...ring(1, 0), ...ring(taper, distance)]);
    if (!faces) return { added: [], removed: [] };
    const body = keepGroup(makePiece(faces, faceColorOf(piece, faceIndex)), piece);
    return { added: [body], removed: [] };
  }

  // Hacia dentro: el cortador sobresale un poco de la cara para que el corte atraviese limpio, siguiendo la misma pendiente.
  const depth = -distance;
  const overshoot = 0.02;
  const over = overshoot / depth;
  const faces = convexHull([...ring(1 + (1 - taper) * over, overshoot), ...ring(taper, distance)]);
  if (!faces) return { added: [], removed: [] };
  const parts = subtractConvex(piece, makePiece(faces, piece.color));
  if (!parts) return { added: [], removed: [] };
  return { added: parts, removed: [piece] };
}

/** Lo que sobresale hacia fuera del cortador de una cara para que el corte atraviese limpio la superficie. */
const SINK_OVERSHOOT = 0.02;

/** Un prisma bajo cada cara, de `distance` de hondo: el volumen que se quitaría al hundirlas. */
export function sinkCutters(faces: FaceOf[], distance: number, color = 0xff5a5a): Piece[] {
  if (!(distance > 0)) return [];
  const cutters: Piece[] = [];
  for (const { face } of faces) {
    const n = unit(faceNormal(face));
    const hull = convexHull([...face.map((p) => add(p, scale(n, SINK_OVERSHOOT))), ...face.map((p) => sub(p, scale(n, distance)))]);
    if (hull) cutters.push(makePiece(hull, color));
  }
  return cutters;
}

/**
 * Hunde caras hacia dentro (lo contrario de crecer): resta de `pieces` un prisma de `distance` bajo cada cara.
 * Con varias caras (toda la cara conectada de un muro) se hunden a la vez y con la misma profundidad.
 */
export function sinkFacesChange(faces: FaceOf[], pieces: Piece[], distance: number): Change {
  const cutters = sinkCutters(faces, distance);
  if (cutters.length === 0) return { added: [], removed: [] };
  return excavateChange(pieces, cutters, true);
}

/** Parte la pieza en dos con un plano paralelo a una de sus caras, a la fracción `fraction` (0–1) de su fondo contando desde ella. */
export function splitFaceChange(piece: Piece, faceIndex: number, fraction: number): Change {
  const face = piece.faces[faceIndex];
  if (!face || !(fraction > 0 && fraction < 1)) return { added: [], removed: [] };
  const n = unit(faceNormal(face));
  const top = dot(n, face[0]);
  const bottom = Math.min(...uniquePoints([piece]).map((p) => dot(n, p)));
  const d = top - fraction * (top - bottom);
  const plane: Plane = { n, d };
  const deep = clipPiece(piece, plane);
  const near = clipPiece(piece, { n: scale(n, -1), d: -d });
  if (!deep || !near) return { added: [], removed: [] };
  return { added: [deep, near], removed: [piece] };
}

/** Une piezas en una sola si su unión es convexa; si no, explica por qué no. */
export function mergeChange(pieces: Piece[]): { change: Change } | { error: string } {
  if (pieces.length < 2) return { error: 'Elige al menos dos piezas para fusionarlas' };
  const points = uniquePoints(pieces);
  if (points.length > MAX_HULL_POINTS) return { error: `Demasiados vértices para fusionar (${points.length} de ${MAX_HULL_POINTS})` };
  const faces = convexHull(points);
  if (!faces) return { error: 'Las piezas no forman un volumen' };
  const merged = makePiece(faces, pieces[0].color);
  const total = pieces.reduce((sum, piece) => sum + volume(piece), 0);
  if (Math.abs(volume(merged) - total) > 1e-3 * Math.max(1, total)) {
    return { error: 'La unión no es convexa (o las piezas se solapan o dejan huecos): no se puede fusionar' };
  }

  // Cada cara del resultado conserva el color de la cara original que descansa sobre su plano, si la hay.
  const originals = pieces.flatMap((piece) => piece.faces.map((face, i) => ({ face, color: faceColorOf(piece, i) })));
  const colors = faces.map((face) => {
    const n = unit(faceNormal(face));
    const d = dot(n, face[0]);
    const match = originals.find(
      (o) => dot(unit(faceNormal(o.face)), n) > 0.999 && o.face.every((p) => Math.abs(dot(n, p) - d) < 1e-6),
    );
    return match ? match.color : merged.color;
  });
  const result = makePiece(faces, merged.color, colors);
  const groups = new Set(pieces.map((piece) => piece.group));
  if (groups.size === 1) keepGroup(result, pieces[0]);
  return { change: { added: [result], removed: pieces } };
}

export interface RepeatSpec {
  count: number;
  /** Desplazamiento entre una copia y la siguiente, en celdas. */
  move: Vec3;
  /** Giro entre copias alrededor de X, Y y Z, en grados. */
  rotate: Vec3;
  /** Factor de escala entre copias (1 = mismo tamaño). */
  scale: number;
}

/**
 * Copia las piezas `count` veces; cada copia aplica una vez más el desplazamiento, el giro y la escala (alrededor del centro del conjunto).
 * Sirve para escaleras, dientes, escamas, ramas o espirales.
 */
export function repeatChange(pieces: Piece[], spec: RepeatSpec): Change {
  const box = boundsOf(pieces);
  const count = Math.min(60, Math.floor(spec.count));
  if (!box || count < 1 || !(spec.scale > 0)) return { added: [], removed: [] };
  const c = box.min.map((v, i) => (v + box.max[i]) / 2) as Vec3;
  const rad = (deg: number) => (deg * Math.PI) / 180;

  const added: Piece[] = [];
  for (let i = 1; i <= count; i++) {
    const [sx, cx] = [Math.sin(rad(spec.rotate[0] * i)), Math.cos(rad(spec.rotate[0] * i))];
    const [sy, cy] = [Math.sin(rad(spec.rotate[1] * i)), Math.cos(rad(spec.rotate[1] * i))];
    const [sz, cz] = [Math.sin(rad(spec.rotate[2] * i)), Math.cos(rad(spec.rotate[2] * i))];
    const k = spec.scale ** i;
    const map = (p: Vec3): Vec3 => {
      let [x, y, z] = sub(p, c);
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      [x, z] = [x * cy + z * sy, -x * sy + z * cy];
      [x, y] = [x * cz - y * sz, x * sz + y * cz];
      return [c[0] + x * k + spec.move[0] * i, c[1] + y * k + spec.move[1] * i, c[2] + z * k + spec.move[2] * i];
    };
    // Cada copia de un grupo forma su propio grupo, para no pegarse al original.
    const groups = new Map<number, number>();
    for (const piece of pieces) {
      const copy = makePiece(piece.faces.map((face) => face.map(map)), piece.color, piece.faceColors);
      if (piece.group === undefined) {
        added.push(copy);
        continue;
      }
      if (!groups.has(piece.group)) groups.set(piece.group, newGroupId());
      added.push(withGroup(copy, groups.get(piece.group), piece.groupName));
    }
  }
  return { added, removed: [] };
}
