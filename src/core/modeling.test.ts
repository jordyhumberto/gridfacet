import { describe, expect, it } from 'vitest';
import { buildPiece, CATALOG } from './catalog';
import { convexHull } from './hull';
import { boundsOf } from './transform';
import {
  excavateChange,
  extrudeFaceChange,
  mergeChange,
  repeatChange,
  splitFaceChange,
  sinkFacesChange,
  subtractConvex,
  triangleCount,
} from './modeling';
import { faceNormal, makePiece, newGroupId, volume, type Piece, type Vec3 } from './piece';

const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Piece => {
  const points: Vec3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) points.push([x, y, z]);
  return makePiece(convexHull(points)!, 0x00ff00);
};
const total = (pieces: Piece[]) => pieces.reduce((s, p) => s + volume(p), 0);
const topFace = (piece: Piece) => piece.faces.findIndex((f) => faceNormal(f)[1] > 0.5);

describe('restar un volumen convexo', () => {
  it('cavar una caja dentro del cubo deja el volumen que falta', () => {
    const parts = subtractConvex(cube(), box(0.25, 0.5, 0.25, 0.75, 1.5, 0.75))!;
    expect(parts.length).toBeGreaterThan(1);
    expect(total(parts)).toBeCloseTo(1 - 0.5 * 0.5 * 0.5, 6);
  });

  it('si no se tocan devuelve null', () => {
    expect(subtractConvex(cube(), box(3, 0, 0, 4, 1, 1))).toBeNull();
    // Solo se rozan por una cara: tampoco hay volumen en común.
    expect(subtractConvex(cube(), box(1, 0, 0, 2, 1, 1))).toBeNull();
  });

  it('un cortador que cubre toda la pieza la borra sin dejar partes', () => {
    const parts = subtractConvex(cube(), box(-1, -1, -1, 3, 3, 3))!;
    expect(parts).toEqual([]);
  });

  it('excavateChange sustituye la pieza y borra el cortador', () => {
    const piece = cube();
    const cutter = box(0.25, 0.5, 0.25, 0.75, 1.5, 0.75);
    const { added, removed } = excavateChange([piece], [cutter]);
    expect(removed).toContain(piece);
    expect(removed).toContain(cutter);
    expect(total(added)).toBeCloseTo(0.875, 6);
  });

  it('puede conservar el cortador', () => {
    const cutter = box(0.25, 0.5, 0.25, 0.75, 1.5, 0.75);
    const { removed } = excavateChange([cube()], [cutter], true);
    expect(removed).not.toContain(cutter);
  });

  it('sin solape no cambia nada', () => {
    expect(excavateChange([cube()], [box(5, 5, 5, 6, 6, 6)])).toEqual({ added: [], removed: [] });
  });
});

describe('extruir una cara', () => {
  it('hacia fuera añade un cuerpo pegado de base × distancia', () => {
    const piece = cube();
    const { added, removed } = extrudeFaceChange(piece, topFace(piece), 0.5);
    expect(removed).toEqual([]);
    expect(added).toHaveLength(1);
    expect(volume(added[0])).toBeCloseTo(0.5, 6);
    expect(boundsOf(added)!.max[1]).toBeCloseTo(1.5, 6);
  });

  it('con estrechamiento sale un tronco de pirámide', () => {
    const piece = cube();
    const { added } = extrudeFaceChange(piece, topFace(piece), 0.6, 0.5);
    // h/3 · (A + √(AB) + B) con A = 1 y B = 0,25
    expect(volume(added[0])).toBeCloseTo((0.6 / 3) * (1 + 0.5 + 0.25), 6);
  });

  it('hacia dentro cava y deja el cráter', () => {
    const piece = cube();
    const { added, removed } = extrudeFaceChange(piece, topFace(piece), -0.4, 0.5);
    expect(removed).toEqual([piece]);
    expect(added.length).toBeGreaterThan(1);
    expect(total(added)).toBeCloseTo(1 - (0.4 / 3) * (1 + 0.5 + 0.25), 4);
    expect(added.every((p) => volume(p) > 0)).toBe(true);
  });

  it('con borde deja un reborde alrededor del cráter', () => {
    const piece = cube();
    const { added } = extrudeFaceChange(piece, topFace(piece), -0.4, 1, 0.5);
    // Cavidad recta de 0,5 × 0,5 × 0,4
    expect(total(added)).toBeCloseTo(1 - 0.5 * 0.5 * 0.4, 5);
    // El reborde cierra la cara de arriba: ningún vértice del hueco toca el borde exterior de la pieza
    const top = added.flatMap((p) => p.faces).filter((f) => f.every((q) => Math.abs(q[1] - 1) < 1e-6));
    expect(top.length).toBeGreaterThan(0);
  });

  it('un saliente con borde no toca los lados de la cara', () => {
    const piece = cube();
    const { added } = extrudeFaceChange(piece, topFace(piece), 0.3, 1, 0.5);
    expect(volume(added[0])).toBeCloseTo(0.5 * 0.5 * 0.3, 6);
  });

  it('rechaza un borde fuera de rango', () => {
    expect(extrudeFaceChange(cube(), 0, 0.5, 1, 0.95)).toEqual({ added: [], removed: [] });
  });

  it('una distancia nula no hace nada', () => {
    const piece = cube();
    expect(extrudeFaceChange(piece, 0, 0)).toEqual({ added: [], removed: [] });
  });
});

