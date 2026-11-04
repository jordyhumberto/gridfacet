import { splitConvex, triangulateFace } from './convex';
import { FACE_DOUBLE, FACE_UNLIT, faceColorOf, type Piece, type Vec3 } from './piece';
import { layerOf } from './layers';
import { mergeCoplanar } from './merge';
import { unionSurface } from './union';

export type ExportMode = 'merged' | 'perPiece' | 'perLayer';

/** Malla indexada y soldada, lista para volcar a un formato de intercambio. */
export interface ExportMesh {
  name: string;
  color: number;
  positions: number[];
  indices: number[];
  /** Propiedades de sus caras (bits de `FACE_DOUBLE` y `FACE_UNLIT`); 0 o sin valor, normales. */
  flags?: number;
}

const KEY_PRECISION = 1e6;

const vertexKey = (v: Vec3): string => v.map((x) => Math.round(x * KEY_PRECISION)).join(',');

function weld(faces: Vec3[][]): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const lookup = new Map<string, number>();
  const indexOf = (v: Vec3): number => {
    const key = vertexKey(v);
    let index = lookup.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      lookup.set(key, index);
      positions.push(v[0], v[1], v[2]);
    }
    return index;
  };
  for (const face of faces) {
    const ids = face.map(indexOf);
    for (const [a, b, c] of triangulateFace(face)) indices.push(ids[a], ids[b], ids[c]);
  }
  return { positions, indices };
}

/** Nombre apto para un objeto 3D: sin espacios ni símbolos raros. */
const safeName = (name: string): string => name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'Grupo';

const hex = (color: number): string => color.toString(16).padStart(6, '0');

/** Sufijo del nombre de una malla según las propiedades de sus caras. */
const flagSuffix = (flags: number): string => (flags & FACE_DOUBLE ? '_doble' : '') + (flags & FACE_UNLIT ? '_sinluz' : '');

/** Reparte caras por color y propiedades: una malla por cada combinación. */
class FaceBuckets {
  private buckets = new Map<string, { color: number; flags: number; faces: Vec3[][] }>();
  add(color: number, flags: number, face: Vec3[]): void {
    const key = `${color}:${flags}`;
    const bucket = this.buckets.get(key);
    if (bucket) bucket.faces.push(face);
    else this.buckets.set(key, { color, flags, faces: [face] });
  }
  meshes(prefix: string): ExportMesh[] {
    return [...this.buckets.values()].map(({ color, flags, faces }) => ({
      name: `${prefix}_${hex(color)}${flagSuffix(flags)}`,
      color,
      ...(flags ? { flags } : {}),
      ...weld(faces),
    }));
  }
}

/**
 * `merged`: una malla por color con la unión de todas las piezas: sin caras interiores ni geometría
 * dentro de otras piezas, aunque se solapen o se toquen solo en parte, y con las caras coplanares
 * fusionadas en polígonos grandes.
 * `perPiece`: una malla por pieza, tal como están en la escena.
 * `perLayer`: como `merged` pero por separado en cada capa, con el nombre de la capa en cada malla.
 */
export function buildExportMeshes(pieces: Piece[], mode: ExportMode, layerName: (layer: number) => string = (layer) => `Capa_${layer}`): ExportMesh[] {
  if (mode === 'perPiece') {
    return pieces.flatMap((piece) => {
      // Un grupo con nombre da nombre a sus objetos: útil para reconocer las partes al hacer el rigging en Blender.
      const base = piece.groupName ? `${safeName(piece.groupName)}_${piece.id}` : `Pieza_${piece.id}`;
      if (!piece.faceColors && !piece.faceFlags) return [{ name: base, color: piece.color, ...weld(piece.faces) }];
      // Una pieza con caras pintadas o con propiedades se reparte en una malla por color y propiedades, todas bajo el mismo nombre de pieza.
      const buckets = new FaceBuckets();
      piece.faces.forEach((face, i) => buckets.add(faceColorOf(piece, i), piece.faceFlags?.[i] ?? 0, face));
      return buckets.meshes(base);
    });
  }

  if (mode === 'perLayer') {
    const byLayer = new Map<number, Piece[]>();
    for (const piece of pieces) {
      const list = byLayer.get(layerOf(piece));
      if (list) list.push(piece);
      else byLayer.set(layerOf(piece), [piece]);
    }
    return [...byLayer].sort(([a], [b]) => a - b).flatMap(([layer, list]) => mergedMeshes(list, safeName(layerName(layer))));
  }
  return mergedMeshes(pieces, 'Gridfacet');
}

/**
 * Una malla por color con la unión de las piezas dadas; el nombre empieza por `prefix`.
 * La unión solo vale para poliedros convexos sin propiedades de cara: las mallas libres y las piezas con caras de doble cara
 * o sin sombra entran con sus caras tal cual (la unión perdería esas propiedades).
 */
function mergedMeshes(pieces: Piece[], prefix: string): ExportMesh[] {
  const { convex, free } = splitConvex(pieces.filter((piece) => !piece.faceFlags));
  const buckets = new FaceBuckets();
  for (const { face, color } of mergeCoplanar(unionSurface(convex))) buckets.add(color, 0, face);
  for (const piece of [...free, ...pieces.filter((p) => p.faceFlags)]) piece.faces.forEach((face, i) => buckets.add(faceColorOf(piece, i), piece.faceFlags?.[i] ?? 0, face));
  return buckets.meshes(prefix);
}
