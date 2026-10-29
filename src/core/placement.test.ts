import { describe, expect, it } from 'vitest';
import { buildPieces, buildSlab, CATALOG, SLAB_THICKNESS } from './catalog';
import { clearanceLift } from './placement';
import { volume } from './piece';
import { boundsOf } from './transform';

const def = (id: string) => CATALOG.find((d) => d.id === id)!;
const at = (id: string, cx: number, cyPlates: number, cz: number) => buildPieces(def(id), cx, cyPlates, cz, 0, 0xff0000);

describe('subir para no meterse en otras piezas', () => {
  it('sin nada debajo no sube', () => {
    expect(clearanceLift(at('cube', 0, 0, 0), [])).toBe(0);
  });

  it('apoyado sobre un cubo exacto, tampoco', () => {
    expect(clearanceLift(at('cube', 0, 3, 0), at('cube', 0, 0, 0))).toBe(0);
  });

  it('un cubo apuntado a la altura de un cubito baja del todo si otro cuadrante es más alto', () => {
    // Un cubito (¼) sobre el suelo, y otro cubo grande de 2 placas más arriba en la misma celda
    const lowStep = at('quarter', 0, 0, 0);
    const parts = at('cube', 0, 1.5, 0);
    const lift = clearanceLift(parts, lowStep);
    // El cubito mide 1,5 placas; el cubo ya está sobre él (1,5 placas), así que no sube
    expect(lift).toBe(0);
  });

  it('sube hasta la cima de lo que lo atraviesa, en pasos de media placa', () => {
    const blocker = at('cube', 0, 0, 0); // llega a y = 1
    const parts = at('cube', 0, 1, 0); // arranca a y = 1/3: se mete dentro
    const lift = clearanceLift(parts, blocker);
    expect(boundsOf(parts)!.min[1] + lift).toBeCloseTo(1, 6);
  });

  it('con una cuña de 1,5 placas en una esquina y el cubo a 1 placa, queda encima', () => {
    const step = at('quarter', 0.5, 0, 0.5); // 0,5 de alto
    const parts = at('cube', 0, 0.5, 0); // arranca a y = 1/6
    const lift = clearanceLift(parts, step);
    expect(boundsOf(parts)!.min[1] + lift).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(lift * 6).toBeCloseTo(Math.round(lift * 6), 6);
  });

  it('piezas que solo se tocan por un lado no cuentan', () => {
    expect(clearanceLift(at('cube', 1, 0, 0), at('cube', 0, 0, 0))).toBe(0);
  });

  it('si hay varias capas, sube por encima de todas', () => {
    const tower = [...at('cube', 0, 0, 0), ...at('cube', 0, 3, 0)];
    const parts = at('cube', 0, 1, 0);
    const lift = clearanceLift(parts, tower);
    expect(boundsOf(parts)!.min[1] + lift).toBeCloseTo(2, 6);
  });
});

describe('lámina que crece desde una cara', () => {
  it.each([
    [1, 1, 1],
    [1, -1, 1],
    [0, 1, 0.5],
    [0, -1, 0.5],
    [2, 1, 2],
    [2, -1, 2],
  ] as const)('eje %i, signo %i: grosor de un cuarto pegado a la cara', (axis, sign, surface) => {
    const slab = buildSlab(axis, sign, surface, [0, 0, 0], 0x00ff00);
    expect(volume(slab)).toBeCloseTo(SLAB_THICKNESS, 6);
    const box = boundsOf([slab])!;
    const [lo, hi] = [box.min[axis], box.max[axis]];
    if (sign > 0) expect(lo).toBeCloseTo(surface, 6);
    else expect(hi).toBeCloseTo(surface, 6);
    expect(hi - lo).toBeCloseTo(SLAB_THICKNESS, 6);
  });

  it('en los otros ejes ocupa una celda entera desde la esquina dada', () => {
    const box = boundsOf([buildSlab(1, 1, 2, [3, 0, -4], 0)])!;
    expect(box.min[0]).toBeCloseTo(3);
    expect(box.max[0]).toBeCloseTo(4);
    expect(box.min[2]).toBeCloseTo(-4);
    expect(box.max[2]).toBeCloseTo(-3);
  });
});
