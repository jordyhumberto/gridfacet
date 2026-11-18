import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { cutPieces } from './cut';
import { joinChange } from './modeling';
import { makePiece, withGroup, withLayer, type Piece, type Vec3 } from './piece';
import { pieceKey, reflectPiece, reflections, symmetrize, withSymmetry } from './symmetry';
import { boundsOf, mirrorChange, mirrorPiece, rotateFreeChange, rotatePieceY, rotateQuarterChange, scaleChange, translatePiece } from './transform';
import { tipVertices, uniqueVertices, vertexKey } from './vertices';

const cube = (): Piece => buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
const keysOf = (...points: Vec3[]) => new Set(points.map(vertexKey));
const line = (a: Vec3, b: Vec3 = [a[0], a[1] + 1, a[2]]): Piece => makePiece([], 0x336699, undefined, undefined, undefined, [[a, b]]);
const corner = (piece: Piece): Vec3 => uniqueVertices(piece).reduce((a, b) => (b[0] + b[1] + b[2] > a[0] + a[1] + a[2] ? b : a));
const withTip = (distance = 0.5): { piece: Piece; base: Piece; from: Vec3; to: Vec3 } => {
  const base = cube();
  const from = corner(base);
  const result = tipVertices(base, keysOf(from), distance)!;
  const [, to] = result.piece.segments![0];
  return { piece: result.piece, base, from, to };
};
const sameVec = (a: Vec3, b: Vec3): boolean => vertexKey(a) === vertexKey(b);

it('una pieza solo de segmentos tiene caja', () => {
  expect(boundsOf([line([1, 0, 1], [1, 2, 1])])).toEqual({ min: [1, 0, 1], max: [1, 2, 1] });
});

describe('Piece.segments: copias, transformaciones y simetría', () => {
  it('withGroup y withLayer conservan los segmentos', () => {
    const { piece } = withTip();
    expect(withGroup(piece, 7).segments).toEqual(piece.segments);
    expect(withLayer(piece, 2).segments).toEqual(piece.segments);
  });

  it('mover, girar, escalar, reflejar y espejo transforman también los segmentos', () => {
    const { piece, from, to } = withTip();
    const moved = translatePiece(piece, 1, 2, 3);
    expect(sameVec(moved.segments![0][1], [to[0] + 1, to[1] + 2, to[2] + 3])).toBe(true);
    const turned = rotatePieceY(piece, 1, 0, 0);
    expect(sameVec(turned.segments![0][0], [from[2], from[1], -from[0]])).toBe(true);
    const mirrored = mirrorPiece(piece, 'x', 0);
    expect(sameVec(mirrored.segments![0][1], [-to[0], to[1], to[2]])).toBe(true);
    const scaled = scaleChange([piece], [2, 2, 2]).added[0];
    expect(scaled.segments).toHaveLength(1);
    expect(boundsOf([scaled])!.max[1] - boundsOf([scaled])!.min[1]).toBeCloseTo((boundsOf([piece])!.max[1] - boundsOf([piece])!.min[1]) * 2, 6);
    expect(rotateFreeChange([piece], 'y', 30).added[0].segments).toHaveLength(1);
    expect(rotateQuarterChange([piece], 'x', 1).added[0].segments).toHaveLength(1);
    expect(mirrorChange([piece], 'z').added[0].segments).toHaveLength(1);
  });

  it('la caja incluye los segmentos que sobresalen de las caras', () => {
    const { piece, base } = withTip(3);
    expect(boundsOf([piece])!.max[1] + boundsOf([piece])!.max[0] + boundsOf([piece])!.max[2]).toBeGreaterThan(boundsOf([base])!.max[0] + boundsOf([base])!.max[1] + boundsOf([base])!.max[2]);
  });

  it('reflectPiece refleja los segmentos; pieceKey los cuenta; withSymmetry añade la imagen', () => {
    const { piece } = withTip();
    const [reflection] = reflections({ x: true, y: false, z: false, center: [0, 0, 0] });
    const image = reflectPiece(piece, reflection);
    expect(image.segments).toHaveLength(1);
    expect(sameVec(image.segments![0][1], [-piece.segments![0][1][0], piece.segments![0][1][1], piece.segments![0][1][2]])).toBe(true);
    // Mismos vértices pero sin segmento: no es la misma pieza.
    const bare = makePiece(piece.faces, piece.color);
    expect(pieceKey(piece)).not.toBe(pieceKey(bare));
    expect(pieceKey(piece)).toBe(pieceKey(makePiece(piece.faces, piece.color, undefined, undefined, undefined, piece.segments)));
    expect(withSymmetry([piece], { x: true, y: false, z: false, center: [0, 0, 0] })).toHaveLength(2);
  });

  it('symmetrize empareja los extremos de segmentos como cualquier vértice', () => {
    const a = line([1, 0, 0], [1, 1, 0]);
    const b = line([-1, 0, 0], [-1.01, 1, 0]);
    const result = symmetrize([a, b], { x: true, y: false, z: false, center: [0, 0, 0] });
    expect(result.total).toBe(4);
    expect(result.fixed).toBeGreaterThan(0);
    expect(result.unpaired.size).toBe(0);
  });

  it('unir (joinChange) conserva los segmentos; cortar no falla con ellos', () => {
    const { piece } = withTip();
    const other = translatePiece(cube(), 3, 0, 0);
    const joined = joinChange([piece, other]);
    expect('change' in joined && joined.change.added[0].segments).toHaveLength(1);
    const plane = { n: [1, 0, 0] as Vec3, d: 0.5 };
    expect(() => cutPieces([piece, line([0, 0, 0], [3, 0, 0])], plane, true)).not.toThrow();
  });
});

