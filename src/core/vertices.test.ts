import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { isConvex } from './convex';
import { collapses } from './selfIntersect';
import { floodFill, textureOfFace, withFaceTexture } from './pixels';
import { FACE_DOUBLE, FACE_UNLIT, faceNormal, makePiece, volume, type Vec3 } from './piece';import { sampleTexture, pointOf, uvOf } from './texture';
import { addMirrorPairOnFace, connectVertices, dissolveEdge, slideSegment, extrudeEdge, finFaces, flagFins, splitFacesAtCenter, addFace, deleteFaces, deleteVertices, extrudeFaces, facesWithin, flipFaces, mergeVertices, moveVertices, placeVertices, rotateAbout, scaleAbout, setFaceFlags, splitEdge, addVertexOnFace, taperPoint, twistPoint, bendPoint, uniqueVertices, vertexKey } from './vertices';

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

  // Tetraedro sin la base: A, B, C en el suelo y D arriba. `sign` 1 = caras hacia fuera, -1 = hacia dentro.
  const tetraWithoutBase = (sign: 1 | -1) => {
    const A: Vec3 = [0, 0, 0];
    const B: Vec3 = [1, 0, 0];
    const C: Vec3 = [0, 0, 1];
    const D: Vec3 = [0, 1, 0];
    const centre: Vec3 = [0.25, 0.25, 0.25];
    const outward = (face: Vec3[]): Vec3[] => {
      const n = faceNormal(face);
      const mid = face.reduce((s, p) => [s[0] + p[0] / face.length, s[1] + p[1] / face.length, s[2] + p[2] / face.length], [0, 0, 0]);
      const out = n[0] * (mid[0] - centre[0]) + n[1] * (mid[1] - centre[1]) + n[2] * (mid[2] - centre[2]);
      return (out > 0) === (sign === 1) ? face : [...face].reverse();
    };
    return { piece: makePiece([outward([A, B, D]), outward([B, C, D]), outward([C, A, D])], 0x336699), keys: keysOf(A, B, C) };
  };

  it('con tres vértices crea un triángulo con esos tres vértices', () => {
    const { piece, keys } = tetraWithoutBase(1);
    const closed = addFace(piece, keys)!;
    expect(closed.faces).toHaveLength(4);
    const added = closed.faces[3];
    expect(added).toHaveLength(3);
    expect(new Set(added.map(vertexKey))).toEqual(keys);
    // La base cierra el tetraedro mirando hacia abajo, igual que las demás miran hacia fuera.
    expect(faceNormal(added)[1]).toBeLessThan(0);
  });

  it('al cerrar un hueco la cara mira hacia el mismo lado que las vecinas, aunque ese lado sea hacia dentro', () => {
    const { piece, keys } = tetraWithoutBase(-1);
    const closed = addFace(piece, keys)!;
    expect(faceNormal(closed.faces[3])[1]).toBeGreaterThan(0);
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

  it('un vértice dentro de una cara la parte en triángulos que salen de él', () => {
    const piece = cube();
    const top = topFace(piece);
    const face = piece.faces[top];
    const centre = face.reduce((sum, p) => [sum[0] + p[0] / face.length, sum[1] + p[1] / face.length, sum[2] + p[2] / face.length], [0, 0, 0]) as [number, number, number];
    const result = addVertexOnFace(piece, top, centre)!;
    expect(result.piece.faces).toHaveLength(piece.faces.length - 1 + face.length);
    expect(uniqueVertices(result.piece)).toHaveLength(9);
    expect(volume(result.piece)).toBeCloseTo(volume(piece), 9);
    // Todos los triángulos nuevos miran hacia donde miraba la cara.
    const added = result.piece.faces.filter((f) => f.some((p) => vertexKey(p) === vertexKey(result.vertex)));
    expect(added).toHaveLength(face.length);
    for (const f of added) expect(faceNormal(f)[1]).toBeGreaterThan(0);
    // Al subir el vértice sale una punta y el volumen crece.
    const raised = moveVertices(result.piece, new Set([vertexKey(result.vertex)]), [0, 0.5, 0])!;
    expect(volume(raised)).toBeGreaterThan(volume(piece));
    // Sobre una arista o un vértice no hace nada.
    expect(addVertexOnFace(piece, top, face[0])).toBeNull();
    expect(addVertexOnFace(piece, top, [(face[0][0] + face[1][0]) / 2, face[0][1], (face[0][2] + face[1][2]) / 2])).toBeNull();
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

describe('flagFins', () => {
  const topEdge = () => {
    const base = cube();
    const edge = base.faces.flatMap((f) => f.map((p, k) => [p, f[(k + 1) % f.length]] as const)).find(([a, b]) => a[1] === 1 && b[1] === 1 && a[0] === b[0])!;
    return splitEdge(base, edge[0], edge[1], 0.5)!;
  };

  it('un punto de una arista sacado fuera de los planos de sus dos caras deja las dos en doble cara', () => {
    const split = topEdge();
    const moved = placeVertices(split.piece, new Set([vertexKey(split.vertex)]), (p) => [p[0] + 1, p[1] + 1, p[2]], false)!;
    const { piece, count } = flagFins(moved, split.piece);
    expect(count).toBe(1);
    expect(piece.faceFlags?.filter((f) => f & FACE_DOUBLE)).toHaveLength(2);
  });

  it('un punto jalado solo en el plano de una de sus caras (por la tapa) también es una aleta', () => {
    const split = topEdge();
    const xs = cube().faces.flat().map((p) => p[0]);
    const out = Math.sign(split.vertex[0] - (Math.min(...xs) + Math.max(...xs)) / 2);
    const keys = new Set([vertexKey(split.vertex)]);
    const to = (p: Vec3): Vec3 => (vertexKey(p) === vertexKey(split.vertex) ? [p[0] + out * 0.5, p[1], p[2]] : p);
    const moved = placeVertices(split.piece, keys, to, false)!;
    const { faces, count } = finFaces(moved, split.piece);
    expect(count).toBe(1);
    const tent = placeVertices(splitFacesAtCenter(split.piece, faces)!, keys, to, false)!;
    expect(finFaces(tent, split.piece).count).toBe(0);
    expect(collapses(tent)).toBe(false);
  });

  it('un vértice de esquina (toca tres caras) no cuenta', () => {
    const base = cube();
    const corner = topCorner(base);
    const moved = placeVertices(base, new Set([vertexKey(corner)]), (p) => [p[0] + 1, p[1] + 1, p[2] + 1], false)!;
    expect(flagFins(moved, base).count).toBe(0);
  });

  it('un punto que no se mueve no cuenta', () => {
    const split = topEdge();
    expect(flagFins(split.piece, split.piece).count).toBe(0);
  });
});

describe('splitFacesAtCenter', () => {
  it('un punto de arista sacado de sus planos, con un vértice en el centro de sus dos caras, deja un cuerpo con volumen', () => {
    const base = cube();
    const edge = base.faces.flatMap((f) => f.map((p, k) => [p, f[(k + 1) % f.length]] as const)).find(([a, b]) => a[1] === 1 && b[1] === 1 && a[0] === b[0])!;
    const split = splitEdge(base, edge[0], edge[1], 0.5)!;
    const pts = base.faces.flat();
    const mid = (k: number): number => (Math.min(...pts.map((p) => p[k])) + Math.max(...pts.map((p) => p[k]))) / 2;
    const out = Math.sign(split.vertex[0] - mid(0));
    const to = (p: Vec3): Vec3 => (vertexKey(p) === vertexKey(split.vertex) ? [p[0] + out * 0.5, p[1] + 1, p[2]] : p);
    const keys = new Set([vertexKey(split.vertex)]);
    const moved = placeVertices(split.piece, keys, to, false)!;
    const { faces, count } = finFaces(moved, split.piece);
    expect(count).toBe(1);
    const prepared = splitFacesAtCenter(split.piece, faces)!;
    expect(prepared.faces.length).toBeGreaterThan(split.piece.faces.length);
    const tent = placeVertices(prepared, keys, to, false)!;
    expect(finFaces(tent, prepared).count).toBe(0);
    expect(collapses(tent)).toBe(false);
    expect(volume(tent)).toBeGreaterThan(volume(split.piece) + 1e-6);
  });

  it('sin caras que partir no hace nada', () => {
    expect(splitFacesAtCenter(cube(), new Set())).toBeNull();
  });
});

describe('addMirrorPairOnFace', () => {
  const mirrorX = (p: Vec3): Vec3 => [1 - p[0], p[1], p[2]];
  const frontFace = (piece: ReturnType<typeof cube>) => piece.faces.findIndex((f) => f.every((p) => Math.abs(p[2] - 0.5) < 1e-9));

  it('parte la cara de forma simétrica: la pieza resultante es su propia imagen en el espejo', () => {
    const base = cube();
    const zs = base.faces.flat().map((p) => p[2]);
    const frontZ = Math.max(...zs);
    const index = base.faces.findIndex((f) => f.every((p) => Math.abs(p[2] - frontZ) < 1e-9));
    const ys = base.faces.flat().map((p) => p[1]);
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const result = addMirrorPairOnFace(base, index, [0.27, mid, frontZ], mirrorX)!;
    expect(result).not.toBeNull();
    expect(result.mirrorVertex[0]).toBeCloseTo(0.73, 9);
    // 2 triángulos (uno a cada lado) y 2 cuadriláteros entre los puntos
    expect(result.piece.faces.length).toBe(base.faces.length - 1 + 4);
    const reflected = new Set(result.piece.faces.map((f) => f.map((p) => vertexKey(mirrorX(p))).sort().join('|')));
    for (const f of result.piece.faces) expect(reflected.has(f.map(vertexKey).sort().join('|'))).toBe(true);
    expect(volume(result.piece)).toBeCloseTo(volume(base), 9);
    expect(collapses(result.piece)).toBe(false);
    void frontFace;
  });

  it('con el punto sobre el plano, o muy cerca de su espejo, no hace nada', () => {
    const base = cube();
    const frontZ = Math.max(...base.faces.flat().map((p) => p[2]));
    const index = base.faces.findIndex((f) => f.every((p) => Math.abs(p[2] - frontZ) < 1e-9));
    expect(addMirrorPairOnFace(base, index, [0.5, 0.5, frontZ], mirrorX)).toBeNull();
  });
});

describe('vértices repetidos en una cara', () => {
  const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);
  it('una cara con un vértice repetido deja añadir un vértice dentro', () => {
    const piece = cube();
    const index = piece.faces.findIndex((f) => faceNormal(f)[2] > 0.5);
    const face = piece.faces[index];
    // Como al llevar un vértice encima de otro: el primero aparece dos veces seguidas.
    piece.faces[index] = [face[0], face[0], ...face.slice(1)];
    const result = addVertexOnFace(piece, index, [0.5, 0.5, 1]);
    expect(result).not.toBeNull();
    expect(result!.piece.faces.every((f) => f.every((p, k) => vertexKey(p) !== vertexKey(f[(k + 1) % f.length])))).toBe(true);
  });
  it('mover un vértice encima de otro no deja vértices repetidos en las caras', () => {
    const piece = cube();
    const moved = moveVertices(piece, new Set([vertexKey([1, 1, 1])]), [-1, 0, 0])!;
    expect(moved.faces.every((f) => f.every((p, k) => vertexKey(p) !== vertexKey(f[(k + 1) % f.length])))).toBe(true);
  });
});

describe('connectVertices', () => {
  const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);
  const area = (face: Vec3[]) => Math.hypot(...faceNormal(face)) / 2;
  // Cara en L (cóncava), mirando a +Z: el codo está en (1,1).
  const L: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]];

  it('parte una cara en dos por la diagonal y las dos mitades suman la superficie original', () => {
    const piece = cube();
    const face = piece.faces.find((f) => f.every((p) => p[2] === 0))!;
    const [a, c] = [face.find((p) => p[0] === 0 && p[1] === 0)!, face.find((p) => p[0] === 1 && p[1] === 1)!];
    const result = connectVertices(piece, keysOf(a, c))!;
    expect(result.split).toBe(1);
    expect(result.piece.faces).toHaveLength(piece.faces.length + 1);
    const halves = result.piece.faces.filter((f) => f.every((p) => p[2] === 0));
    expect(halves).toHaveLength(2);
    expect(halves.every((f) => f.length === 3)).toBe(true);
    expect(halves[0].some((p) => vertexKey(p) === vertexKey(a)) && halves[0].some((p) => vertexKey(p) === vertexKey(c))).toBe(true);
    expect(halves[0].some((p) => vertexKey(p) === vertexKey(a)) && halves[1].some((p) => vertexKey(p) === vertexKey(c))).toBe(true);
    expect(area(halves[0]) + area(halves[1])).toBeCloseTo(area(face), 6);
    // Siguen mirando hacia fuera igual que la original.
    for (const half of halves) expect(faceNormal(half)[2]).toBeLessThan(0);
    expect(faceNormal(face)[2]).toBeLessThan(0);
  });

  it('cada mitad conserva el color y las propiedades de la cara original', () => {
    const piece = cube();
    const index = piece.faces.findIndex((f) => f.every((p) => p[2] === 0));
    const painted = makePiece(piece.faces, piece.color, piece.faces.map((_, i) => (i === index ? 0x00ff00 : 0xff0000)), undefined, piece.faces.map((_, i) => (i === index ? FACE_UNLIT : 0)));
    const face = painted.faces[index];
    const result = connectVertices(painted, keysOf(face[0], face[2]))!;
    const halves = result.piece.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.every((p) => p[2] === 0));
    expect(halves.map(({ i }) => result.piece.faceColors?.[i])).toEqual([0x00ff00, 0x00ff00]);
    expect(halves.map(({ i }) => result.piece.faceFlags?.[i])).toEqual([FACE_UNLIT, FACE_UNLIT]);
  });

  it('no hace nada con vértices vecinos, de caras distintas o si no son exactamente dos', () => {
    const piece = cube();
    expect(connectVertices(piece, keysOf([0, 0, 0], [1, 0, 0]))).toBeNull();
    expect(connectVertices(piece, keysOf([0, 0, 0], [1, 1, 1]))).toBeNull();
    expect(connectVertices(piece, keysOf([0, 0, 0]))).toBeNull();
    expect(connectVertices(piece, keysOf([0, 0, 0], [1, 1, 0], [1, 0, 0]))).toBeNull();
  });

  it('en una cara cóncava traza un segmento que cabe dentro y rechaza el que sale de ella', () => {
    const piece = makePiece([L], 0x888888);
    // (0,0)→(1,2) pasa por dentro de la L.
    const inside = connectVertices(piece, keysOf([0, 0, 0], [1, 2, 0]))!;
    expect(inside.piece.faces).toHaveLength(2);
    expect(inside.piece.faces.reduce((sum, f) => sum + area(f), 0)).toBeCloseTo(area(L), 6);
    // (2,1)→(1,2) cruza el hueco del codo (su punto medio queda fuera) y (2,0)→(1,2) corta el borde (2,1)-(1,1).
    expect(connectVertices(piece, keysOf([2, 1, 0], [1, 2, 0]))).toBeNull();
    expect(connectVertices(piece, keysOf([2, 0, 0], [1, 2, 0]))).toBeNull();
  });

  it('rechaza el trayecto con otro vértice encima', () => {
    const strip: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]];
    const piece = makePiece([strip], 0x888888);
    // (0,0)-(2,0) tiene el vértice (1,0) en medio.
    expect(connectVertices(piece, keysOf([0, 0, 0], [2, 0, 0]))).toBeNull();
    expect(connectVertices(piece, keysOf([1, 0, 0], [0, 1, 0]))).not.toBeNull();
  });
});

