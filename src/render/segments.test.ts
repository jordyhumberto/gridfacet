import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from '../core/catalog';
import { makePiece, type Piece } from '../core/piece';
import { tipVertices, uniqueVertices, vertexKey } from '../core/vertices';
import { PieceBatches } from './batches';
import { createPieceObject, pieceGeometry, pieceOutline, pieceVertices } from './meshes';

const cube = (): Piece => buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
const onlyLine = (): Piece => makePiece([], 0x336699, undefined, undefined, undefined, [[[0, 0, 0], [0, 2, 0]]]);
const tipped = (): Piece => {
  const base = cube();
  const corner = uniqueVertices(base).reduce((a, b) => (b[0] + b[1] + b[2] > a[0] + a[1] + a[2] ? b : a));
  return tipVertices(base, new Set([vertexKey(corner)]), 0.5)!.piece;
};
const count = (geometry: { getAttribute(name: string): { count: number } }): number => geometry.getAttribute('position').count;

describe('dibujo de los segmentos sueltos', () => {
  it('el contorno suma una línea por segmento y la malla no gana triángulos', () => {
    const base = cube();
    const piece = tipped();
    expect(count(pieceOutline(piece).geometry)).toBe(count(pieceOutline(base).geometry) + 2);
    expect(count(pieceGeometry(piece))).toBe(count(pieceGeometry(base)));
  });

  it('una pieza solo de segmentos dibuja su línea y sus vértices, sin triángulos', () => {
    const piece = onlyLine();
    expect(count(pieceOutline(piece).geometry)).toBe(2);
    expect(count(pieceGeometry(piece))).toBe(0);
    expect(count(pieceVertices(piece).geometry)).toBe(2);
    expect(() => createPieceObject(piece)).not.toThrow();
  });

  it('el contorno de un segmento toma el color que se le da (el de la pieza en la vista de líneas)', () => {
    const lines = pieceOutline(onlyLine(), 0xabcdef);
    expect(lines.userData.baseColor).toBe(0xabcdef);
  });

  it('en lotes, los segmentos dan líneas con el color del contorno y ningún triángulo', () => {
    const batches = new PieceBatches();
    const piece = onlyLine();
    batches.add(piece);
    batches.add(tipped());
    expect(() => batches.flush()).not.toThrow();
    const outline = batches.group.children.find((child) => (child as { isLineSegments?: boolean }).isLineSegments) as unknown as { geometry: { getAttribute(name: string): { count: number } } };
    // Cubo: 6 caras de 4 aristas · 2 puntos cada una, más 2 segmentos (el de la punta y el de la pieza suelta) · 2 puntos.
    expect(count(outline.geometry)).toBe(6 * 4 * 2 + 2 * 2);
    expect(piece.faces).toEqual([]);
  });
});
