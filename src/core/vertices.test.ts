import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { isConvex } from './convex';
import { floodFill, textureOfFace, withFaceTexture } from './pixels';
import type { Vec3 } from './piece';
import { sampleTexture, pointOf, uvOf } from './texture';
import { deleteVertices, mergeVertices, moveVertices, placeVertices, uniqueVertices, vertexKey } from './vertices';

const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
const topCorner = (piece = cube()): Vec3 => {
  const top = Math.max(...piece.faces.flat().map((p) => p[1]));
  return piece.faces.flat().find((p) => p[1] === top)!;
};
const keysOf = (...points: Vec3[]) => new Set(points.map(vertexKey));

describe('uniqueVertices', () => {
  it('un cubo tiene 8 vértices distintos aunque cada uno aparezca en tres caras', () => {
    expect(uniqueVertices(cube())).toHaveLength(8);
  });
});

describe('moveVertices', () => {
  it('todas las caras que comparten el vértice lo siguen y la pieza queda cerrada', () => {
    const piece = cube();
    const corner = topCorner(piece);
    const moved = moveVertices(piece, keysOf(corner), [0, 0.5, 0])!;
    expect(uniqueVertices(moved)).toHaveLength(8);
    expect(moved.faces.flat().filter((p) => p[1] === corner[1] + 0.5)).toHaveLength(3);
    expect(moved.faces.flat().filter((p) => p[1] === corner[1] && p[0] === corner[0] && p[2] === corner[2])).toHaveLength(0);
  });

  it('subir un vértice hacia fuera puede mantener la pieza convexa y hundirlo no', () => {
    const piece = cube();
    const corner = topCorner(piece);
    expect(isConvex(moveVertices(piece, keysOf(corner), [0.3, 0.3, 0.3])!)).toBe(true);
    expect(isConvex(moveVertices(piece, keysOf(corner), [0, -0.6, 0])!)).toBe(false);
  });

  it('la pieza original no se modifica y el id cambia salvo con keepId', () => {
    const piece = cube();
    const corner = topCorner(piece);
    const before = JSON.stringify(piece.faces);
    const copy = moveVertices(piece, keysOf(corner), [0, 1, 0])!;
    expect(JSON.stringify(piece.faces)).toBe(before);
    expect(copy.id).not.toBe(piece.id);
    expect(moveVertices(piece, keysOf(corner), [0, 1, 0], true)!.id).toBe(piece.id);
  });

  it('los píxeles pintados se quedan pegados a la superficie al estirar una cara', () => {
    let piece = cube();
    const top = piece.faces.findIndex((f) => f.every((p) => p[1] === topCorner(piece)[1]));
    const texture = textureOfFace(piece, top);
    floodFill(texture, 0, 0, 0xff0000);
    piece = withFaceTexture(piece, top, texture);
    const corner = topCorner(piece);
    const moved = moveVertices(piece, keysOf(corner), [0, 0, 0.0])!;
    // Sin desplazamiento real la textura se conserva tal cual.
    expect(moved.faceTextures![top]!.pixels).toEqual(texture.pixels);
    const stretched = moveVertices(piece, new Set(piece.faces[top].map(vertexKey)), [0, 0.5, 0])!;
    const target = stretched.faceTextures![top]!;
    const q = pointOf(stretched.faces[top], 0.5, 0.5);
    const [s, t] = uvOf(stretched.faces[top], q);
    expect(sampleTexture(target, s, t)).toBe(0xff0000);
  });
});

describe('placeVertices', () => {
  it('lleva cada vértice elegido al punto que dice la función', () => {
    const piece = cube();
    const corner = topCorner(piece);
    const snapped = placeVertices(piece, keysOf(corner), () => [5, 5, 5])!;
    expect(snapped.faces.flat().filter((p) => p[0] === 5 && p[1] === 5 && p[2] === 5)).toHaveLength(3);
  });
});

describe('mergeVertices', () => {
  it('juntar dos vértices de una arista quita la cara que se queda sin superficie', () => {
    const piece = cube();
    const a = topCorner(piece);
    const b = piece.faces.flat().find((p) => p[1] === a[1] && p[0] !== a[0] && p[2] === a[2])!;
    const merged = mergeVertices(piece, keysOf(a, b))!;
    expect(uniqueVertices(merged)).toHaveLength(7);
    expect(merged.faces.every((f) => f.length >= 3)).toBe(true);
  });

  it('con un solo vértice no hace nada', () => {
    expect(mergeVertices(cube(), keysOf(topCorner()))).toBeNull();
  });
});

describe('deleteVertices', () => {
  it('quitar un vértice deja las caras que lo usaban con uno menos', () => {
    const piece = cube();
    const result = deleteVertices(piece, keysOf(topCorner(piece)))!;
    expect(uniqueVertices(result)).toHaveLength(7);
    expect(result.faces.some((f) => f.length === 3)).toBe(true);
  });

  it('quitar todos los vértices no deja pieza', () => {
    const piece = cube();
    expect(deleteVertices(piece, new Set(uniqueVertices(piece).map(vertexKey)))).toBeNull();
  });
});
