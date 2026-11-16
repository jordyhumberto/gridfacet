import { makePiece, type Piece, type Vec3 } from './piece';
import { remapTexture } from './texture';
import { uniqueVertices, vertexKey } from './vertices';

/** Ejes con simetría activa y posición del plano de espejo en cada uno. */
export interface Symmetry {
  x: boolean;
  y: boolean;
  z: boolean;
  center: Vec3;
}

/** Una de las reflexiones que salen de combinar los ejes activos. */
export interface Reflection {
  point: (p: Vec3) => Vec3;
  /** Igual que `point` pero para direcciones (normales), que no dependen del centro. */
  dir: (v: Vec3) => Vec3;
  /** Con un número impar de espejos hay que invertir el orden de los vértices de cada cara. */
  flips: boolean;
}

/** Todas las reflexiones posibles con los ejes activos, sin la identidad (X solo → 1; X y Z → 3; X, Y y Z → 7). */
export function reflections(sym: Symmetry): Reflection[] {
  const axes = ([sym.x, sym.y, sym.z] as const).map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
  const out: Reflection[] = [];
  for (let mask = 1; mask < 1 << axes.length; mask++) {
    const used = axes.filter((_, bit) => mask & (1 << bit));
    out.push({
      point: (p) => {
        const q: Vec3 = [p[0], p[1], p[2]];
        for (const i of used) q[i] = 2 * sym.center[i] - p[i];
        return q;
      },
      dir: (v) => {
        const q: Vec3 = [v[0], v[1], v[2]];
        for (const i of used) q[i] = -v[i];
        return q;
      },
      flips: used.length % 2 === 1,
    });
  }
  return out;
}

export function reflectPiece(piece: Piece, reflection: Reflection): Piece {
  const faces = piece.faces.map((face) => {
    const mapped = face.map(reflection.point);
    return reflection.flips ? mapped.reverse() : mapped;
  });
  // Un reflejo con giro invierte el orden de los vértices: las texturas se remuestrean al marco nuevo.
  const textures = piece.faceTextures?.map((texture, i) => (texture ? remapTexture(texture, piece.faces[i], faces[i], reflection.point) : null));
  return makePiece(faces, piece.color, piece.faceColors, textures, piece.faceFlags);
}

/** Clave geométrica de una pieza: sus vértices ordenados, para reconocer piezas iguales. */
export function pieceKey(piece: Piece): string {
  const set = new Set<string>();
  for (const face of piece.faces) for (const p of face) set.add(p.map((v) => Math.round(v * 1e5)).join(','));
  return [...set].sort().join('|');
}

/** Los puntos dados más sus imágenes en espejo, sin repetir. */
export function withSymmetryPoints(points: Vec3[], sym: Symmetry): Vec3[] {
  const key = (p: Vec3) => p.map((v) => Math.round(v * 1e5)).join(',');
  const seen = new Set(points.map(key));
  const out = [...points];
  for (const reflection of reflections(sym)) {
    for (const point of points) {
      const image = reflection.point(point);
      if (seen.has(key(image))) continue;
      seen.add(key(image));
      out.push(image);
    }
  }
  return out;
}

/** Las piezas dadas más sus imágenes en espejo, sin repetir las que caen sobre sí mismas o sobre otra. */
export function withSymmetry(pieces: Piece[], sym: Symmetry): Piece[] {
  const all = reflections(sym);
  if (all.length === 0) return pieces;
  const seen = new Set(pieces.map(pieceKey));
  const out = [...pieces];
  for (const reflection of all) {
    for (const piece of pieces) {
      const image = reflectPiece(piece, reflection);
      const key = pieceKey(image);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(image);
    }
  }
  return out;
}

/** Hasta dónde se busca el vértice gemelo de otro al otro lado del espejo. */
export const MIRROR_TOLERANCE = 0.03;
/** Cuántas vueltas como máximo da `symmetrize` para que todos los gemelos se pongan de acuerdo. */
const MAX_PASSES = 12;

export interface Symmetrized {
  /** Por pieza, la posición nueva de cada vértice que cambia (por su clave). */
  moves: Map<number, Map<string, Vec3>>;
  /** Vértices que se movieron. */
  fixed: number;
  /** `idPieza:clave` de los vértices sin gemelo en alguno de los espejos activos. */
  unpaired: Set<string>;
  /** Cuántos vértices hay en total. */
  total: number;
}

