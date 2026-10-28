import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { volume } from './piece';
import { boundsOf, centerChange, mirrorChange, mirrorPiece, moveChange, rotateChange, rotateFreeChange, rotationCenter, scaleChange, translatePiece } from './transform';

const cube = (x = 0, z = 0) => buildPiece(CATALOG[0], x, 0, z, 0, 0xabcdef);
const bounds = (piece: ReturnType<typeof cube>, axis: 0 | 1 | 2) => {
  const values = piece.faces.flat().map((p) => p[axis]);
  return [Math.min(...values), Math.max(...values)];
};

describe('mover', () => {
  it('desplaza media celda y conserva volumen y color', () => {
    const moved = translatePiece(cube(), 0.5, 0, 0);
    expect(bounds(moved, 0)).toEqual([0.5, 1.5]);
    expect(volume(moved)).toBeCloseTo(1);
    expect(moved.color).toBe(0xabcdef);
  });

  it('el cambio retira las originales y añade copias nuevas', () => {
    const original = cube();
    const { removed, added } = moveChange([original], 0, 1 / 6, 0);
    expect(removed).toEqual([original]);
    expect(added).toHaveLength(1);
    expect(added[0].id).not.toBe(original.id);
  });
});

describe('rotar', () => {
  it('el centro del conjunto cae en la malla de media celda', () => {
    expect(rotationCenter([cube(0, 0)])).toEqual([0.5, 0.5]);
    expect(rotationCenter([cube(0, 0), cube(1, 0)])).toEqual([1, 0.5]);
  });

  it('cuatro giros devuelven la pieza a su sitio', () => {
    const rampa = buildPiece(CATALOG[2], 2, 0, 3, 0, 0);
    let current = rampa;
    for (let i = 0; i < 4; i++) current = rotateChange([current], 1).added[0];
    expect(current.faces.flat().map((p) => p.map((v) => Math.round(v * 1e6)))).toEqual(
      rampa.faces.flat().map((p) => p.map((v) => Math.round(v * 1e6))),
    );
  });

  it('un giro de un grupo conserva el volumen total', () => {
    const group = [cube(0, 0), buildPiece(CATALOG[2], 1, 0, 0, 0, 0)];
    const { added } = rotateChange(group, 1);
    expect(added.reduce((sum, p) => sum + volume(p), 0)).toBeCloseTo(1.5);
  });
});

describe('espejo', () => {
  const wedge = buildPiece(CATALOG[2], 0, 0, 0, 0, 0xff0000);

  it('conserva el volumen y las normales hacia fuera', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const mirrored = mirrorPiece(wedge, axis, 0.5);
      expect(volume(mirrored)).toBeCloseTo(volume(wedge));
    }
  });

  it('volver a reflejar devuelve la pieza original', () => {
    const twice = mirrorPiece(mirrorPiece(wedge, 'x', 0.5), 'x', 0.5);
    expect(twice.faces.flat().map((p) => p.map((v) => +v.toFixed(6)).join())).toEqual(
      wedge.faces.flat().map((p) => p.map((v) => +v.toFixed(6)).join()),
    );
  });

  it('una rampa reflejada cambia el lado hacia el que sube', () => {
    // La parte alta está en un lado de Z; el espejo en Z la pasa al lado contrario y el de X la deja igual.
    const highZ = (piece: typeof wedge) => {
      const top = piece.faces.flat().filter((p) => p[1] > 0.5).map((p) => p[2]);
      return top.reduce((a, b) => a + b, 0) / top.length;
    };
    expect(Math.abs(highZ(wedge) - highZ(mirrorPiece(wedge, 'z', 0.5)))).toBeGreaterThan(0.5);
    expect(highZ(wedge)).toBeCloseTo(highZ(mirrorPiece(wedge, 'x', 0.5)));
  });

  it('mirrorChange refleja el conjunto sobre su propio centro', () => {
    const a = buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);
    const b = buildPiece(CATALOG[0], 1, 0, 0, 0, 0x0000ff);
    const { added } = mirrorChange([a, b], 'x');
    const xs = added.flatMap((p) => p.faces.flat().map((v) => v[0]));
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(2);
    expect(added[0].color).toBe(0xff0000);
    expect(Math.min(...added[0].faces.flat().map((v) => v[0]))).toBeCloseTo(1);
  });
});

describe('escala, centro y giro libres', () => {
  const cubeAt = (x: number) => buildPiece(CATALOG[0], x, 0, 0, 0, 0xff0000);

  it('escalar estira respecto al centro de la caja', () => {
    const pieces = [cubeAt(0), cubeAt(1)];
    const change = scaleChange(pieces, [2, 1, 1]);
    const box = boundsOf(change.added)!;
    expect(box.max[0] - box.min[0]).toBeCloseTo(4);
    expect((box.min[0] + box.max[0]) / 2).toBeCloseTo(1);
    expect(box.max[1] - box.min[1]).toBeCloseTo(1);
  });

  it('un factor no positivo no cambia nada', () => {
    expect(scaleChange([cubeAt(0)], [0, 1, 1]).added).toHaveLength(0);
    expect(scaleChange([cubeAt(0)], [-1, 1, 1]).added).toHaveLength(0);
  });

  it('centerChange lleva el centro a un punto', () => {
    const box = boundsOf(centerChange([cubeAt(0)], [5, 2, -1]).added)!;
    expect([0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2)).toEqual([5, 2, -1].map((v) => expect.closeTo(v, 6)));
  });

  it('girar 90° alrededor de Y equivale a un giro exacto, y 360° vuelve al inicio', () => {
    const piece = buildPiece(CATALOG[3], 0, 0, 0, 0, 0xff0000); // 2×1
    const turned = boundsOf(rotateFreeChange([piece], 'y', 90).added)!;
    expect(turned.max[0] - turned.min[0]).toBeCloseTo(1);
    expect(turned.max[2] - turned.min[2]).toBeCloseTo(2);
    const full = boundsOf(rotateFreeChange([piece], 'y', 360).added)!;
    const orig = boundsOf([piece])!;
    expect(full.max[0] - full.min[0]).toBeCloseTo(orig.max[0] - orig.min[0]);
  });

  it('un giro de 45° conserva el volumen y las normales hacia fuera', () => {
    const piece = cubeAt(0);
    const [turned] = rotateFreeChange([piece], 'z', 45).added;
    expect(volume(turned)).toBeCloseTo(volume(piece), 6);
  });
});