describe('slideSegment', () => {
  it('un vértice puesto en medio de una arista puede deslizarse por ella sin llegar a los extremos', () => {
    const piece = cube();
    const split = splitEdge(piece, [0, 0, 0], [1, 0, 0], 0.25)!;
    const slide = slideSegment(split.piece, vertexKey(split.vertex))!;
    expect(Math.abs(slide.dir[0])).toBeCloseTo(1, 9);
    expect(slide.dir[1]).toBeCloseTo(0, 9);
    // Está a ¼ del borde izquierdo: puede ir hacia atrás casi ¼ y hacia delante casi ¾ (menos el margen).
    const lo = slide.dir[0] > 0 ? slide.min : -slide.max;
    const hi = slide.dir[0] > 0 ? slide.max : -slide.min;
    expect(lo).toBeCloseTo(-0.25 + 0.02, 9);
    expect(hi).toBeCloseTo(0.75 - 0.02, 9);
  });

  it('una esquina y un punto dentro de una cara no se pueden deslizar', () => {
    const piece = cube();
    expect(slideSegment(piece, vertexKey([0, 0, 0]))).toBeNull();
    const inFace = addVertexOnFace(piece, piece.faces.findIndex((f) => f.every((p) => p[2] === 0)), [0.3, 0.5, 0])!;
    expect(slideSegment(inFace.piece, vertexKey(inFace.vertex))).toBeNull();
  });

  it('deslizar el vértice a lo largo de su dirección no deforma las caras que lo usan', () => {
    const piece = cube();
    const split = splitEdge(piece, [0, 0, 0], [1, 0, 0], 0.25)!;
    const slide = slideSegment(split.piece, vertexKey(split.vertex))!;
    const moved = moveVertices(split.piece, new Set([vertexKey(split.vertex)]), [slide.dir[0] * 0.3, slide.dir[1] * 0.3, slide.dir[2] * 0.3])!;
    expect(volume(moved)).toBeCloseTo(volume(piece), 9);
    expect(isConvex(moved)).toBe(true);
  });
});

