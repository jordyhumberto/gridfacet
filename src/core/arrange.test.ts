import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { alignChange, distributeChange, groundChange, partsOf, resizeLongestChange } from './arrange';
import { boundsOf } from './transform';

const cube = (x: number, y = 0, z = 0) => buildPiece(CATALOG[0], x, y, z, 0, 0xff0000);
const result = (change: { added: ReturnType<typeof cube>[]; removed: ReturnType<typeof cube>[] }, all: ReturnType<typeof cube>[]) => {
  const gone = new Set(change.removed.map((p) => p.id));
  return [...all.filter((p) => !gone.has(p.id)), ...change.added];
};

describe('alinear, repartir, suelo y medida', () => {
  it('alinear por el lado menor deja todas a ras', () => {
    const all = [cube(0, 0), cube(3, 2), cube(5, 1)];
    const out = result(alignChange(all, 'y', 'min'), all);
    expect(out.map((p) => boundsOf([p])!.min[1])).toEqual(expect.arrayContaining([0]));
    expect(new Set(out.map((p) => Math.round(boundsOf([p])!.min[1] * 1e6)))).toEqual(new Set([0]));
  });

  it('alinear por el centro usa el centro del conjunto', () => {
    const all = [cube(0), cube(4)];
    const out = result(alignChange(all, 'z', 'center'), all);
    expect(out).toHaveLength(2);
    const a = alignChange([cube(0, 0, 0), cube(0, 0, 4)], 'z', 'center');
    const mid = a.added.map((p) => (boundsOf([p])!.min[2] + boundsOf([p])!.max[2]) / 2);
    expect(mid[0]).toBeCloseTo(mid[1]);
  });

  it('un grupo se mueve como una sola parte', () => {
    const a = { ...cube(0), group: 1 };
    const b = { ...cube(1), group: 1 };
    expect(partsOf([a, b, cube(5)])).toHaveLength(2);
    const change = alignChange([a, b, cube(5, 3)], 'y', 'min');
    expect(change.removed).toHaveLength(1);
  });

  it('repartir deja huecos iguales y no mueve los extremos', () => {
    const all = [cube(0), cube(1), cube(7)];
    const out = result(distributeChange(all, 'x'), all).map((p) => boundsOf([p])!).sort((p, q) => p.min[0] - q.min[0]);
    const gap1 = out[1].min[0] - out[0].max[0];
    const gap2 = out[2].min[0] - out[1].max[0];
    expect(gap1).toBeCloseTo(gap2);
    expect(out[0].min[0]).toBeCloseTo(0);
    expect(out[2].min[0]).toBeCloseTo(7);
  });

  it('repartir pide tres partes', () => {
    expect(distributeChange([cube(0), cube(3)], 'x').added).toEqual([]);
  });

  it('al suelo baja la selección hasta y = 0', () => {
    const all = [cube(0, 3), cube(2, 5)];
    const { added } = groundChange(all);
    expect(boundsOf(added)!.min[1]).toBeCloseTo(0);
    expect(boundsOf(added)!.max[1] - boundsOf(added)!.min[1]).toBeCloseTo(boundsOf(all)!.max[1] - boundsOf(all)!.min[1]);
    expect(groundChange(added).added).toEqual([]);
  });

  it('redimensionar fija la dimensión mayor y conserva proporciones', () => {
    const all = [cube(0), cube(1)];
    const { added } = resizeLongestChange(all, 4);
    const box = boundsOf(added)!;
    const dims = [0, 1, 2].map((k) => box.max[k] - box.min[k]);
    expect(Math.max(...dims)).toBeCloseTo(4);
    expect(dims[0] / dims[2]).toBeCloseTo(2);
  });
});
