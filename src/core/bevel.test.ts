import { describe, expect, it } from 'vitest';
import { bevelChange, bevelPlane, edgeBetween, nearestEdge, pieceEdges } from './bevel';
import { buildPiece, CATALOG } from './catalog';
import { volume } from './piece';

const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);

describe('chaflán', () => {
  it('un cubo tiene 12 aristas, cada una con dos caras', () => {
    const edges = pieceEdges(cube());
    expect(edges).toHaveLength(12);
    expect(edges.every((e) => e.faces.length === 2)).toBe(true);
  });

  it('encuentra la arista más cercana al punto', () => {
    const edge = nearestEdge(cube(), [1, 1, 0.5], 0.3)!;
    const ends = [edge.a, edge.b].map((p) => p.join(','));
    expect(ends).toContain('1,1,0');
    expect(ends).toContain('1,1,1');
    expect(nearestEdge(cube(), [0.5, 0.5, 0.5], 0.1)).toBeNull();
  });

  it('cortar una arista con lado d quita un prisma triangular de volumen d²/2 × largo', () => {
    const piece = cube();
    const edge = nearestEdge(piece, [1, 1, 0.5])!;
    const { added, removed } = bevelChange(piece, edge, 0.25);
    expect(removed).toEqual([piece]);
    expect(added).toHaveLength(1);
    expect(volume(added[0])).toBeCloseTo(volume(piece) - (0.25 * 0.25) / 2 * 1, 6);
    expect(added[0].faces).toHaveLength(7);
  });

  it('el plano mira hacia fuera: la esquina cortada queda fuera y el centro dentro', () => {
    const piece = cube();
    const edge = nearestEdge(piece, [0, 0, 0.5])!;
    const plane = bevelPlane(edge, 0.3)!;
    const side = (p: number[]) => plane.n[0] * p[0] + plane.n[1] * p[1] + plane.n[2] * p[2] - plane.d;
    expect(side([0.5, 0.5, 0.5])).toBeLessThan(0);
    expect(side([0, 0, 0.5])).toBeGreaterThan(0);
  });

  it('edgeBetween encuentra la arista aunque se den los extremos al revés', () => {
    expect(edgeBetween(cube(), [1, 1, 1], [1, 1, 0])).not.toBeNull();
    expect(edgeBetween(cube(), [0.5, 0, 0], [1, 1, 1])).toBeNull();
  });

  it('un lado demasiado grande no destruye la pieza', () => {
    const piece = cube();
    const edge = nearestEdge(piece, [1, 1, 0.5])!;
    const { added } = bevelChange(piece, edge, 0.9);
    expect(added.length === 0 || volume(added[0]) > 0).toBe(true);
  });
});