describe('dissolveEdge', () => {
  const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);
  const area = (face: Vec3[]) => Math.hypot(...faceNormal(face)) / 2;

  it('es lo contrario de unir: quita el segmento y las dos mitades vuelven a ser una cara', () => {
    const piece = cube();
    const face = piece.faces.find((f) => f.every((p) => p[2] === 0))!;
    const a = face.find((p) => p[0] === 0 && p[1] === 0)!;
    const c = face.find((p) => p[0] === 1 && p[1] === 1)!;
    const split = connectVertices(piece, keysOf(a, c))!.piece;
    expect(split.faces).toHaveLength(7);
    const back = dissolveEdge(split, keysOf(a, c))!;
    expect(back.faces).toHaveLength(6);
    const joined = back.faces.find((f) => f.every((p) => p[2] === 0))!;
    expect(joined).toHaveLength(4);
    expect(area(joined)).toBeCloseTo(1, 9);
    expect(faceNormal(joined)[2]).toBeLessThan(0);
    expect(volume(back)).toBeCloseTo(volume(piece), 9);
  });

  it('la cara que queda conserva el color y las propiedades de la primera', () => {
    const base = cube();
    const index = base.faces.findIndex((f) => f.every((p) => p[2] === 0));
    const face = base.faces[index];
    const painted = makePiece(base.faces, base.color, base.faces.map((_, i) => (i === index ? 0x00ff00 : 0xff0000)), undefined, base.faces.map((_, i) => (i === index ? FACE_UNLIT : 0)));
    const split = connectVertices(painted, keysOf(face[0], face[2]))!.piece;
    const back = dissolveEdge(split, keysOf(face[0], face[2]))!;
    const at = back.faces.findIndex((f) => f.every((p) => p[2] === 0));
    expect(back.faceColors?.[at]).toBe(0x00ff00);
    expect(back.faceFlags?.[at]).toBe(FACE_UNLIT);
  });

  it('rechaza un borde de la pieza (dos caras en ángulo), un segmento sin dos caras y lo que no son dos vértices', () => {
    const piece = cube();
    expect(dissolveEdge(piece, keysOf([0, 0, 0], [1, 0, 0]))).toBeNull();
    const open = deleteFaces(piece, new Set([piece.faces.findIndex((f) => f.every((p) => p[2] === 0))]))!;
    expect(dissolveEdge(open, keysOf([0, 0, 0], [0, 1, 0]))).toBeNull();
    expect(dissolveEdge(piece, keysOf([0, 0, 0]))).toBeNull();
    expect(dissolveEdge(piece, keysOf([0, 0, 0], [1, 0, 0], [1, 1, 0]))).toBeNull();
  });

  it('rechaza caras del mismo borde que no están en el mismo plano', () => {
    // Dos triángulos que comparten el borde a-b pero están plegados en ángulo.
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    const flat = makePiece([[a, b, [0.5, 1, 0]], [b, a, [0.5, -1, 0.8]]], 0x888888);
    expect(dissolveEdge(flat, keysOf(a, b))).toBeNull();
  });

  it('rechaza si la unión no es un polígono simple', () => {
    // Dos cuadrados en el mismo plano que comparten un borde pero se solapan al juntarlos (el segundo vuelve sobre el primero).
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    const over = makePiece([[a, b, [1, 1, 0], [0, 1, 0]], [b, a, [0, 1, 0], [1, 1, 0]]], 0x888888);
    expect(dissolveEdge(over, keysOf(a, b))).toBeNull();
  });
});

