import { FACE_DOUBLE, faceNormal, makePiece, type Piece, type Vec3 } from './piece';
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
    // Dos vértices seguidos en el mismo sitio (al llevar uno encima de otro) dejan una arista de largo cero que bloquea añadir vértices en la cara: se juntan.
    const mapped = mapFace(face, i);
    const next = mapped && withoutRepeats(mapped);
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

/** La cara sin vértices consecutivos repetidos (puede quedar con menos de tres). */
export function withoutRepeats(face: Vec3[]): Vec3[] {
  const ring = face.filter((p, i) => !same(p, face[(i + 1) % face.length]));
  return ring.length === face.length ? face : ring;
}

/** La pieza sin vértices repetidos en sus caras (las caras que se quedan sin superficie se quitan); la misma pieza si no había ninguno. */
export function cleanRepeats(piece: Piece): Piece {
  if (piece.faces.every((face) => withoutRepeats(face) === face)) return piece;
  return rebuild(piece, (face) => face, true) ?? piece;
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

/**
 * Pone un vértice nuevo dentro de una cara, en el punto dado (se proyecta sobre su plano). La cara se parte en triángulos que salen del vértice,
 * cada uno con el color, las propiedades y los píxeles de la cara original. Devuelve null si el punto cae sobre una arista o un vértice
 * (ahí sale una cara sin superficie) o la cara no tiene plano.
 */
export function addVertexOnFace(piece: Piece, faceIndex: number, point: Vec3): { piece: Piece; vertex: Vec3 } | null {
  if (!piece.faces[faceIndex]) return null;
  // Una cara con un vértice repetido tiene una arista de largo cero: se trabaja sobre la cara sin él.
  const face = withoutRepeats(piece.faces[faceIndex]);
  if (face.length < 3) return null;
  const n = faceNormal(face);
  const length = Math.hypot(...n);
  if (length < 1e-12) return null;
  const unit: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
  const off = (point[0] - face[0][0]) * unit[0] + (point[1] - face[0][1]) * unit[1] + (point[2] - face[0][2]) * unit[2];
  const vertex: Vec3 = [point[0] - unit[0] * off, point[1] - unit[1] * off, point[2] - unit[2] * off];
  // Cada triángulo del abanico tiene que tener superficie: el punto no puede estar casi sobre ninguna arista de la cara.
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    const e: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w: Vec3 = [vertex[0] - a[0], vertex[1] - a[1], vertex[2] - a[2]];
    const cross: Vec3 = [e[1] * w[2] - e[2] * w[1], e[2] * w[0] - e[0] * w[2], e[0] * w[1] - e[1] * w[0]];
    const distance = Math.hypot(...cross) / (Math.hypot(...e) || 1);
    // Dentro de la cara, el punto queda a la izquierda de cada arista (mismo sentido que la normal).
    if (distance < 0.02 || cross[0] * unit[0] + cross[1] * unit[1] + cross[2] * unit[2] <= 0) return null;
  }
  return { piece: replaceFace(piece, faceIndex, face.map((p, k) => [p, face[(k + 1) % face.length], vertex] as Vec3[])), vertex };
}

/** La pieza con la cara `faceIndex` cambiada por estas caras nuevas, cada una con el color, las propiedades y los píxeles de la original. */
function replaceFace(piece: Piece, faceIndex: number, parts: Vec3[][]): Piece {
  const faces: Vec3[][] = [];
  const colors: number[] = [];
  const textures: (FaceTexture | null)[] = [];
  const flags: number[] = [];
  piece.faces.forEach((original, i) => {
    for (const next of i === faceIndex ? parts : [original]) {
      faces.push(next);
      colors.push(piece.faceColors?.[i] ?? piece.color);
      flags.push(piece.faceFlags?.[i] ?? 0);
      const texture = piece.faceTextures?.[i] ?? null;
      textures.push(texture ? (i === faceIndex ? remapTexture(texture, original, next, (p) => p) : texture) : null);
    }
  });
  const result = makePiece(faces, piece.color, colors, piece.faceTextures ? textures : undefined, flags);
  if (piece.group !== undefined) result.group = piece.group;
  if (piece.groupName) result.groupName = piece.groupName;
  if (piece.layer !== undefined) result.layer = piece.layer;
  return result;
}

/**
 * Pone dos vértices espejo (`point` y su imagen por `mirror`) dentro de una cara que es su propia imagen en el espejo, partiéndola de forma simétrica:
 * un abanico de triángulos a cada lado y dos cuadriláteros entre los dos puntos. Partir la cara punto por punto dejaría las conexiones de uno distintas
 * a las del otro y al deformar saldría ladeada. Null si la cara no es simétrica, tiene vértices sobre el plano o los puntos no caben dentro.
 */
