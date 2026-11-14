import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { makePiece, volume } from './piece';
import { vertexKey } from './vertices';
import { translatePiece } from './transform';
import { pieceKey, reflectPiece, reflections, symmetrize, withSymmetry, withSymmetryPoints, type Symmetry } from './symmetry';

const sym = (x: boolean, y: boolean, z: boolean, center: [number, number, number] = [0, 0, 0]): Symmetry => ({ x, y, z, center });
const cube = (x: number, y = 0, z = 0) => buildPiece(CATALOG[0], x, y * 3, z, 0, 0xff0000);

describe('simetría', () => {
  it('cuenta las reflexiones según los ejes activos', () => {
    expect(reflections(sym(false, false, false))).toHaveLength(0);
    expect(reflections(sym(true, false, false))).toHaveLength(1);
    expect(reflections(sym(true, false, true))).toHaveLength(3);
    expect(reflections(sym(true, true, true))).toHaveLength(7);
  });

  it('un cubo en x 1..2 aparece también en x -2..-1', () => {
    const out = withSymmetry([cube(1)], sym(true, false, false));
    expect(out).toHaveLength(2);
    const xs = out[1].faces.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-2);
    expect(Math.max(...xs)).toBeCloseTo(-1);
  });

  it('con dos ejes salen cuatro cubos', () => {
    expect(withSymmetry([cube(1, 0, 1)], sym(true, false, true))).toHaveLength(4);
  });

  it('una pieza centrada sobre el plano no se duplica', () => {
    const centered = translatePiece(cube(0), -0.5, 0, 0);
    expect(withSymmetry([centered], sym(true, false, false))).toHaveLength(1);
  });

  it('el reflejo conserva el volumen positivo, con uno o dos espejos', () => {
    const ramp = buildPiece(CATALOG[2], 1, 0, 1, 0, 0xff0000);
    for (const reflection of reflections(sym(true, true, true))) {
      expect(volume(reflectPiece(ramp, reflection))).toBeCloseTo(volume(ramp));
    }
  });

  it('respeta la posición del plano', () => {
    const out = withSymmetry([cube(1)], sym(true, false, false, [3, 0, 0]));
    const xs = out[1].faces.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(4);
    expect(Math.max(...xs)).toBeCloseTo(5);
  });

  it('los puntos también se reflejan, sin repetir los que caen sobre el plano', () => {
    expect(withSymmetryPoints([[1, 2, 3]], sym(true, false, false))).toEqual([[1, 2, 3], [-1, 2, 3]]);
    expect(withSymmetryPoints([[0, 2, 3]], sym(true, false, false))).toHaveLength(1);
    expect(withSymmetryPoints([[1, 2, 3]], sym(true, false, true))).toHaveLength(4);
  });

  it('pieceKey reconoce piezas iguales', () => {
    expect(pieceKey(cube(2))).toBe(pieceKey(cube(2)));
    expect(pieceKey(cube(2))).not.toBe(pieceKey(cube(3)));
  });
});

describe('symmetrize', () => {
  const onX = sym(true, false, false);
  // Un cuadrado que cruza el plano X=0, con el lado derecho ligeramente descuadrado.
  const square = () =>
    makePiece(
      [
        [[-1, 0, 0], [1.01, 0, 0.004], [1, 1, 0], [-1, 1, 0]],
      ],
      0xffffff,
    );

  it('deja la pieza exactamente simétrica', () => {
    const piece = square();
    const result = symmetrize([piece], onX);
    expect(result.fixed).toBeGreaterThan(0);
    expect(result.unpaired.size).toBe(0);
    const moves = result.moves.get(piece.id)!;
    const final = piece.faces[0].map((p) => moves.get(vertexKey(p)) ?? p);
    const keys = new Set(final.map(vertexKey));
    for (const p of final) expect(keys.has(vertexKey([-p[0], p[1], p[2]]))).toBe(true);
  });

  it('un vértice casi sobre el plano queda sobre él', () => {
    const piece = makePiece([[[0.01, 0, 0], [1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0.01, 0, 0], [0, 1, 0]]], 0xffffff);
    const result = symmetrize([piece], onX);
    const moves = result.moves.get(piece.id)!;
    expect(moves.get(vertexKey([0.01, 0, 0]))![0]).toBeCloseTo(0, 6);
  });

  it('cuenta los vértices sin gemelo y no los toca', () => {
    const piece = makePiece([[[1, 0, 0], [2, 0, 0], [1, 1, 0]]], 0xffffff);
    const result = symmetrize([piece], onX);
    expect(result.unpaired.size).toBe(3);
    expect(result.fixed).toBe(0);
  });

  it('sin ejes activos no hace nada', () => {
    const piece = square();
    const result = symmetrize([piece], sym(false, false, false));
    expect(result.fixed).toBe(0);
    expect(result.total).toBe(4);
  });

  it('empareja entre piezas distintas (cada lado en su pieza)', () => {
    const left = makePiece([[[-1, 0, 0], [-2, 0, 0], [-1, 1, 0]]], 0xffffff);
    const right = makePiece([[[1.01, 0, 0], [2, 0, 0], [1, 1, 0.005]]], 0xffffff);
    const result = symmetrize([left, right], onX);
    expect(result.unpaired.size).toBe(0);
    expect(result.moves.size).toBeGreaterThan(0);
  });
});
