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

  const grid = new Map<string, number[]>();
  entries.forEach((entry, i) => {
    const k = entry.position.map((v) => Math.floor(v / tolerance)).join(',');
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const nearest = (target: Vec3): number => {
    const base = target.map((v) => Math.floor(v / tolerance));
    let best = -1;
    let bestDistance = tolerance;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const i of grid.get(`${base[0] + dx},${base[1] + dy},${base[2] + dz}`) ?? []) {
            const q = entries[i].position;
            const d = Math.hypot(q[0] - target[0], q[1] - target[1], q[2] - target[2]);
            if (d <= bestDistance) {
              bestDistance = d;
              best = i;
            }
          }
        }
      }
    }
    return best;
  };

  for (const entry of entries) {
    const sum: Vec3 = [...entry.position];
    let count = 1;
    let lonely = false;
    for (const mirror of mirrors) {
      const partner = nearest(mirror.point(entry.position));
      if (partner < 0) {
        lonely = true;
        continue;
      }
      const back = mirror.point(entries[partner].position);
      for (let i = 0; i < 3; i++) sum[i] += back[i];
      count++;
    }
    if (lonely) result.unpaired.add(`${entry.id}:${entry.key}`);
    const average = sum.map((v) => v / count) as Vec3;
    if (Math.hypot(average[0] - entry.position[0], average[1] - entry.position[1], average[2] - entry.position[2]) < 1e-6) continue;
    let moves = result.moves.get(entry.id);
    if (!moves) result.moves.set(entry.id, (moves = new Map()));
    moves.set(entry.key, average);
    result.fixed++;
  }
  return result;
}
