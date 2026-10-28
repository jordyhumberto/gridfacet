import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece, buildPieces } from './catalog';
import { mergeCoplanar } from './merge';
import { faceNormal, makePiece, type Piece, type Vec3 } from './piece';
import { translatePiece } from './transform';
import { unionSurface, type SurfaceFace } from './union';

const cube = (x = 0, y = 0, z = 0, color = 0xff0000): Piece => buildPiece(CATALOG[0], x, y * 3, z, 0, color);
const merged = (pieces: Piece[]): SurfaceFace[] => mergeCoplanar(unionSurface(pieces));

const area = (faces: SurfaceFace[]): number =>
  faces.reduce((sum, { face }) => {
    const n = faceNormal(face);
    return sum + Math.hypot(n[0], n[1], n[2]) / 2;
  }, 0);

const key = (p: Vec3) => p.map((v) => Math.round(v * 1e6)).join(',');

/** Una superficie cerrada recorre cada arista una vez en cada sentido. */
function isWatertight(faces: SurfaceFace[]): boolean {
  const directed = new Map<string, number>();
  for (const { face } of faces) {
    for (let i = 0; i < face.length; i++) {
      const edge = `${key(face[i])}>${key(face[(i + 1) % face.length])}`;
      directed.set(edge, (directed.get(edge) ?? 0) + 1);
    }
  }
  return [...directed].every(([edge, count]) => {
    const [a, b] = edge.split('>');
    return count === 1 && directed.get(`${b}>${a}`) === 1;
  });
}

const vertexCount = (faces: SurfaceFace[]): number => new Set(faces.flatMap(({ face }) => face.map(key))).size;

describe('mergeCoplanar', () => {
  it('una fila de 5 cubos queda como una caja de 12 triángulos y 8 vértices', () => {
    const faces = merged([0, 1, 2, 3, 4].map((x) => cube(x)));
    expect(faces).toHaveLength(12);
    expect(vertexCount(faces)).toBe(8);
    expect(area(faces)).toBeCloseTo(22);
    expect(isWatertight(faces)).toBe(true);
  });

  it('cuatro cubos en cuadrado forman una caja de 12 triángulos', () => {
    const faces = merged([cube(0, 0, 0), cube(1, 0, 0), cube(0, 0, 1), cube(1, 0, 1)]);
    expect(faces).toHaveLength(12);
    expect(area(faces)).toBeCloseTo(16);
    expect(isWatertight(faces)).toBe(true);
  });

  it('dos cubos solapados a media celda son una caja de 1.5 × 1 × 1', () => {
    const faces = merged([cube(0), translatePiece(cube(0), 0.5, 0, 0)]);
    expect(faces).toHaveLength(12);
    expect(area(faces)).toBeCloseTo(8);
    expect(isWatertight(faces)).toBe(true);
  });

  it('conserva la superficie y cierra la malla con una esquina metida en otro cubo', () => {
    const pieces = [cube(0), translatePiece(cube(0), 0.5, 0.5, 0.5)];
    const before = unionSurface(pieces);
    const faces = mergeCoplanar(before);
    expect(area(faces)).toBeCloseTo(area(before));
    expect(faces.length).toBeLessThan(before.length * 2);
    expect(isWatertight(faces)).toBe(true);
  });

  it('un cubo pequeño sobre una cara grande deja un agujero que se triangula bien', () => {
    const small = makePiece(
      cube(0).faces.map((face) => face.map((p) => [p[0] * 0.5 + 0.25, p[1] * 0.5 + 1, p[2] * 0.5 + 0.25] as Vec3)),
      0xff0000,
    );
    const pieces = [cube(0), small];
    const before = unionSurface(pieces);
    const faces = mergeCoplanar(before);
    expect(area(faces)).toBeCloseTo(area(before));
    expect(isWatertight(faces)).toBe(true);
  });

  it('una rampa sobre un cubo conserva la superficie y queda cerrada', () => {
    const pieces = [cube(0), buildPiece(CATALOG[2], 0, 3, 0, 0, 0xff0000)];
    const faces = merged(pieces);
    expect(area(faces)).toBeCloseTo(area(unionSurface(pieces)));
    expect(isWatertight(faces)).toBe(true);
  });

  it.each(['inner', 'arch', 'cylinder', 'outer', 'brick'])('la pieza %s sola exporta como una superficie cerrada', (id) => {
    const def = CATALOG.find((d) => d.id === id)!;
    for (const rotation of [0, 1]) {
      const pieces = buildPieces(def, 0, 0, 0, rotation, 0xff0000);
      const before = unionSurface(pieces);
      const faces = mergeCoplanar(before);
      expect(area(faces)).toBeCloseTo(area(before));
      expect(isWatertight(faces)).toBe(true);
    }
  });

  it('las dos cuñas de la esquina interior se funden sin dejar la cara interior', () => {
    const inner = buildPieces(CATALOG.find((d) => d.id === 'inner')!, 0, 0, 0, 0, 0xff0000);
    // Cada cuña tiene 5 caras y comparten el plano diagonal: la unión pierde esas dos caras.
    expect(unionSurface(inner).length).toBeLessThan(10);
  });

  it('no mezcla colores distintos', () => {
    const faces = merged([cube(0, 0, 0, 0xff0000), cube(1, 0, 0, 0x0000ff)]);
    expect(new Set(faces.map((f) => f.color))).toEqual(new Set([0xff0000, 0x0000ff]));
    expect(area(faces)).toBeCloseTo(10);
    expect(isWatertight(faces)).toBe(true);
  });

  it('las caras salen con la normal hacia fuera', () => {
    const faces = merged([cube(0), cube(1)]);
    for (const { face } of faces) {
      const n = faceNormal(face);
      const center = face[0];
      // El centro de la caja es (1, 0.5, 0.5); la normal debe alejarse de él.
      const out = [center[0] - 1, center[1] - 0.5, center[2] - 0.5];
      expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
    }
  });
});
