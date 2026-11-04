import { faceNormal, makePiece, type Piece, type Vec3 } from './piece';
import { remapTexture, type FaceTexture } from './texture';

/** Clave de un vértice por su posición: los de varias caras que coinciden son el mismo vértice de la pieza. */
export const vertexKey = (p: Vec3): string => p.map((v) => Math.round(v * 1e5)).join(',');

/** Los vértices distintos de la pieza (uno por posición). */
export function uniqueVertices(piece: Piece): Vec3[] {
  const seen = new Map<string, Vec3>();
  for (const face of piece.faces) for (const p of face) if (!seen.has(vertexKey(p))) seen.set(vertexKey(p), p);
  return [...seen.values()];
}

const same = (a: Vec3, b: Vec3): boolean => vertexKey(a) === vertexKey(b);

/**
 * Rehace la pieza con otras caras. `mapFace` devuelve la cara nueva o null para quitarla; el color de cada cara sigue a la suya
 * y su textura se remuestrea al marco nuevo, así los píxeles se quedan pegados a la superficie. Devuelve null si no queda ninguna cara.
 * Con `keepId` la pieza resultante conserva el id (para vistas previas en vivo).
 */
function rebuild(piece: Piece, mapFace: (face: Vec3[], index: number) => Vec3[] | null, keepId: boolean): Piece | null {
  const faces: Vec3[][] = [];
  const colors: number[] = [];
  const textures: (FaceTexture | null)[] = [];
  const flags: number[] = [];
  piece.faces.forEach((face, i) => {
    const next = mapFace(face, i);
    if (!next || next.length < 3) return;
    faces.push(next);
    colors.push(piece.faceColors?.[i] ?? piece.color);
    flags.push(piece.faceFlags?.[i] ?? 0);
    const texture = piece.faceTextures?.[i];
    const moved = next.length !== face.length || next.some((p, k) => !same(p, face[k]));
    textures.push(texture ? (moved ? remapTexture(texture, face, next, (p) => p) : texture) : null);
  });
  if (faces.length === 0) return null;
  const result = makePiece(faces, piece.color, colors, piece.faceTextures ? textures : undefined, flags);
  if (piece.group !== undefined) result.group = piece.group;
  if (piece.groupName) result.groupName = piece.groupName;
  if (piece.layer !== undefined) result.layer = piece.layer;
  if (keepId) result.id = piece.id;
  return result;
}

/** Mueve los vértices elegidos (por clave) de la pieza. Todas las caras que los comparten los siguen. */
export function moveVertices(piece: Piece, keys: ReadonlySet<string>, delta: Vec3, keepId = false): Piece | null {
  return rebuild(piece, (face) => face.map((p) => (keys.has(vertexKey(p)) ? ([p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]] as Vec3) : p)), keepId);
}

/** Lleva cada vértice elegido a la posición que da `target` (por ejemplo, el punto más cercano de la rejilla). */
export function placeVertices(piece: Piece, keys: ReadonlySet<string>, target: (p: Vec3) => Vec3, keepId = false): Piece | null {
  return rebuild(piece, (face) => face.map((p) => (keys.has(vertexKey(p)) ? target(p) : p)), keepId);
}

/** Quita de la cara los vértices consecutivos que quedaron en el mismo sitio. */
function dedupe(face: Vec3[]): Vec3[] {
  const ring = face.filter((p, i) => !same(p, face[(i + 1) % face.length]));
  return ring.length >= 3 ? ring : [];
}

/** Junta los vértices elegidos en uno solo, en su centro. Las caras que se quedan sin superficie desaparecen. */
export function mergeVertices(piece: Piece, keys: ReadonlySet<string>): Piece | null {
  const chosen = uniqueVertices(piece).filter((p) => keys.has(vertexKey(p)));
  if (chosen.length < 2) return null;
  const centre: Vec3 = [0, 1, 2].map((k) => chosen.reduce((sum, p) => sum + p[k], 0) / chosen.length) as Vec3;
  return rebuild(piece, (face) => dedupe(face.map((p) => (keys.has(vertexKey(p)) ? centre : p))), false);
}

/** Quita los vértices elegidos de todas las caras que los usan; una cara con menos de tres vértices se pierde. */
export function deleteVertices(piece: Piece, keys: ReadonlySet<string>): Piece | null {
  return rebuild(piece, (face) => face.filter((p) => !keys.has(vertexKey(p))), false);
}

