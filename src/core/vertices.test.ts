import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { isConvex } from './convex';
import { floodFill, textureOfFace, withFaceTexture } from './pixels';
import { FACE_DOUBLE, FACE_UNLIT, faceNormal, volume, type Vec3 } from './piece';
import { sampleTexture, pointOf, uvOf } from './texture';
import { addFace, deleteFaces, deleteVertices, extrudeFaces, facesWithin, flipFaces, mergeVertices, moveVertices, placeVertices, rotateAbout, scaleAbout, setFaceFlags, splitEdge, taperPoint, twistPoint, bendPoint, uniqueVertices, vertexKey } from './vertices';

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

describe('caras', () => {
  const topFace = (piece = cube()) => piece.faces.findIndex((f) => f.every((p) => p[1] === topCorner(piece)[1]));
  const keysOfFace = (piece: ReturnType<typeof cube>, index: number) => new Set(piece.faces[index].map(vertexKey));

  it('facesWithin encuentra las caras cuyos vértices están todos elegidos', () => {
    const piece = cube();
    const top = topFace(piece);
    expect(facesWithin(piece, keysOfFace(piece, top))).toEqual([top]);
    expect(facesWithin(piece, keysOf(topCorner(piece)))).toEqual([]);
  });

  it('borrar una cara abre la pieza y volver a crearla la cierra con la normal hacia fuera', () => {
    const piece = cube();
    const top = topFace(piece);
    const open = deleteFaces(piece, new Set([top]))!;
    expect(open.faces).toHaveLength(5);
    const closed = addFace(open, keysOfFace(piece, top))!;
    expect(closed.faces).toHaveLength(6);
    expect(isConvex(closed)).toBe(true);
    expect(volume(closed)).toBeCloseTo(volume(piece), 9);
  });

  it('no crea una cara que ya existe ni con menos de tres vértices', () => {
    const piece = cube();
    expect(addFace(piece, keysOfFace(piece, topFace(piece)))).toBeNull();
    expect(addFace(piece, keysOf(topCorner(piece)))).toBeNull();
  });

  it('invertir una cara da la vuelta a su normal', () => {
    const piece = cube();
    const top = topFace(piece);
    const flipped = flipFaces(piece, new Set([top]))!;
    expect(faceNormal(flipped.faces[top])[1]).toBeLessThan(0);
    expect(faceNormal(piece.faces[top])[1]).toBeGreaterThan(0);
  });

  it('un vértice sobre una arista entra en las dos caras que la comparten', () => {
    const piece = cube();
    const a = topCorner(piece);
    const b = piece.faces.flat().find((p) => p[1] === a[1] && p[0] !== a[0] && p[2] === a[2])!;
    const { piece: split, vertex } = splitEdge(piece, a, b, 0.5)!;
    expect(uniqueVertices(split)).toHaveLength(9);
    expect(split.faces.filter((f) => f.some((p) => vertexKey(p) === vertexKey(vertex)))).toHaveLength(2);
    expect(splitEdge(piece, a, b, 0)).toBeNull();
  });

  it('extruir una cara sube sus vértices y cierra las paredes', () => {
    const piece = cube();
    const top = topFace(piece);
    const result = extrudeFaces(piece, new Set([top]), 0.5)!;
    expect(result.piece.faces).toHaveLength(6 + 4);
    expect(result.keys.size).toBe(4);
    expect(uniqueVertices(result.piece)).toHaveLength(12);
    expect(volume(result.piece)).toBeCloseTo(volume(piece) + 0.5, 9);
    expect(isConvex(result.piece)).toBe(true);
  });

  it('extruir hacia dentro cava y deja una malla libre', () => {
    const piece = cube();
    const result = extrudeFaces(piece, new Set([topFace(piece)]), -0.3)!;
    expect(volume(result.piece)).toBeCloseTo(volume(piece) - 0.3, 9);
  });
});

describe('propiedades de cara', () => {
  const top = (piece: ReturnType<typeof cube>) => piece.faces.findIndex((f) => f.every((p) => p[1] === topCorner(piece)[1]));

  it('setFaceFlags pone y quita un bit solo en las caras indicadas', () => {
    const piece = cube();
    const on = setFaceFlags(piece, new Set([top(piece)]), FACE_DOUBLE, true)!;
    expect(on.faceFlags!.filter((f) => f === FACE_DOUBLE)).toHaveLength(1);
    expect(on.faceFlags![top(piece)]).toBe(FACE_DOUBLE);
    expect(setFaceFlags(on, new Set([top(piece)]), FACE_DOUBLE, true)).toBeNull();
    const off = setFaceFlags(on, new Set([top(piece)]), FACE_DOUBLE, false)!;
    expect(off.faceFlags).toBeUndefined();
  });

  it('los bits se suman y no se pisan', () => {
    const piece = cube();
    const both = setFaceFlags(setFaceFlags(piece, new Set([0]), FACE_DOUBLE, true)!, new Set([0]), FACE_UNLIT, true)!;
    expect(both.faceFlags![0]).toBe(FACE_DOUBLE | FACE_UNLIT);
  });

  it('las propiedades siguen a su cara al mover vértices y al extruir', () => {
    const piece = setFaceFlags(cube(), new Set([top(cube())]), FACE_UNLIT, true)!;
    const index = top(piece);
    const moved = moveVertices(piece, keysOf(topCorner(piece)), [0, 0.2, 0])!;
    expect(moved.faceFlags![index]).toBe(FACE_UNLIT);
    const extruded = extrudeFaces(piece, new Set([index]), 0.5)!;
    expect(extruded.piece.faceFlags!.filter((f) => f === FACE_UNLIT).length).toBe(5);
  });
});

