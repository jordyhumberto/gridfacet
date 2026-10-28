import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { clipPiece, planeFromPoints, volume, type Vec3 } from './piece';

const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0xffffff);

describe('volumen de piezas del catálogo', () => {
  it('cubo = 1, placa = 1/3, rampa = 1/2', () => {
    expect(volume(buildPiece(CATALOG[0], 0, 0, 0, 0, 0))).toBeCloseTo(1);
    expect(volume(buildPiece(CATALOG[1], 0, 0, 0, 0, 0))).toBeCloseTo(1 / 3);
    expect(volume(buildPiece(CATALOG[2], 0, 0, 0, 0, 0))).toBeCloseTo(0.5);
  });

  it('la rotación conserva el volumen', () => {
    for (let r = 0; r < 4; r++) {
      expect(volume(buildPiece(CATALOG[2], 3, 0, -2, r, 0))).toBeCloseTo(0.5);
    }
  });
});

describe('clipPiece', () => {
  // Plano por (0,0,0), (1,0,0) y (1,1,1): rampa clásica sobre el cubo unidad.
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [1, 0, 0];
  const c: Vec3 = [1, 1, 1];

  it('cortar un cubo en diagonal deja la mitad con 5 caras', () => {
    const plane = planeFromPoints(a, b, c);
    const kept = clipPiece(cube(), plane);
    const other = clipPiece(cube(), { n: plane.n.map((x) => -x) as Vec3, d: -plane.d });
    expect(kept).not.toBeNull();
    expect(other).not.toBeNull();
    expect(volume(kept!)).toBeCloseTo(0.5);
    expect(volume(other!)).toBeCloseTo(0.5);
    expect(kept!.faces).toHaveLength(5);
  });

  it('un plano que no toca la pieza la conserva o la descarta entera', () => {
    const above = planeFromPoints([0, 2, 0], [1, 2, 1], [1, 2, 0]);
    const keptAll = clipPiece(cube(), above);
    const keptNone = clipPiece(cube(), { n: above.n.map((x) => -x) as Vec3, d: -above.d });
    expect(keptAll && volume(keptAll)).toBeCloseTo(1);
    expect(keptNone).toBeNull();
  });

  it('un corte plano a media altura da volumen 1/2', () => {
    const plane = { n: [0, 1, 0] as Vec3, d: 0.5 };
    const half = clipPiece(cube(), plane);
    expect(volume(half!)).toBeCloseTo(0.5);
    expect(half!.faces).toHaveLength(6);
  });
});