/** Índices de las caras cuyos vértices están todos entre los elegidos. */
export function facesWithin(piece: Piece, keys: ReadonlySet<string>): number[] {
  return piece.faces.flatMap((face, i) => (face.every((p) => keys.has(vertexKey(p))) ? [i] : []));
}

/** Quita las caras indicadas; la pieza queda abierta por ahí. Devuelve null si no queda ninguna cara. */
export function deleteFaces(piece: Piece, indices: ReadonlySet<number>): Piece | null {
  return rebuild(piece, (face, i) => (indices.has(i) ? null : face), false);
}

/** Da la vuelta a las caras indicadas (la normal pasa a mirar al otro lado); sus píxeles siguen pegados a la superficie. */
export function flipFaces(piece: Piece, indices: ReadonlySet<number>): Piece | null {
  return rebuild(piece, (face, i) => (indices.has(i) ? [...face].reverse() : face), false);
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Pone un vértice nuevo sobre la arista entre dos vértices, a la fracción `t` (0–1) desde el primero, en todas las caras que la comparten. */
export function splitEdge(piece: Piece, a: Vec3, b: Vec3, t: number): { piece: Piece; vertex: Vec3 } | null {
  if (!(t > 0 && t < 1)) return null;
  const vertex = lerp(a, b, t);
  let found = false;
  const result = rebuild(
    piece,
    (face) => {
      const ring: Vec3[] = [];
      face.forEach((p, i) => {
        ring.push(p);
        const next = face[(i + 1) % face.length];
        if ((same(p, a) && same(next, b)) || (same(p, b) && same(next, a))) {
          found = true;
          ring.push(vertex);
        }
      });
      return ring;
    },
    false,
  );
  return found && result ? { piece: result, vertex } : null;
}

const centreOf = (points: Vec3[]): Vec3 => [0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length) as Vec3;

/** Los vértices elegidos puestos en orden alrededor de su centro, en un plano que se ajusta a ellos. */
function ringAround(points: Vec3[]): Vec3[] {
  const c = centreOf(points);
  const rel = points.map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]] as Vec3);
  // Normal: el mayor producto vectorial entre dos vértices.
  let best: Vec3 = [0, 0, 0];
  for (const u of rel) {
    for (const v of rel) {
      const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (Math.hypot(...n) > Math.hypot(...best)) best = n;
    }
  }
  const length = Math.hypot(...best);
  if (length < 1e-9) return [];
  const n: Vec3 = [best[0] / length, best[1] / length, best[2] / length];
  const first = rel.find((r) => Math.hypot(...r) > 1e-9)!;
  const fl = Math.hypot(...first);
  const u: Vec3 = [first[0] / fl, first[1] / fl, first[2] / fl];
  const w: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const angle = (r: Vec3): number => Math.atan2(r[0] * w[0] + r[1] * w[1] + r[2] * w[2], r[0] * u[0] + r[1] * u[1] + r[2] * u[2]);
  return points
    .map((p, i) => ({ p, a: angle(rel[i]) }))
    .sort((x, y) => x.a - y.a)
    .map((o) => o.p);
}

/** Copia de `source` con otras caras, colores y texturas, conservando grupo, nombre de grupo y capa. */
function withFaces(source: Piece, faces: Vec3[][], colors: number[], textures: (FaceTexture | null)[], flags: number[]): Piece {
  const result = makePiece(faces, source.color, colors, source.faceTextures ? textures : undefined, flags);
  if (source.group !== undefined) result.group = source.group;
  if (source.groupName) result.groupName = source.groupName;
  if (source.layer !== undefined) result.layer = source.layer;
  return result;
}

/**
 * Crea una cara con los vértices elegidos (tres o más), puestos en orden alrededor de su centro y con la normal hacia fuera de la pieza.
 * Devuelve null si hay menos de tres, si no forman una superficie o si ya existe una cara con esos vértices.
 */
export function addFace(piece: Piece, keys: ReadonlySet<string>): Piece | null {
  const chosen = uniqueVertices(piece).filter((p) => keys.has(vertexKey(p)));
  if (chosen.length < 3) return null;
  let ring = ringAround(chosen);
  if (ring.length < 3) return null;
  const middle = centreOf(uniqueVertices(piece));
  const centre = centreOf(ring);
  const n = faceNormal(ring);
  if (n[0] * (centre[0] - middle[0]) + n[1] * (centre[1] - middle[1]) + n[2] * (centre[2] - middle[2]) < 0) ring = [...ring].reverse();
  const wanted = chosen.map(vertexKey).sort().join('|');
  if (piece.faces.some((face) => [...new Set(face.map(vertexKey))].sort().join('|') === wanted)) return null;
  return withFaces(
    piece,
    [...piece.faces, ring],
    [...piece.faces.map((_, i) => piece.faceColors?.[i] ?? piece.color), piece.color],
    [...(piece.faceTextures ?? piece.faces.map(() => null)), null],
    [...piece.faces.map((_, i) => piece.faceFlags?.[i] ?? 0), 0],
  );
}

