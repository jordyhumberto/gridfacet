import { makePiece, type Piece, type Vec3 } from './piece';

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
  return makePiece(faces, piece.color, piece.faceColors);
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
