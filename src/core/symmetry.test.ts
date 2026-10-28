import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { volume } from './piece';
import { translatePiece } from './transform';
import { pieceKey, reflectPiece, reflections, withSymmetry, withSymmetryPoints, type Symmetry } from './symmetry';

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