/**
 * Calcula cómo dejar las piezas exactamente simétricas: cada vértice se promedia con las imágenes en espejo de sus gemelos
 * (el vértice más cercano a su reflejo, a menos de `tolerance`); los que están casi sobre un plano quedan sobre él.
 */
export function symmetrize(pieces: Piece[], sym: Symmetry, tolerance = MIRROR_TOLERANCE): Symmetrized {
  const mirrors = reflections(sym);
  const entries: { id: number; key: string; position: Vec3 }[] = [];
  for (const piece of pieces) for (const position of uniqueVertices(piece)) entries.push({ id: piece.id, key: vertexKey(position), position });
  const result: Symmetrized = { moves: new Map(), fixed: 0, unpaired: new Set(), total: entries.length };
  if (mirrors.length === 0) return result;

  // Dos piezas que tienen un vértice en el mismo sitio comparten un solo punto: si no, solo una se emparejaría con el gemelo del otro lado
  // y la otra se quedaría sin moverse (se abriría una grieta entre las dos). Se empareja por puntos y el resultado vale para todas las entradas.
  const points: { position: Vec3; members: number[] }[] = [];
  const pointOf = new Map<string, number>();
  entries.forEach((entry, index) => {
    const at = pointOf.get(entry.key);
    if (at === undefined) {
      pointOf.set(entry.key, points.length);
      points.push({ position: entry.position, members: [index] });
    } else points[at].members.push(index);
  });

  const original = points.map((point) => point.position);
  let current = original;
  // Los gemelos se emparejan de uno en uno, de los más cercanos a los más lejanos: así dos vértices vecinos no se disputan el mismo gemelo.
  // Con las posiciones ya promediadas se repite hasta que nada se mueva.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const grid = new Map<string, number[]>();
    current.forEach((position, i) => {
      const k = position.map((v) => Math.floor(v / tolerance)).join(',');
      const list = grid.get(k);
      if (list) list.push(i);
      else grid.set(k, [i]);
    });
    const partners = mirrors.map((mirror) => {
      const candidates: { d: number; i: number; j: number }[] = [];
      current.forEach((position, i) => {
        const target = mirror.point(position);
        const base = target.map((v) => Math.floor(v / tolerance));
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              for (const j of grid.get(`${base[0] + dx},${base[1] + dy},${base[2] + dz}`) ?? []) {
                if (j < i) continue;
                const q = current[j];
                const d = Math.hypot(q[0] - target[0], q[1] - target[1], q[2] - target[2]);
                if (d <= tolerance) candidates.push({ d, i, j });
              }
            }
          }
        }
      });
      candidates.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
      const partner = new Array<number>(current.length).fill(-1);
      for (const { i, j } of candidates) {
        if (partner[i] >= 0 || partner[j] >= 0) continue;
        partner[i] = j;
        partner[j] = i;
      }
      return partner;
    });
    const next: Vec3[] = [];
    let moved = 0;
    points.forEach((point, index) => {
      const here = current[index];
      const sum: Vec3 = [...here];
      let count = 1;
      let lonely = false;
      mirrors.forEach((mirror, m) => {
        const partner = partners[m][index];
        if (partner < 0) {
          lonely = true;
          return;
        }
        const back = mirror.point(current[partner]);
        for (let i = 0; i < 3; i++) sum[i] += back[i];
        count++;
      });
      if (lonely && pass === 0) for (const member of point.members) result.unpaired.add(`${entries[member].id}:${entries[member].key}`);
      const average = sum.map((v) => v / count) as Vec3;
      if (Math.hypot(average[0] - here[0], average[1] - here[1], average[2] - here[2]) > 1e-7) moved++;
      next.push(average);
    });
    current = next;
    if (moved === 0) break;
  }
  points.forEach((point, index) => {
    const to = current[index];
    const from = original[index];
    if (Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) < 1e-6) return;
    for (const member of point.members) {
      const entry = entries[member];
      let moves = result.moves.get(entry.id);
      if (!moves) result.moves.set(entry.id, (moves = new Map()));
      moves.set(entry.key, to);
      result.fixed++;
    }
  });
  return result;
}
