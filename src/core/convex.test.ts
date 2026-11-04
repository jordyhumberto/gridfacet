import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { isConvex, splitConvex, triangulateFace } from './convex';
import { buildExportMeshes } from './export';
import { FACE_BEHIND, makePiece, type Piece, type Vec3 } from './piece';

const cube = (x = 0) => buildPiece(CATALOG[0], x, 0, 0, 0, 0x336699);

const area = (face: Vec3[], triangles: [number, number, number][]): number =>
  triangles.reduce((sum, [a, b, c]) => {
    const u = [face[b][0] - face[a][0], face[b][1] - face[a][1], face[b][2] - face[a][2]];
    const v = [face[c][0] - face[a][0], face[c][1] - face[a][1], face[c][2] - face[a][2]];
    return sum + Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }, 0);

/** Cubo con un vértice de la cara superior hundido hacia dentro: ya no es convexo. */
function dentedCube(): Piece {
  const base = cube();
  const top = Math.max(...base.faces.flat().map((p) => p[1]));
  const corner = base.faces.flat().find((p) => p[1] === top)!;
  const moved = base.faces.map((face) => face.map((p) => (p[0] === corner[0] && p[1] === corner[1] && p[2] === corner[2] ? ([p[0], p[1] - 0.6, p[2]] as Vec3) : p)));
  return makePiece(moved, base.color);
}

describe('isConvex', () => {
  it('los poliedros del catálogo son convexos', () => {
    for (const entry of CATALOG) expect(isConvex(buildPiece(entry, 0, 0, 0, 0, 0xffffff))).toBe(true);
  });

  it('un vértice hundido deja una malla libre', () => {
    expect(isConvex(dentedCube())).toBe(false);
  });

  it('separa las piezas convexas de las libres', () => {
    const { convex, free } = splitConvex([cube(), dentedCube(), cube(3)]);
    expect(convex).toHaveLength(2);
    expect(free).toHaveLength(1);
  });
});

