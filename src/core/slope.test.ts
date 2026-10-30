import { describe, expect, it } from 'vitest';
import { buildPieces, CATALOG } from './catalog';
import { slopeKindOf, planeHeight, seatOnSlope, standOnSlope } from './slope';
import { volume, type Vec3 } from './piece';
import { boundsOf } from './transform';

const cube = (scale = 1) => buildPieces(CATALOG.find((d) => d.id === 'cube')!, 0, 0, 0, 0, 0xff0000, scale);
const s = Math.SQRT1_2;

describe('pendientes', () => {
  it('reconoce pendientes y deja las caras rectas y verticales como están', () => {
    expect(slopeKindOf([0, 1, 0], 'seat')).toBeNull();
    expect(slopeKindOf([1, 0, 0], 'seat')).toBeNull();
    expect(slopeKindOf([0.7, 0.01, 0.7], 'seat')).toBeNull(); // faceta vertical de un cilindro
    expect(slopeKindOf([s, s, 0], 'seat')).toBe('seat');
    expect(slopeKindOf([s, s, 0], 'perp')).toBe('perp');
    expect(slopeKindOf([s, s, 0], 'grid')).toBeNull();
    expect(slopeKindOf([s, -s, 0], 'seat')).toBe('perp'); // por debajo no se puede asentar
  });

  it('el plano da la altura de la rampa', () => {
    // rampa que sube 1 por celda hacia +x: normal (−s, s, 0) mirando arriba y a la izquierda
    const n: Vec3 = [-s, s, 0];
    expect(planeHeight(n, [1, 1, 0], 1, 0)).toBeCloseTo(1);
    expect(planeHeight(n, [1, 1, 0], 2, 0)).toBeCloseTo(2);
    expect(planeHeight(n, [1, 1, 0], 0.5, 3)).toBeCloseTo(0.5);
  });

  it('asentada: vertical, sin hueco bajo la base y con la cima a la altura del punto más alto', () => {
    const n: Vec3 = [-s, s, 0];
    const [seated] = seatOnSlope(cube(0.5), n, [1, 1, 0], [1.25, 0]);
    expect(seated).toBeDefined();
    // Toda la pieza queda del lado de fuera del plano (y = x): y − x ≥ 0.
    for (const p of seated.faces.flat()) expect(p[1] - p[0]).toBeGreaterThan(-1e-6);
    // Huella 0,5 sobre una pendiente de 45°: sube 0,5; la cima queda 0,5 sobre el punto más alto de la base.
    const box = boundsOf([seated])!;
    expect(box.max[1]).toBeCloseTo(1.5 + 0.5, 6); // x = 1,5 → plano 1,5; + alto 0,5
    // Es más grande que el cubito (se rellenó hacia abajo) pero no que un cubo entero.
    expect(volume(seated)).toBeGreaterThan(0.125);
    expect(volume(seated)).toBeLessThan(0.5);
  });

  it('asentada sobre una pendiente casi plana apenas añade volumen', () => {
    const n: Vec3 = [-0.01, 0.99995, 0];
    const [seated] = seatOnSlope(cube(0.5), n, [1, 1, 0], [1, 0]);
    expect(volume(seated)).toBeCloseTo(0.125, 2);
  });

  it('perpendicular: la base queda centrada en el punto y la pieza apunta como la normal', () => {
    const n: Vec3 = [-s, s, 0];
    const [stood] = standOnSlope(cube(0.5), n, [1, 1, 0]);
    expect(volume(stood)).toBeCloseTo(0.125, 6);
    const pts = stood.faces.flat();
    const centroid = [0, 1, 2].map((i) => pts.reduce((sum, p) => sum + p[i], 0) / pts.length);
    // El centro queda a media altura sobre el punto, en la dirección de la normal.
    expect(centroid[0]).toBeCloseTo(1 + n[0] * 0.25, 6);
    expect(centroid[1]).toBeCloseTo(1 + n[1] * 0.25, 6);
    // Nada atraviesa el plano de la pendiente.
    for (const p of pts) expect(-s * (p[0] - 1) + s * (p[1] - 1)).toBeGreaterThan(-1e-6);
  });
});
