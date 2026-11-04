import { splitConvex, triangulateFace } from './convex';
import { faceColorOf, type Piece, type Vec3 } from './piece';
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
      if (!piece.faceColors) return [{ name: base, color: piece.color, ...weld(piece.faces) }];
      // Una pieza con caras pintadas se reparte en una malla por color, todas bajo el mismo nombre de pieza.
      const byFaceColor = new Map<number, Vec3[][]>();
      piece.faces.forEach((face, i) => {
        const color = faceColorOf(piece, i);
        const group = byFaceColor.get(color);
        if (group) group.push(face);
        else byFaceColor.set(color, [face]);
      });
      return [...byFaceColor].map(([color, faces]) => ({ name: `${base}_${hex(color)}`, color, ...weld(faces) }));
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
 * La unión solo vale para poliedros convexos: las mallas libres entran con sus caras tal cual.
 */
function mergedMeshes(pieces: Piece[], prefix: string): ExportMesh[] {
  const { convex, free } = splitConvex(pieces);
  const byColor = new Map<number, Vec3[][]>();
  const add = (color: number, face: Vec3[]): void => {
    const group = byColor.get(color);
    if (group) group.push(face);
    else byColor.set(color, [face]);
  };
  for (const { face, color } of mergeCoplanar(unionSurface(convex))) add(color, face);
  for (const piece of free) piece.faces.forEach((face, i) => add(faceColorOf(piece, i), face));
  return [...byColor].map(([color, faces]) => ({ name: `${prefix}_${hex(color)}`, color, ...weld(faces) }));
}