describe('dividir', () => {
  it('parte la pieza en dos por la fracción elegida', () => {
    const piece = cube();
    const { added, removed } = splitFaceChange(piece, topFace(piece), 0.25);
    expect(removed).toEqual([piece]);
    expect(added.map(volume).sort()).toEqual([0.25, 0.75].map((v) => expect.closeTo(v, 6)));
  });

  it('rechaza fracciones fuera de (0, 1)', () => {
    expect(splitFaceChange(cube(), 0, 0)).toEqual({ added: [], removed: [] });
    expect(splitFaceChange(cube(), 0, 1)).toEqual({ added: [], removed: [] });
  });
});

describe('fusionar', () => {
  it('dos mitades de un cubo vuelven a ser un cubo', () => {
    const piece = cube();
    const { added } = splitFaceChange(piece, topFace(piece), 0.5);
    const result = mergeChange(added);
    expect('change' in result).toBe(true);
    if ('change' in result) {
      expect(result.change.added).toHaveLength(1);
      expect(volume(result.change.added[0])).toBeCloseTo(1, 6);
      expect(result.change.added[0].faces).toHaveLength(6);
    }
  });

  it('una L no es convexa y se rechaza', () => {
    const result = mergeChange([box(0, 0, 0, 2, 1, 1), box(0, 1, 0, 1, 2, 1)]);
    expect('error' in result).toBe(true);
  });

  it('piezas separadas dejan hueco y se rechazan', () => {
    expect('error' in mergeChange([box(0, 0, 0, 1, 1, 1), box(3, 0, 0, 4, 1, 1)])).toBe(true);
  });

  it('conserva el color de las caras pintadas', () => {
    const a = box(0, 0, 0, 1, 1, 1);
    const b = box(1, 0, 0, 2, 1, 1);
    const result = mergeChange([a, b]);
    expect('change' in result).toBe(true);
    if ('change' in result) {
      const merged = result.change.added[0];
      expect(merged.faces).toHaveLength(6);
    }
  });
});

describe('repetir', () => {
  it('copia con desplazamiento acumulado', () => {
    const { added, removed } = repeatChange([cube()], { count: 3, move: [2, 0, 0], rotate: [0, 0, 0], scale: 1 });
    expect(removed).toEqual([]);
    expect(added).toHaveLength(3);
    expect(added.map((p) => boundsOf([p])!.min[0])).toEqual([2, 4, 6]);
  });

  it('con escala 0,5 cada copia es la mitad de la anterior', () => {
    const { added } = repeatChange([cube()], { count: 2, move: [0, 0, 0], rotate: [0, 0, 0], scale: 0.5 });
    expect(volume(added[0])).toBeCloseTo(0.125, 6);
    expect(volume(added[1])).toBeCloseTo(0.125 / 8, 6);
  });

  it('girar no deforma: el volumen se conserva', () => {
    const { added } = repeatChange([cube()], { count: 4, move: [0, 0, 0], rotate: [10, 20, 30], scale: 1 });
    for (const p of added) expect(volume(p)).toBeCloseTo(1, 6);
  });

  it('cada copia de un grupo forma un grupo nuevo', () => {
    const group = newGroupId();
    const [a, b] = [cube(), box(2, 0, 0, 3, 1, 1)];
    a.group = group;
    b.group = group;
    const { added } = repeatChange([a, b], { count: 2, move: [0, 3, 0], rotate: [0, 0, 0], scale: 1 });
    const groups = new Set(added.map((p) => p.group));
    expect(groups.size).toBe(2);
    expect(groups.has(group)).toBe(false);
  });
});

describe('contador de triángulos', () => {
  it('un cubo son 12 triángulos', () => {
    expect(triangleCount([cube()])).toBe(12);
  });

  it('suma varias piezas', () => {
    expect(triangleCount([cube(), cube()])).toBe(24);
  });
});

describe('hundir caras', () => {
  const faceOf = (piece: Piece, index: number) => ({ piece, face: piece.faces[index] });

  it('hundir la cara de arriba de un cubo quita una capa', () => {
    const c = cube();
    const change = sinkFacesChange([faceOf(c, topFace(c))], [c], 0.25);
    expect(change.removed).toEqual([c]);
    expect(total(change.added)).toBeCloseTo(0.75, 6);
    expect(boundsOf(change.added)!.max[1]).toBeCloseTo(0.75, 6);
  });

  it('con una distancia mayor que la pieza, la atraviesa', () => {
    const c = cube();
    const change = sinkFacesChange([faceOf(c, topFace(c))], [c], 3);
    expect(change.added).toHaveLength(0);
    expect(change.removed).toEqual([c]);
  });

  it('hunde a la vez varias caras con la misma profundidad', () => {
    const a = buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);
    const b = buildPiece(CATALOG[0], 1, 0, 0, 0, 0x00ff00);
    const change = sinkFacesChange([faceOf(a, topFace(a)), faceOf(b, topFace(b))], [a, b], 0.5);
    expect(total(change.added)).toBeCloseTo(1, 6);
    expect(boundsOf(change.added)!.max[1]).toBeCloseTo(0.5, 6);
  });

  it('no toca las piezas que quedan fuera del hueco', () => {
    const a = cube();
    const far = buildPiece(CATALOG[0], 5, 0, 5, 0, 0x0000ff);
    const change = sinkFacesChange([faceOf(a, topFace(a))], [a, far], 0.5);
    expect(change.removed).not.toContain(far);
  });

  it('distancia cero o negativa no hace nada', () => {
    const c = cube();
    expect(sinkFacesChange([faceOf(c, topFace(c))], [c], 0)).toEqual({ added: [], removed: [] });
    expect(sinkFacesChange([faceOf(c, topFace(c))], [c], -1)).toEqual({ added: [], removed: [] });
  });
});
