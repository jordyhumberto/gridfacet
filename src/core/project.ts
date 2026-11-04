import { parseAnimation, type Animation } from './animation';
import { isConvex } from './convex';
import type { Layer } from './layers';
import { makePiece, volume, type Piece, type Vec3 } from './piece';
import { packTexture, unpackTexture, type PackedTexture } from './texture';

/** Las capas guardadas con el proyecto. */
export interface LayerState {
  layers: Layer[];
  active: number;
}

const FORMAT = 'gridfacet';
/** Nombres que tuvo el formato antes de llamarse Gridfacet (Novoxel y Polygrid): los proyectos guardados así se siguen abriendo. */
const LEGACY_FORMATS = ['polygrid', 'novoxel'];
const VERSION = 1;

interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  pieces: { color: number; faces: Vec3[][]; faceColors?: number[]; faceTextures?: (PackedTexture | null)[]; faceFlags?: number[]; group?: number; groupName?: string; layer?: number }[];
  /** Capas (opcional: los proyectos antiguos tienen solo la primera). */
  layers?: LayerState;
  /** Puntos de referencia (opcional: los proyectos antiguos no lo tienen). */
  marks?: Vec3[];
  /** Celdas por lado de la sala (opcional: los proyectos antiguos no lo guardan). */
  gridSize?: number;
  /** Animación de los grupos (opcional: los proyectos antiguos no la tienen). */
  animation?: Animation;
}

export function serializeProject(pieces: Piece[], marks: Vec3[] = [], gridSize?: number, layers?: LayerState, animation?: Animation): string {
  const project: ProjectFile = {
    format: FORMAT,
    version: VERSION,
    pieces: pieces.map(({ color, faces, faceColors, faceTextures, faceFlags, group, groupName, layer }) => ({
      color,
      faces,
      ...(faceColors ? { faceColors } : {}),
      ...(faceTextures ? { faceTextures: faceTextures.map((t) => (t ? packTexture(t) : null)) } : {}),
      ...(faceFlags ? { faceFlags } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(group !== undefined && groupName ? { groupName } : {}),
      ...(layer !== undefined && layer !== 1 ? { layer } : {}),
    })),
    ...(layers && (layers.layers.length > 1 || layers.layers.some((l) => l.hidden || l.locked) || layers.layers[0]?.name !== 'Capa 1') ? { layers } : {}),
    ...(marks.length > 0 ? { marks } : {}),
    ...(gridSize !== undefined ? { gridSize } : {}),
    ...(animation && animation.tracks.length > 0 ? { animation } : {}),
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
export function parseProjectFull(text: string): { pieces: Piece[]; marks: Vec3[]; gridSize?: number; layers?: Partial<LayerState>; animation?: Animation } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido');
  }

  const file = data as Partial<ProjectFile> | null;
  if (!file || (file.format !== FORMAT && !LEGACY_FORMATS.includes(String(file.format)))) throw new Error('El archivo no es un proyecto de Gridfacet');
  if (typeof file.version !== 'number' || file.version > VERSION) {
    throw new Error('El proyecto es de una versión más nueva de Gridfacet');
  }
  if (!Array.isArray(file.pieces)) throw new Error('El proyecto no contiene piezas');

  const pieces = file.pieces.map((raw, i) => {
    const label = `Pieza ${i + 1}`;
    const { color, faces, faceColors, faceTextures, faceFlags, group, groupName, layer } = raw ?? {};
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff) throw new Error(`${label}: color no válido`);
    if (!Array.isArray(faces) || faces.length < 1) throw new Error(`${label}: le faltan caras`);
    if (!faces.every((f) => Array.isArray(f) && f.length >= 3 && f.every(isVec3))) {
      throw new Error(`${label}: tiene caras no válidas`);
    }
    const validColor = (c: unknown): boolean => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 0xffffff;
    const painted = Array.isArray(faceColors) && faceColors.length === faces.length && faceColors.every(validColor) ? faceColors : undefined;
    // Las texturas dañadas se descartan sin tirar el proyecto: la cara conserva su color.
    const textures = Array.isArray(faceTextures) && faceTextures.length === faces.length ? faceTextures.map((t) => unpackTexture(t)) : undefined;
    const flags = Array.isArray(faceFlags) && faceFlags.length === faces.length && faceFlags.every((f) => Number.isInteger(f) && f >= 0 && f <= 3) ? faceFlags : undefined;
    const piece = makePiece(faces, color, painted, textures, flags);
    if (Number.isInteger(group) && (group as number) > 0) {
      piece.group = group as number;
      if (typeof groupName === 'string' && groupName.trim()) piece.groupName = groupName.trim().slice(0, 60);
    }
    if (Number.isInteger(layer) && (layer as number) > 1) piece.layer = layer as number;
    // Un sólido cerrado y convexo tiene que encerrar volumen; las mallas libres (abiertas, de una cara o torcidas) no lo exigen.
    if (faces.length >= 4 && isConvex(piece) && !(volume(piece) > 1e-9)) throw new Error(`${label}: no encierra volumen`);
    return piece;
  });
  const marks = Array.isArray(file.marks) ? file.marks.filter(isVec3) : [];
  const gridSize = Number.isInteger(file.gridSize) && file.gridSize! >= 2 && file.gridSize! <= 1024 ? file.gridSize : undefined;
  const layers = file.layers && Array.isArray(file.layers.layers) ? file.layers : undefined;
  const animation = file.animation ? parseAnimation(file.animation) : undefined;
  return { pieces, marks, ...(gridSize !== undefined ? { gridSize } : {}), ...(layers ? { layers } : {}), ...(animation ? { animation } : {}) };
}