describe('triangulateFace', () => {
  it('una cara convexa se parte en abanico', () => {
    const quad: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    expect(triangulateFace(quad)).toEqual([[0, 1, 2], [0, 2, 3]]);
  });

  it('una cara alabeada con una punta a cada lado sale igual de un lado que de su imagen en espejo', () => {
    // Anillo largo con vértices a media arista subidos (el caso de partir una arista de una pieza simétrica y levantar el punto).
    const ring: Vec3[] = [[-1.25, 2, -0.75], [-1.25, 4, 0], [-1.25, 1, 0.75], [1.25, 1, 0.75], [1.25, 4, 0], [1.25, 2, -0.75]];
    const mirror = ring.map((p) => [-p[0], p[1], p[2]] as Vec3).reverse();
    const keys = (face: Vec3[]): string[] => triangulateFace(face).map((t) => t.map((i) => face[i].join(',')).sort().join('|')).sort();
    const mirrored = (k: string): string => k.split('|').map((v) => v.split(',').map(Number)).map(([x, y, z]) => [-x, y, z].join(',')).sort().join('|');
    const original = keys(ring);
    const reflected = keys(mirror);
    // Cada punta tiene su propio triángulo, y las dos son una imagen de la otra.
    const spikes = original.filter((t) => t.includes('-1.25,4,0') || t.includes('1.25,4,0'));
    expect(spikes).toHaveLength(2);
    expect(spikes.map(mirrored).sort()).toEqual([...spikes].sort());
    // Empezar a contar por otro vértice no cambia el resultado.
    const turned = [...ring.slice(3), ...ring.slice(0, 3)];
    expect(keys(turned)).toEqual(original);
    expect(reflected.filter((t) => t.includes('4,0'))).toHaveLength(2);
  });

  it('al subir una punta más que la otra no queda ningún triángulo dado la vuelta', () => {
    // La cara de arriba de un cubo con un vértice a media arista en cada lado; una punta sube mucho más que la otra.
    const facing = (face: Vec3[]): number[] => {
      const normal: Vec3 = [0, 0, 0];
      face.forEach((a, i) => {
        const b = face[(i + 1) % face.length];
        normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
        normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
        normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
      });
      return triangulateFace(face).map(([i, j, k]) => {
        const u = face[j].map((v, n) => v - face[i][n]);
        const w = face[k].map((v, n) => v - face[i][n]);
        const cross = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        return cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2];
      });
    };
    for (const [left, right] of [[1.75, 1.75], [3.75, 1.75], [1.75, 4], [6, 1.25]]) {
      const ring: Vec3[] = [[-0.5, 1, -0.5], [-0.5, left, 0], [-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, right, 0], [0.5, 1, -0.5]];
      expect(facing(ring).filter((value) => value < -1e-9)).toEqual([]);
    }
  });

  it('al bajar los dos puntos de una cara, la superficie sigue siendo un valle y no salta a una tapa plana con paredes', () => {
    for (const d of [0.75, 0.5, 0.25, 0, -0.5, -1, -2]) {
      const ring: Vec3[] = [[-0.5, 1, -0.5], [-0.5, d, 0], [-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, d, 0], [0.5, 1, -0.5]];
      // El valle une los dos puntos hundidos (vértices 1 y 4) con una arista.
      const joined = triangulateFace(ring).some((t) => t.includes(1) && t.includes(4) && t.filter((i) => i === 1 || i === 4).length === 2);
      expect(joined).toBe(true);
    }
  });

  it('una cara en L cubre exactamente su área, sin tapar el hueco', () => {
    // L de área 3: cuadrado de 2×2 sin el cuadrante superior derecho.
    const l: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]];
    const triangles = triangulateFace(l);
    expect(triangles).toHaveLength(4);
    expect(area(l, triangles)).toBeCloseTo(3, 9);
  });

  it('funciona con la cara orientada en cualquier plano', () => {
    const l: Vec3[] = [[0, 0, 0], [0, 0, 2], [0, 1, 2], [0, 1, 1], [0, 2, 1], [0, 2, 0]];
    expect(area(l, triangulateFace(l))).toBeCloseTo(3, 9);
  });

  it('no pierde una cara degenerada', () => {
    const line: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
    expect(triangulateFace(line).length).toBeGreaterThan(0);
  });
});

describe('exportar mallas libres', () => {
  it('la unión por color incluye las caras de una malla libre', () => {
    const meshes = buildExportMeshes([cube(), dentedCube()], 'merged');
    const triangles = meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
    expect(triangles).toBeGreaterThan(12);
  });
});

describe('exportar propiedades de cara', () => {
  const flagged = (flags: number): Piece => {
    const base = cube();
    return makePiece(base.faces, base.color, undefined, undefined, base.faces.map((_, i) => (i === 0 ? flags : 0)));
  };

  it('las caras con propiedades salen en su propia malla con las propiedades', () => {
    const meshes = buildExportMeshes([flagged(1)], 'perPiece');
    expect(meshes).toHaveLength(2);
    expect(meshes.find((m) => m.flags === 1)?.indices.length).toBe(6);
    expect(meshes.find((m) => !m.flags)).toBeDefined();
  });

  it('la unión por color no pierde las propiedades', () => {
    const meshes = buildExportMeshes([flagged(2), cube(5)], 'merged');
    expect(meshes.some((m) => m.flags === 2)).toBe(true);
  });
});

describe('al fondo no viaja a los archivos', () => {
  it('una cara solo «al fondo» no parte la malla ni evita la unión', () => {
    const base = cube();
    const behind = makePiece(base.faces, base.color, undefined, undefined, base.faces.map((_, i) => (i === 0 ? FACE_BEHIND : 0)));
    const meshes = buildExportMeshes([behind], 'perPiece');
    expect(meshes).toHaveLength(1);
    expect(meshes[0].flags).toBeUndefined();
    expect(buildExportMeshes([behind, cube(5)], 'merged')).toHaveLength(1);
  });
});