describe('girar y escalar vértices', () => {
  it('girar 90° alrededor de Y lleva (1,0,0) a (0,0,-1)', () => {
    const r = rotateAbout([1, 0, 0], [0, 0, 0], [0, 1, 0], Math.PI / 2);
    expect(r[0]).toBeCloseTo(0, 9);
    expect(r[2]).toBeCloseTo(-1, 9);
  });

  it('el pivote no se mueve y las distancias se conservan', () => {
    const pivot: Vec3 = [2, 1, 3];
    expect(rotateAbout(pivot, pivot, [0, 0, 1], 1.1)).toEqual(pivot);
    const p: Vec3 = [4, 1, 3];
    const r = rotateAbout(p, pivot, [0, 1, 0], 0.7);
    expect(Math.hypot(r[0] - 2, r[1] - 1, r[2] - 3)).toBeCloseTo(2, 9);
  });

  it('escalar respecto a un pivote deja el pivote quieto', () => {
    expect(scaleAbout([3, 1, 1], [1, 1, 1], [2, 1, 1])).toEqual([5, 1, 1]);
    expect(scaleAbout([1, 1, 1], [1, 1, 1], [3, 3, 3])).toEqual([1, 1, 1]);
  });

  it('girar un cubo 90° con placeVertices lo deja igual de grande', () => {
    const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
    const keys = new Set(uniqueVertices(cube).map(vertexKey));
    const turned = placeVertices(cube, keys, (p) => rotateAbout(p, [0.5, 0.5, 0.5], [0, 1, 0], Math.PI / 2), true)!;
    const xs = uniqueVertices(turned).map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 6);
  });
});

describe('afinar y torcer', () => {
  const pivot: Vec3 = [0, 0, 0];
  it('afinar deja la sección del centro y escala los extremos', () => {
    expect(taperPoint([1, 0, 1], pivot, 1, 1, 0.5)).toEqual([1, 0, 1]);
    expect(taperPoint([1, 1, 0], pivot, 1, 1, 0.5)).toEqual([1.5, 1, 0]);
    expect(taperPoint([1, -1, 0], pivot, 1, 1, 0.5)).toEqual([0.5, -1, 0]);
  });

  it('afinar con un valor extremo no da escala negativa', () => {
    expect(taperPoint([1, 1, 0], pivot, 1, 1, -2)[0]).toBe(0);
  });

  it('torcer gira los extremos en sentidos opuestos y no mueve el centro ni el eje', () => {
    const top = twistPoint([1, 1, 0], pivot, 1, 1, 0.5);
    const bottom = twistPoint([1, -1, 0], pivot, 1, 1, 0.5);
    expect(top[1]).toBe(1);
    expect(top[0]).toBeCloseTo(0, 9);
    expect(top[2]).toBeCloseTo(-1, 9);
    expect(bottom[2]).toBeCloseTo(1, 9);
    expect(twistPoint([1, 0, 0], pivot, 1, 1, 0.5)[0]).toBeCloseTo(1, 9);
    expect(twistPoint([0, 1, 0], pivot, 1, 1, 0.5)).toEqual([0, 1, 0]);
  });
});

describe('curvar', () => {
  const pivot: Vec3 = [0, 0, 0];
  it('un valor cero no mueve nada y el centro se queda quieto', () => {
    expect(bendPoint([1, 1, 0], pivot, 1, 1, 0)).toEqual([1, 1, 0]);
    const c = bendPoint([0, 0, 0], pivot, 1, 1, 1);
    expect(c.every((v) => Math.abs(v) < 1e-9)).toBe(true);
  });

  it('el extremo del eje se dobla un cuarto de vuelta hacia el eje siguiente con amount 1', () => {
    // Y se dobla hacia Z: radio = half / (π/2); el extremo (y=1) queda en y = R, z = R.
    const r = 1 / (Math.PI / 2);
    const end = bendPoint([0, 1, 0], pivot, 1, 1, 1);
    expect(end[1]).toBeCloseTo(r, 9);
    expect(end[2]).toBeCloseTo(r, 9);
  });

  it('conserva la distancia de cada punto al eje curvado', () => {
    const r = 1 / (Math.PI / 2);
    const p = bendPoint([0, 1, 0.2], pivot, 1, 1, 1);
    // El centro de curvatura está en z = R; el punto estaba a R − 0.2 de él.
    expect(Math.hypot(p[1], p[2] - r)).toBeCloseTo(r - 0.2, 9);
  });
});