export function addMirrorPairOnFace(piece: Piece, faceIndex: number, point: Vec3, mirror: (p: Vec3) => Vec3): { piece: Piece; vertex: Vec3; mirrorVertex: Vec3 } | null {
  const face = piece.faces[faceIndex] && withoutRepeats(piece.faces[faceIndex]);
  if (!face || face.length < 3) return null;
  const n = faceNormal(face);
  const length = Math.hypot(...n);
  if (length < 1e-12) return null;
  const unit: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
  const onFace = (q: Vec3): Vec3 => {
    const off = (q[0] - face[0][0]) * unit[0] + (q[1] - face[0][1]) * unit[1] + (q[2] - face[0][2]) * unit[2];
    return [q[0] - unit[0] * off, q[1] - unit[1] * off, q[2] - unit[2] * off];
  };
  const a = onFace(point);
  const b = onFace(mirror(a));
  const apart: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  if (Math.hypot(...apart) < 0.04) return null;
  // Los dos puntos tienen que quedar dentro de la cara, lejos de sus aristas.
  for (const q of [a, b]) {
    for (let i = 0; i < face.length; i++) {
      const p = face[i];
      const r = face[(i + 1) % face.length];
      const e: Vec3 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const w: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const cross: Vec3 = [e[1] * w[2] - e[2] * w[1], e[2] * w[0] - e[0] * w[2], e[0] * w[1] - e[1] * w[0]];
      if (Math.hypot(...cross) / (Math.hypot(...e) || 1) < 0.02 || cross[0] * unit[0] + cross[1] * unit[1] + cross[2] * unit[2] <= 0) return null;
    }
  }
  // De qué lado del plano cae cada vértice de la cara: tiene que haber un tramo seguido a cada lado y ninguno sobre el plano.
  const side = face.map((p) => {
    const m = mirror(p);
    const s = (p[0] - m[0]) * apart[0] + (p[1] - m[1]) * apart[1] + (p[2] - m[2]) * apart[2];
    return Math.abs(s) < 1e-6 ? 0 : s > 0 ? 1 : -1;
  });
  if (side.includes(0)) return null;
  const start = side.findIndex((s, i) => s === 1 && side[(i + side.length - 1) % side.length] === -1);
  if (start < 0) return null;
  const ring = face.map((_, i) => (start + i) % face.length);
  const left = ring.filter((i) => side[i] === 1);
  if (!left.every((_, k) => ring[k] === left[k])) return null;
  const right = ring.slice(left.length);
  if (right.length !== left.length || right.some((i) => side[i] !== -1)) return null;
  // Cada pieza de un lado se corresponde con la del otro, así que la partición es simétrica.
  const parts: Vec3[][] = [];
  for (let k = 0; k + 1 < left.length; k++) parts.push([face[left[k]], face[left[k + 1]], a]);
  for (let k = 0; k + 1 < right.length; k++) parts.push([face[right[k]], face[right[k + 1]], b]);
  parts.push([face[left[left.length - 1]], face[right[0]], b, a]);
  parts.push([face[right[right.length - 1]], face[left[0]], a, b]);
  // Todas tienen que mirar al mismo lado que la cara original (si no, los cuadriláteros se cruzarían).
  for (const part of parts) {
    const pn = faceNormal(part);
    if (pn[0] * unit[0] + pn[1] * unit[1] + pn[2] * unit[2] <= 1e-9) return null;
  }
  return { piece: replaceFace(piece, faceIndex, parts), vertex: a, mirrorVertex: b };
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

/** Gira un punto `angle` radianes alrededor del eje `axis` (unitario) que pasa por `pivot`, con la regla de la mano derecha. */
export function rotateAbout(p: Vec3, pivot: Vec3, axis: Vec3, angle: number): Vec3 {
  const v: Vec3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  const cross: Vec3 = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
  return [0, 1, 2].map((k) => pivot[k] + v[k] * cos + cross[k] * sin + axis[k] * dot * (1 - cos)) as Vec3;
}

/** Escala un punto respecto a `pivot`, con un factor por eje. */
export function scaleAbout(p: Vec3, pivot: Vec3, factors: Vec3): Vec3 {
  return [0, 1, 2].map((k) => pivot[k] + (p[k] - pivot[k]) * factors[k]) as Vec3;
}

/** Posición (de −1 a 1) de un punto a lo largo de `axis`, medida desde `pivot` en unidades de la mitad del largo `half`. */
const along = (p: Vec3, pivot: Vec3, axis: number, half: number): number => (p[axis] - pivot[axis]) / half;

/**
 * Afina (o ensancha) una forma a lo largo de un eje: la sección en el centro no cambia y en cada extremo se escala `1 + amount`
 * (positivo ensancha el extremo de arriba y estrecha el de abajo; negativo al revés).
 */
export function taperPoint(p: Vec3, pivot: Vec3, axis: number, half: number, amount: number): Vec3 {
  const factor = Math.max(1 + amount * along(p, pivot, axis, half), 0);
  return [0, 1, 2].map((k) => (k === axis ? p[k] : pivot[k] + (p[k] - pivot[k]) * factor)) as Vec3;
}

/** Tuerce una forma a lo largo de un eje: cada sección gira alrededor del eje según su altura (`amount` × 180° en cada extremo, en sentidos opuestos). */
export function twistPoint(p: Vec3, pivot: Vec3, axis: number, half: number, amount: number): Vec3 {
  const unit: Vec3 = [0, 1, 2].map((k) => (k === axis ? 1 : 0)) as Vec3;
  // El giro es alrededor del eje que pasa por el pivote, a la altura del propio punto.
  const centre = [0, 1, 2].map((k) => (k === axis ? p[k] : pivot[k])) as Vec3;
  return rotateAbout(p, centre, unit, amount * Math.PI * along(p, pivot, axis, half));
}

/**
 * Curva una forma a lo largo de `axis`: el eje se dobla en un arco hacia el eje siguiente (X→Y, Y→Z, Z→X). `amount` es el ángulo
 * que se dobla cada extremo, en múltiplos de 90°; la sección en el centro no se mueve y las distancias al eje se conservan.
 */
export function bendPoint(p: Vec3, pivot: Vec3, axis: number, half: number, amount: number): Vec3 {
  const kappa = (amount * Math.PI) / 2 / half;
  if (Math.abs(kappa) < 1e-9) return p;
  const side = (axis + 1) % 3;
  const s = p[axis] - pivot[axis];
  const b = p[side] - pivot[side];
  const radius = 1 / kappa;
  const phi = s * kappa;
  const rho = radius - b;
  const out: Vec3 = [p[0], p[1], p[2]];
  out[axis] = pivot[axis] + rho * Math.sin(phi);
  out[side] = pivot[side] + radius - rho * Math.cos(phi);
  return out;
}

/**
 * Las caras (por su posición en `piece`) de los vértices nuevos (que no estaban en `before`) que tocan solo dos caras y quedan fuera del plano de las dos:
 * un punto sacado de una arista. Esas dos caras acaban incluyendo el mismo triángulo y quedan como una aleta plana sin volumen.
 */
export function finFaces(piece: Piece, before: Piece): { faces: Set<number>; count: number } {
  const known = new Set(uniqueVertices(before).map(vertexKey));
  const touching = new Map<string, number[]>();
  piece.faces.forEach((face, i) => {
    for (const p of face) {
      const key = vertexKey(p);
      if (known.has(key)) continue;
      const list = touching.get(key) ?? [];
      if (!list.includes(i)) list.push(i);
      touching.set(key, list);
    }
  });
  const flagged = new Set<number>();
  let count = 0;
  for (const [key, faces] of touching) {
    if (faces.length !== 2) continue;
    // Basta con salir del plano de una de las dos: si se queda en el de la otra (un jalón solo en X por la tapa, por ejemplo), la cara lateral
    // dibuja el mismo triángulo que la tapa y la punta es una lámina plana igualmente.
    const off = faces.some((i) => {
      const face = piece.faces[i];
      const rest = face.filter((p) => vertexKey(p) !== key);
      if (rest.length < 3) return false;
      const n = faceNormal(rest);
      const length = Math.hypot(n[0], n[1], n[2]);
      if (length < 1e-9) return false;
      const p = face.find((q) => vertexKey(q) === key)!;
      return Math.abs(n[0] * (p[0] - rest[0][0]) + n[1] * (p[1] - rest[0][1]) + n[2] * (p[2] - rest[0][2])) / length > 0.02;
    });
    if (!off) continue;
    count++;
    for (const i of faces) flagged.add(i);
  }
  return { faces: flagged, count };
}

/** Las caras de un punto de arista sacado fuera de sus planos pasan a «Doble cara» (se ven por los dos lados). */
export function flagFins(piece: Piece, before: Piece): { piece: Piece; count: number } {
  const { faces, count } = finFaces(piece, before);
  if (count === 0) return { piece, count: 0 };
  return { piece: setFaceFlags(piece, faces, FACE_DOUBLE, true) ?? piece, count };
}

/**
 * Pone un vértice en el centro de cada una de las caras indicadas (por su posición en `piece`), que se parten en triángulos que salen de él.
 * Así un punto de arista que se saque levanta las dos caras como una tienda de campaña y entre ellas queda volumen. Null si no cabe ninguno.
 */
export function splitFacesAtCenter(piece: Piece, faces: ReadonlySet<number>): Piece | null {
  let current = piece;
  let any = false;
  // De la última a la primera: partir una cara solo desplaza a las que van detrás.
  for (const i of [...faces].sort((a, b) => b - a)) {
    const face = piece.faces[i];
    if (!face) continue;
    const centre: Vec3 = [0, 1, 2].map((k) => face.reduce((sum, p) => sum + p[k], 0) / face.length) as Vec3;
    const result = addVertexOnFace(current, i, centre);
    if (!result) continue;
    current = { ...result.piece, id: piece.id };
    any = true;
  }
  return any ? current : null;
}
