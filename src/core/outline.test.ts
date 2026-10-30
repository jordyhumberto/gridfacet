import { describe, expect, it } from 'vitest';
import { convexHull } from './hull';
import { growOutline, prepareOutline } from './outline';
import { sinkFacesChange } from './modeling';
import { makePiece, volume, type Vec3 } from './piece';
import { boundsOf } from './transform';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
  const points: Vec3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) points.push([x, y, z]);
  return makePiece(convexHull(points)!, 0xff0000);
};

// Un bloque de 4 × 1 × 4 con la cara de arriba en y = 1.
const slab = box(0, 0, 0, 4, 1, 4);
const total = (pieces: ReturnType<typeof box>[]) => pieces.reduce((sum, p) => sum + volume(p), 0);

describe('figura marcada', () => {
  it('un cuadrilátero sobre la cara superior crece como un prisma hacia arriba', () => {
    const outline = prepareOutline([[1, 1, 1], [3, 1, 1], [3, 1, 2], [1, 1, 2]], [slab]);
    expect('error' in outline).toBe(false);
    if ('error' in outline) return;
    expect(outline.normal[1]).toBeCloseTo(1);
    const grown = growOutline(outline, 0.5);
    expect(grown).toHaveLength(1);
    expect(volume(grown[0])).toBeCloseTo(2 * 1 * 0.5, 6);
    const box = boundsOf(grown)!;
    expect(box.min[1]).toBeCloseTo(1);
    expect(box.max[1]).toBeCloseTo(1.5);
  });

  it('el orden de los puntos no importa: horario o antihorario crece hacia fuera', () => {
    const outline = prepareOutline([[1, 1, 2], [3, 1, 2], [3, 1, 1], [1, 1, 1]], [slab]);
    if ('error' in outline) throw new Error(outline.error);
    expect(boundsOf(growOutline(outline, 0.5))!.max[1]).toBeCloseTo(1.5);
  });

  it('hundir quita solo el volumen de la figura', () => {
    const outline = prepareOutline([[1, 1, 1], [3, 1, 1], [3, 1, 2], [1, 1, 2]], [slab]);
    if ('error' in outline) throw new Error(outline.error);
    const change = sinkFacesChange(outline.faces, [slab], 0.25);
    expect(change.removed).toContain(slab);
    expect(total(change.added)).toBeCloseTo(volume(slab) - 2 * 0.25, 6);
  });

  it('una figura en L (no convexa) crece como varias piezas con el volumen justo', () => {
    // L: 2 × 1 abajo + 1 × 1 arriba = área 3.
    const l: Vec3[] = [[0, 1, 0], [2, 1, 0], [2, 1, 1], [1, 1, 1], [1, 1, 2], [0, 1, 2]];
    const outline = prepareOutline(l, [slab]);
    if ('error' in outline) throw new Error(outline.error);
    const grown = growOutline(outline, 1);
    expect(grown.length).toBeGreaterThan(1);
    expect(total(grown)).toBeCloseTo(3 * 1, 6);
  });

  it('sobre una cara inclinada crece en la dirección de su normal', () => {
    const s = Math.SQRT1_2;
    const ramp = makePiece(convexHull([[0, 0, 0], [2, 0, 0], [0, 0, 1], [2, 0, 1], [0, 1, 1], [2, 1, 1]] as Vec3[])!, 0x88aacc);
    // Tres puntos sobre el plano de la pendiente (y = z).
    const outline = prepareOutline([[0.5, 0.3, 0.3], [1.5, 0.3, 0.3], [1, 0.6, 0.6]], [ramp]);
    if ('error' in outline) throw new Error(outline.error);
    expect(outline.normal[1]).toBeCloseTo(s);
    expect(outline.normal[2]).toBeCloseTo(-s);
    const grown = growOutline(outline, 0.4);
    const top = Math.max(...grown[0].faces.flat().map((p) => p[1]));
    expect(top).toBeGreaterThan(0.6);
  });

  it('avisa si faltan puntos, están en línea o no son coplanares', () => {
    expect('error' in prepareOutline([[1, 1, 1], [2, 1, 1]], [slab])).toBe(true);
    expect('error' in prepareOutline([[1, 1, 1], [2, 1, 1], [3, 1, 1]], [slab])).toBe(true);
    expect('error' in prepareOutline([[1, 1, 1], [3, 1, 1], [3, 1, 2], [1, 2, 2]], [slab])).toBe(true);
  });

  it('avisa si la figura no está sobre ninguna cara', () => {
    expect('error' in prepareOutline([[1, 2, 1], [3, 2, 1], [3, 2, 2]], [slab])).toBe(true);
  });

  it('un lazo (puntos cruzados) se rechaza con un aviso claro', () => {
    const result = prepareOutline([[1, 1, 1], [3, 1, 2], [3, 1, 1], [1, 1, 2]], [slab]);
    expect('error' in result && result.error).toMatch(/se cruza/);
    const bowtie = prepareOutline([[0.5, 1, 2], [3.5, 1, 2], [2, 1, 3], [2, 1, 1]], [slab]);
    expect('error' in bowtie).toBe(true);
  });
});
