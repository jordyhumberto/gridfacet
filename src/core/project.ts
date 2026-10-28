import { makePiece, volume, type Piece, type Vec3 } from './piece';

const FORMAT = 'novoxel';
const VERSION = 1;

interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  pieces: { color: number; faces: Vec3[][]; faceColors?: number[]; group?: number; groupName?: string }[];
  /** Puntos de referencia (opcional: los proyectos antiguos no lo tienen). */
  marks?: Vec3[];
  /** Celdas por lado de la sala (opcional: los proyectos antiguos no lo guardan). */
  gridSize?: number;
}

export function serializeProject(pieces: Piece[], marks: Vec3[] = [], gridSize?: number): string {
  const project: ProjectFile = {
    format: FORMAT,
    version: VERSION,
    pieces: pieces.map(({ color, faces, faceColors, group, groupName }) => ({
      color,
      faces,
      ...(faceColors ? { faceColors } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(group !== undefined && groupName ? { groupName } : {}),
    })),
    ...(marks.length > 0 ? { marks } : {}),
    ...(gridSize !== undefined ? { gridSize } : {}),
  };
  return JSON.stringify(project);
}

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Lee un proyecto guardado. Lanza un Error con un mensaje legible si el archivo no es válido. */
export function parseProject(text: string): Piece[] {
  return parseProjectFull(text).pieces;
}

/** Como `parseProject`, pero devuelve también los puntos de referencia. */
export function parseProjectFull(text: string): { pieces: Piece[]; marks: Vec3[]; gridSize?: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido');
  }

  const file = data as Partial<ProjectFile> | null;
  if (!file || file.format !== FORMAT) throw new Error('El archivo no es un proyecto de Novoxel');
  if (typeof file.version !== 'number' || file.version > VERSION) {
    throw new Error('El proyecto es de una versión más nueva de Novoxel');
  }
  if (!Array.isArray(file.pieces)) throw new Error('El proyecto no contiene piezas');

  const pieces = file.pieces.map((raw, i) => {
    const label = `Pieza ${i + 1}`;
    const { color, faces, faceColors, group, groupName } = raw ?? {};
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff) throw new Error(`${label}: color no válido`);
    if (!Array.isArray(faces) || faces.length < 4) throw new Error(`${label}: le faltan caras`);
    if (!faces.every((f) => Array.isArray(f) && f.length >= 3 && f.every(isVec3))) {
      throw new Error(`${label}: tiene caras no válidas`);
    }
    const validColor = (c: unknown): boolean => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 0xffffff;
    const painted = Array.isArray(faceColors) && faceColors.length === faces.length && faceColors.every(validColor) ? faceColors : undefined;
    const piece = makePiece(faces, color, painted);
    if (Number.isInteger(group) && (group as number) > 0) {
      piece.group = group as number;
      if (typeof groupName === 'string' && groupName.trim()) piece.groupName = groupName.trim().slice(0, 60);
    }
    if (!(volume(piece) > 1e-9)) throw new Error(`${label}: no encierra volumen`);
    return piece;
  });
  const marks = Array.isArray(file.marks) ? file.marks.filter(isVec3) : [];
  const gridSize = Number.isInteger(file.gridSize) && file.gridSize! >= 2 && file.gridSize! <= 1024 ? file.gridSize : undefined;
  return { pieces, marks, ...(gridSize !== undefined ? { gridSize } : {}) };
}
