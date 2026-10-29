import { describe, expect, it } from 'vitest';
import { CATALOG, PLATE, buildPieces } from './catalog';
import { faceNormal, volume, type Piece } from './piece';

const bounds = (pieces: Piece[]) => {
  const points = pieces.flatMap((p) => p.faces.flat());
  const axis = (k: number) => [Math.min(...points.map((p) => p[k])), Math.max(...points.map((p) => p[k]))];
  return { x: axis(0), y: axis(1), z: axis(2) };
};

/** Cada vértice debe quedar del lado interior de todos los planos de las caras. */
function isConvex(piece: Piece): boolean {
  const vertices = piece.faces.flat();
  return piece.faces.every((face) => {
    const n = faceNormal(face);
    const length = Math.hypot(n[0], n[1], n[2]);
    const d = (n[0] * face[0][0] + n[1] * face[0][1] + n[2] * face[0][2]) / length;
    return vertices.every((v) => (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) / length <= d + 1e-9);
  });
}

describe.each(CATALOG)('catálogo: $name', (def) => {
  it.each([0, 1, 2, 3])('con %i giros: partes convexas, con volumen y caras hacia fuera', (rotation) => {
    const parts = buildPieces(def, 0, 0, 0, rotation, 0);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(volume(part)).toBeGreaterThan(1e-6);
      expect(isConvex(part)).toBe(true);
    }
  });

  it.each([0, 1, 2, 3])('con %i giros: la huella girada empieza en la celda pedida', (rotation) => {
    const [w, d] = def.footprint;
    const { x, z, y } = bounds(buildPieces(def, 3, 2, -4, rotation, 0));
    const swapped = rotation % 2 === 1;
    expect(x[0]).toBeCloseTo(3);
    expect(z[0]).toBeCloseTo(-4);
    expect(x[1] - x[0]).toBeCloseTo(swapped ? d : w);
    expect(z[1] - z[0]).toBeCloseTo(swapped ? w : d);
    expect(y[0]).toBeCloseTo(2 * PLATE);
    expect(y[1] - y[0]).toBeLessThanOrEqual(def.heightPlates * PLATE + 1e-9);
  });

  it('girar no cambia el volumen', () => {
    const total = (rotation: number) => buildPieces(def, 0, 0, 0, rotation, 0).reduce((sum, p) => sum + volume(p), 0);
    for (const r of [1, 2, 3]) expect(total(r)).toBeCloseTo(total(0));
  });
});

describe.each(CATALOG)('escala: $name', (def) => {
  it.each([0.25, 0.5, 2])('con escala %f el volumen se multiplica por escala³ y la esquina mínima no se mueve', (scale) => {
    const total = (s: number) => buildPieces(def, 3, 2, -4, 0, 0, s).reduce((sum, p) => sum + volume(p), 0);
    expect(total(scale)).toBeCloseTo(total(1) * scale ** 3, 6);
    const { x, z, y } = bounds(buildPieces(def, 3, 2, -4, 1, 0, scale));
    expect(x[0]).toBeCloseTo(3);
    expect(z[0]).toBeCloseTo(-4);
    expect(y[0]).toBeCloseTo(2 * PLATE);
  });
});

describe('volúmenes conocidos', () => {
  const total = (id: string) =>
    buildPieces(CATALOG.find((d) => d.id === id)!, 0, 0, 0, 0, 0).reduce((sum, p) => sum + volume(p), 0);

  it('ladrillo 2×1 = 2, esquina exterior = 1/3, esquina interior = 2/3', () => {
    expect(total('brick')).toBeCloseTo(2);
    expect(total('outer')).toBeCloseTo(1 / 3);
    expect(total('inner')).toBeCloseTo(2 / 3);
  });

  it('cilindro de 16 lados = área del polígono × alto', () => {
    expect(total('cylinder')).toBeCloseTo(0.5 * 16 * 0.25 * Math.sin((2 * Math.PI) / 16));
  });

  it('el arco es menor que su caja y tiene seis partes', () => {
    const arch = CATALOG.find((d) => d.id === 'arch')!;
    expect(buildPieces(arch, 0, 0, 0, 0, 0)).toHaveLength(6);
    expect(total('arch')).toBeLessThan(2 * (4 / 3));
    expect(total('arch')).toBeGreaterThan(0.5 * 2 * (4 / 3));
  });
});