/**
 * Extruye las caras indicadas `distance` celdas a lo largo de su normal: la cara sube con copias de sus vértices y se cierran las paredes
 * por el borde. Devuelve la pieza y las claves de los vértices nuevos (para seguir moviéndolos).
 */
export function extrudeFaces(piece: Piece, indices: ReadonlySet<number>, distance: number): { piece: Piece; keys: Set<string> } | null {
  const chosen = [...indices].filter((i) => piece.faces[i]);
  if (chosen.length === 0 || Math.abs(distance) < 1e-9) return null;
  // Desplazamiento de cada vértice: la media de las normales de las caras elegidas que lo usan.
  const sums = new Map<string, Vec3>();
  const counts = new Map<string, number>();
  for (const i of chosen) {
    const n = faceNormal(piece.faces[i]);
    const length = Math.hypot(...n) || 1;
    for (const p of piece.faces[i]) {
      const key = vertexKey(p);
      const sum = sums.get(key) ?? [0, 0, 0];
      sums.set(key, [sum[0] + n[0] / length, sum[1] + n[1] / length, sum[2] + n[2] / length]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const lift = (p: Vec3): Vec3 => {
    const key = vertexKey(p);
    const sum = sums.get(key)!;
    const count = counts.get(key)!;
    return [p[0] + (sum[0] / count) * distance, p[1] + (sum[1] / count) * distance, p[2] + (sum[2] / count) * distance];
  };
  const faces: Vec3[][] = [];
  const colors: number[] = [];
  const textures: (FaceTexture | null)[] = [];
  const flags: number[] = [];
  const keys = new Set<string>();
  piece.faces.forEach((face, i) => {
    colors.push(piece.faceColors?.[i] ?? piece.color);
    flags.push(piece.faceFlags?.[i] ?? 0);
    const texture = piece.faceTextures?.[i] ?? null;
    if (!indices.has(i)) {
      faces.push(face);
      textures.push(texture);
      return;
    }
    const top = face.map(lift);
    for (const p of top) keys.add(vertexKey(p));
    faces.push(top);
    textures.push(texture ? remapTexture(texture, face, top, (p) => p) : null);
  });
  // Las paredes salen de las aristas que solo usa una de las caras elegidas.
  const edgeKey = (a: Vec3, b: Vec3): string => [vertexKey(a), vertexKey(b)].sort().join('>');
  const uses = new Map<string, number>();
  for (const i of chosen) {
    const face = piece.faces[i];
    face.forEach((p, k) => {
      const key = edgeKey(p, face[(k + 1) % face.length]);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    });
  }
  for (const i of chosen) {
    const face = piece.faces[i];
    face.forEach((a, k) => {
      const b = face[(k + 1) % face.length];
      if (uses.get(edgeKey(a, b)) !== 1) return;
      faces.push([a, b, lift(b), lift(a)]);
      colors.push(piece.faceColors?.[i] ?? piece.color);
      // Las paredes heredan las propiedades de la cara que se extruye.
      flags.push(piece.faceFlags?.[i] ?? 0);
      textures.push(null);
    });
  }
  return { piece: withFaces(piece, faces, colors, textures, flags), keys };
}

/** Pone o quita propiedades (bits de `FACE_DOUBLE` y `FACE_UNLIT`) en las caras indicadas. */
export function setFaceFlags(piece: Piece, indices: ReadonlySet<number>, flag: number, on: boolean): Piece | null {
  if (indices.size === 0 || ![...indices].some((i) => piece.faces[i])) return null;
  const flags = piece.faces.map((_, i) => {
    const current = piece.faceFlags?.[i] ?? 0;
    if (!indices.has(i)) return current;
    return on ? current | flag : current & ~flag;
  });
  if (flags.every((f, i) => f === (piece.faceFlags?.[i] ?? 0))) return null;
  const result = makePiece(piece.faces, piece.color, piece.faceColors, piece.faceTextures, flags);
  if (piece.group !== undefined) result.group = piece.group;
  if (piece.groupName) result.groupName = piece.groupName;
  if (piece.layer !== undefined) result.layer = piece.layer;
  return result;
}
