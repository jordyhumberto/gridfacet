import { parseAnimation, type Animation } from './animation';
import { isConvex } from './convex';
import type { Layer } from './layers';
import { makePiece, volume, type Piece, type PieceSegment, type Vec3 } from './piece';
import { parseReferences, type RefImage } from './references';
import { canonPiece, cleanRepeats } from './vertices';
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
  pieces: { color: number; faces: Vec3[][]; faceColors?: number[]; faceTextures?: (PackedTexture | null)[]; faceFlags?: number[]; segments?: PieceSegment[]; group?: number; groupName?: string; layer?: number }[];
  /** Capas (opcional: los proyectos antiguos tienen solo la primera). */
  layers?: LayerState;
  /** Puntos de referencia (opcional: los proyectos antiguos no lo tienen). */
  marks?: Vec3[];
  /** Celdas por lado de la sala (opcional: los proyectos antiguos no lo guardan). */
  gridSize?: number;
  /** Animación de los grupos (opcional: los proyectos antiguos no la tienen). */
  animation?: Animation;
  /** Imágenes de referencia al fondo de la escena (opcional). */
  references?: RefImage[];
}

export function serializeProject(pieces: Piece[], marks: Vec3[] = [], gridSize?: number, layers?: LayerState, animation?: Animation, references: RefImage[] = []): string {
  const project: ProjectFile = {
    format: FORMAT,
    version: VERSION,
    pieces: pieces.map(({ color, faces, faceColors, faceTextures, faceFlags, segments, group, groupName, layer }) => ({
      color,
      faces,
      ...(segments && segments.length > 0 ? { segments } : {}),
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
    ...(references.length > 0 ? { references } : {}),
  };
  return JSON.stringify(project);
}

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Lo que no se pudo leer de un archivo dañado y se dejó fuera para cargar el resto. */
export interface Discarded {
  pieces: number;
  faces: number;
  /** Segmentos sueltos dañados. */
  segments: number;
}

/** Frase para la barra de estado con lo que se dejó fuera al abrir; vacía si no se descartó nada. */
export function describeDiscarded({ pieces, faces, segments }: Discarded): string {
  const parts: string[] = [];
  if (pieces > 0) parts.push(`${pieces} ${pieces === 1 ? 'pieza dañada' : 'piezas dañadas'}`);
  if (faces > 0) parts.push(`${faces} ${faces === 1 ? 'cara dañada' : 'caras dañadas'}`);
  if (segments > 0) parts.push(`${segments} ${segments === 1 ? 'segmento dañado' : 'segmentos dañados'}`);
  return parts.length > 0 ? `Se descartaron ${parts.join(' y ')} del archivo` : '';
}

/** Lee un proyecto guardado. Lanza un Error con un mensaje legible si el archivo no es válido. */
export function parseProject(text: string): Piece[] {
  return parseProjectFull(text).pieces;
}

/** Como `parseProject`, pero devuelve también los puntos de referencia. */
export function parseProjectFull(text: string): { pieces: Piece[]; marks: Vec3[]; gridSize?: number; layers?: Partial<LayerState>; animation?: Animation; references: RefImage[]; discarded: Discarded } {
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

  // Una pieza o una cara dañada no tira el archivo entero: se deja fuera, se cuenta y se carga el resto.
  const discarded: Discarded = { pieces: 0, faces: 0, segments: 0 };
  const problems: string[] = [];
  const pieces: Piece[] = [];
  file.pieces.forEach((raw, i) => {
    try {
      pieces.push(parsePiece(raw, i, discarded));
    } catch (error) {
      discarded.pieces++;
      problems.push(error instanceof Error ? error.message : String(error));
    }
  });
  // Si no se salva ninguna pieza, el archivo no sirve: se explica el primer problema.
  if (file.pieces.length > 0 && pieces.length === 0) throw new Error(problems[0]);
  const marks = Array.isArray(file.marks) ? file.marks.filter(isVec3) : [];
  const gridSize = Number.isInteger(file.gridSize) && file.gridSize! >= 2 && file.gridSize! <= 1024 ? file.gridSize : undefined;
  const layers = file.layers && Array.isArray(file.layers.layers) ? { ...file.layers, layers: file.layers.layers.filter((l) => l !== null && typeof l === 'object') } : undefined;
  const animation = file.animation ? parseAnimation(file.animation) : undefined;
  return { pieces, marks, ...(gridSize !== undefined ? { gridSize } : {}), ...(layers ? { layers } : {}), ...(animation ? { animation } : {}), references: parseReferences(file.references), discarded };
}

type RawPiece = Partial<ProjectFile['pieces'][number]> | null | undefined;

/** Una pieza del archivo; lanza un Error con un mensaje legible si no se puede leer. Las caras dañadas se quitan (y se cuentan en `discarded`). */
function parsePiece(raw: RawPiece, i: number, discarded: Discarded): Piece {
  const label = `Pieza ${i + 1}`;
  const { color, faces: faceList, faceColors: rawColors, faceTextures: rawTextures, faceFlags: rawFlags, segments: segmentList, group, groupName, layer } = raw ?? {};
  if (!Number.isInteger(color) || color! < 0 || color! > 0xffffff) throw new Error(`${label}: color no válido`);
  // Una pieza puede tener solo segmentos sueltos: entonces no hacen falta caras.
  const rawSegments: unknown[] = Array.isArray(segmentList) ? segmentList : [];
  const segments = rawSegments.filter((s): s is PieceSegment => Array.isArray(s) && s.length === 2 && s.every(isVec3));
  const rawFaces = Array.isArray(faceList) ? faceList : [];
  if (rawFaces.length < 1 && segments.length < 1) throw new Error(`${label}: le faltan caras`);
  const good = rawFaces.map((f) => Array.isArray(f) && f.length >= 3 && f.every(isVec3));
  if (rawFaces.length > 0 && !good.some(Boolean) && segments.length < 1) throw new Error(`${label}: tiene caras no válidas`);
  // Los datos por cara siguen en paralelo con las caras que se conservan.
  const keep = <T,>(list: unknown): T[] | undefined => (Array.isArray(list) && list.length === rawFaces.length ? (list.filter((_, k) => good[k]) as T[]) : undefined);
  const faces = rawFaces.filter((_, k) => good[k]) as Vec3[][];
  const faceColors = keep<number>(rawColors);
  const faceTextures = keep<PackedTexture | null>(rawTextures);
  const faceFlags = keep<number>(rawFlags);
  const validColor = (c: unknown): boolean => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 0xffffff;
  const painted = Array.isArray(faceColors) && faceColors.length === faces.length && faceColors.every(validColor) ? faceColors : undefined;
  // Las texturas dañadas se descartan sin tirar el proyecto: la cara conserva su color.
  const textures = Array.isArray(faceTextures) && faceTextures.length === faces.length ? faceTextures.map((t) => unpackTexture(t)) : undefined;
  const flags = Array.isArray(faceFlags) && faceFlags.length === faces.length && faceFlags.every((f) => Number.isInteger(f) && f >= 0 && f <= 7) ? faceFlags : undefined;
  // Los proyectos guardados con vértices repetidos en una cara (ver cleanRepeats) se reparan al abrirlos.
  const piece = canonPiece(cleanRepeats(makePiece(faces, color as number, painted, textures, flags, segments)));
  if (Number.isInteger(group) && (group as number) > 0) {
    piece.group = group as number;
    if (typeof groupName === 'string' && groupName.trim()) piece.groupName = groupName.trim().slice(0, 60);
  }
  if (Number.isInteger(layer) && (layer as number) > 1) piece.layer = layer as number;
  // Un sólido cerrado y convexo tiene que encerrar volumen; las mallas libres (abiertas, de una cara o torcidas) no lo exigen.
  if (faces.length >= 4 && isConvex(piece) && !(volume(piece) > 1e-9)) throw new Error(`${label}: no encierra volumen`);
  discarded.faces += rawFaces.length - faces.length;
  discarded.segments += rawSegments.length - segments.length;
  return piece;
}