describe('extrudeEdge', () => {
  const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);
  it('hace crecer una cara perpendicular al segmento y hacia fuera de la pieza', () => {
    const piece = cube();
    const keys = new Set([vertexKey([0, 1, 0]), vertexKey([1, 1, 0])]);
    const result = extrudeEdge(piece, keys, 0.5)!;
    expect(result.piece.faces).toHaveLength(piece.faces.length + 1);
    expect(result.keys.size).toBe(2);
    const added = result.piece.faces[result.piece.faces.length - 1];
    expect(added).toHaveLength(4);
    // Los dos vértices nuevos siguen el segmento (paralelos en X) y se alejan de la pieza (arriba y hacia -Z).
    const [, , b2, a2] = added;
    expect(b2[0] - a2[0]).toBeCloseTo(1, 6);
    expect(a2[1]).toBeGreaterThan(1);
    expect(a2[2]).toBeLessThan(0);
    expect(result.piece.faceFlags?.[result.piece.faces.length - 1]).toBe(FACE_DOUBLE);
  });
  it('sin caras vecinas sube en vertical, y no hace nada si no son dos vértices', () => {
    const piece = cube();
    const keys = new Set([vertexKey([0, 0, 0]), vertexKey([1, 0, 0]), vertexKey([1, 1, 0])]);
    expect(extrudeEdge(piece, keys, 0.5)).toBeNull();
    expect(extrudeEdge(piece, new Set([vertexKey([0, 0, 0])]), 0.5)).toBeNull();
  });
});
