import { faceColorOf, type Piece, type Vec3 } from './piece';
import { mergeCoplanar } from './merge';
import { unionSurface } from './union';

export type ExportMode = 'merged' | 'perPiece';

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
    for (let i = 1; i < ids.length - 1; i++) indices.push(ids[0], ids[i], ids[i + 1]);
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
 */
export function buildExportMeshes(pieces: Piece[], mode: ExportMode): ExportMesh[] {
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

  const byColor = new Map<number, Vec3[][]>();
  for (const { face, color } of mergeCoplanar(unionSurface(pieces))) {
    const group = byColor.get(color);
    if (group) group.push(face);
    else byColor.set(color, [face]);
  }
  return [...byColor].map(([color, faces]) => ({ name: `Gridfacet_${hex(color)}`, color, ...weld(faces) }));
}
