import { makePiece, type Piece, type Vec3 } from './piece';
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
  piece.faces.forEach((face, i) => {
    const next = mapFace(face, i);
    if (!next || next.length < 3) return;
    faces.push(next);
    colors.push(piece.faceColors?.[i] ?? piece.color);
    const texture = piece.faceTextures?.[i];
    const moved = next.length !== face.length || next.some((p, k) => !same(p, face[k]));
    textures.push(texture ? (moved ? remapTexture(texture, face, next, (p) => p) : texture) : null);
  });
  if (faces.length === 0) return null;
  const result = makePiece(faces, piece.color, colors, piece.faceTextures ? textures : undefined);
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
