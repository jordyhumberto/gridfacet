export type Vec3 = [number, number, number];

/** Poliedro convexo: cada cara es un polígono con vértices en sentido antihorario visto desde fuera. */
export interface Piece {
  id: number;
  faces: Vec3[][];
  color: number;
  /** Color de cada cara cuando no todas llevan el de la pieza; mismo orden que `faces`. */
  faceColors?: number[];
  /** Número de grupo: las piezas con el mismo se eligen y mueven juntas. */
  group?: number;
  /** Nombre del grupo (el mismo en todas sus piezas); sirve para nombrar los objetos del GLB. */
  groupName?: string;
}

let nextGroup = 1;
export const newGroupId = (): number => nextGroup++;

/** Copia de `piece` con otro grupo (o sin grupo si `group` es undefined) y un id nuevo. */
export function withGroup(piece: Piece, group: number | undefined, groupName?: string): Piece {
  const copy = makePiece(piece.faces, piece.color, piece.faceColors);
  if (group !== undefined) {
    copy.group = group;
    if (groupName) copy.groupName = groupName;
  }
  return copy;
}

/** Pasa a `to` el grupo de `from`, para las operaciones que reemplazan una pieza por una derivada. */
export function keepGroup(to: Piece, from: Piece): Piece {
  if (from.group !== undefined) to.group = from.group;
  if (from.groupName) to.groupName = from.groupName;
  return to;
}

/** Color de una cara: el propio si está pintada, si no el de la pieza. */
export function faceColorOf(piece: Piece, index: number): number {
  return piece.faceColors?.[index] ?? piece.color;
}

/** Guarda los colores por cara solo si alguno difiere del de la pieza. */
function normalizeFaceColors(color: number, faceColors: number[] | undefined): number[] | undefined {
  return faceColors && faceColors.some((c) => c !== color) ? faceColors : undefined;
}

export interface Plane {
  n: Vec3;
  d: number;
}

const EPS = 1e-9;
const WELD = 1e-7;

let nextId = 1;

export function makePiece(faces: Vec3[][], color: number, faceColors?: number[]): Piece {
  const piece: Piece = { id: nextId++, faces, color };
  const painted = normalizeFaceColors(color, faceColors);
  if (painted) piece.faceColors = painted;
  return piece;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Normal de una cara (método de Newell, sin normalizar). */
export function faceNormal(face: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/** Plano que pasa por tres puntos; la normal sigue la regla de la mano derecha (b-a)×(c-a). */
export function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): Plane {
  const n = norm(cross(sub(b, a), sub(c, a)));
  return { n, d: dot(n, a) };
}

export function volume(piece: Piece): number {
  let v = 0;
  for (const face of piece.faces) {
    for (let i = 1; i < face.length - 1; i++) {
      v += dot(face[0], cross(face[i], face[i + 1])) / 6;
    }
  }
  return v;
}

/**
 * Recorta la pieza conservando el lado donde n·p <= d.
 * Devuelve null si no queda volumen. Al cortar un poliedro convexo el resultado sigue siendo convexo.
 */
export function clipPiece(piece: Piece, plane: Plane): Piece | null {
  const { n, d } = plane;
  const side = (p: Vec3) => dot(n, p) - d;
  const faces: Vec3[][] = [];
  const colors: number[] = [];
  const cut: Vec3[] = [];

  piece.faces.forEach((face, faceIndex) => {
    const paint = faceColorOf(piece, faceIndex);
    const dists = face.map(side);
    if (dists.every((s) => Math.abs(s) <= EPS)) {
      // La cara descansa sobre el plano: la tapa se regenera abajo, así que no se duplica.
      if (dot(faceNormal(face), n) > 0) return;
      faces.push(face);
      colors.push(paint);
      return;
    }

    const out: Vec3[] = [];
    for (let i = 0; i < face.length; i++) {
      const cur = face[i];
      const nxt = face[(i + 1) % face.length];
      const sc = dists[i];
      const sn = dists[(i + 1) % face.length];
      if (sc <= EPS) out.push(cur);
      if (Math.abs(sc) <= EPS) cut.push(cur);
      if ((sc < -EPS && sn > EPS) || (sc > EPS && sn < -EPS)) {
        const t = sc / (sc - sn);
        const ip: Vec3 = [
          cur[0] + (nxt[0] - cur[0]) * t,
          cur[1] + (nxt[1] - cur[1]) * t,
          cur[2] + (nxt[2] - cur[2]) * t,
        ];
        out.push(ip);
        cut.push(ip);
      }
    }
    const clean = dedupeRing(out);
    if (clean.length >= 3) {
      faces.push(clean);
      colors.push(paint);
    }
  });

  const cap = buildCap(cut, n);
  if (cap) {
    faces.push(cap);
    colors.push(piece.color);
  }

  const result = keepGroup(makePiece(faces, piece.color, colors), piece);
  return volume(result) > 1e-9 ? result : null;
}

function dedupeRing(points: Vec3[]): Vec3[] {
  const res: Vec3[] = [];
  for (const p of points) {
    const last = res[res.length - 1];
    if (!last || len(sub(p, last)) > WELD) res.push(p);
  }
  while (res.length > 1 && len(sub(res[0], res[res.length - 1])) <= WELD) res.pop();
  return res;
}

function buildCap(points: Vec3[], n: Vec3): Vec3[] | null {
  const unique: Vec3[] = [];
  for (const p of points) {
    if (!unique.some((q) => len(sub(p, q)) <= WELD)) unique.push(p);
  }
  if (unique.length < 3) return null;

  const c: Vec3 = [0, 0, 0];
  for (const p of unique) {
    c[0] += p[0] / unique.length;
    c[1] += p[1] / unique.length;
    c[2] += p[2] / unique.length;
  }
  const u = norm(sub(unique[0], c));
  const v = cross(n, u);
  const angle = (p: Vec3) => {
    const r = sub(p, c);
    return Math.atan2(dot(r, v), dot(r, u));
  };
  return unique.sort((a, b) => angle(a) - angle(b));
}
