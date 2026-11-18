import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { isClosed, isConvex } from './convex';
import { buildExportMeshes } from './export';
import { buildObj } from './obj';
import { makePiece, piecePoints, volume, type Piece, type Vec3 } from './piece';
import { parseProject, parseProjectFull, serializeProject } from './project';
import { ModelScene } from '../scene';
import { addFace, addSegment, canonPiece, connectVertices, deleteVertices, dissolveEdge, mergeVertices, moveVertices, nearVertexCount, openLoops, pieceEdges, placeVertices, tipVertices, uniqueVertices, vertexKey, weldVertices } from './vertices';

const cube = (): Piece => buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
const keysOf = (...points: Vec3[]) => new Set(points.map(vertexKey));
/** Un segmento suelto, de un punto a otro. */
const seg = (a: Vec3, b: Vec3): [Vec3, Vec3] => [a, b];
/** Una pieza que es solo una línea. */
const line = (a: Vec3, b: Vec3 = [a[0], a[1] + 1, a[2]]): Piece => makePiece([], 0x336699, undefined, undefined, undefined, [seg(a, b)]);
const corner = (piece: Piece): Vec3 => uniqueVertices(piece).reduce((a, b) => (b[0] + b[1] + b[2] > a[0] + a[1] + a[2] ? b : a));
/** El cubo con un segmento suelto del vértice más alto hacia fuera. */
const withTip = (distance = 0.5): { piece: Piece; base: Piece; from: Vec3; to: Vec3 } => {
  const base = cube();
  const from = corner(base);
  const result = tipVertices(base, keysOf(from), distance)!;
  const [, to] = result.piece.segments![0];
  return { piece: result.piece, base, from, to };
};
const sameVec = (a: Vec3, b: Vec3): boolean => vertexKey(a) === vertexKey(b);

describe('Piece.segments en el núcleo de vértices', () => {
  it('uniqueVertices cuenta los extremos de los segmentos', () => {
    const { piece, base } = withTip();
    expect(uniqueVertices(base)).toHaveLength(8);
    expect(uniqueVertices(piece)).toHaveLength(9);
  });

  it('una pieza solo de segmentos es válida: tiene vértices y caja, y no da NaN', () => {
    const piece = line([1, 0, 1], [1, 2, 1]);
    expect(uniqueVertices(piece)).toHaveLength(2);
    expect(piecePoints(piece)).toHaveLength(2);
    expect(volume(piece)).toBe(0);
    expect(isClosed(piece)).toBe(false);
    expect(isConvex(piece)).toBe(false);
    expect(pieceEdges(piece)).toEqual([]);
    expect(openLoops(piece)).toEqual([]);
  });

  it('moveVertices mueve el extremo del segmento igual que las caras y conserva el otro', () => {
    const { piece, from, to } = withTip();
    const moved = moveVertices(piece, keysOf(to), [0, 0.25, 0.5])!;
    expect(moved.faces).toEqual(piece.faces);
    expect(moved.segments).toHaveLength(1);
    expect(sameVec(moved.segments![0][0], from)).toBe(true);
    expect(sameVec(moved.segments![0][1], [to[0], to[1] + 0.25, to[2] + 0.5])).toBe(true);
    // El original no se toca.
    expect(sameVec(piece.segments![0][1], to)).toBe(true);
  });

  it('mover el vértice de la cara arrastra el extremo del segmento que está en él', () => {
    const { piece, from } = withTip();
    const moved = moveVertices(piece, keysOf(from), [0, 0.5, 0])!;
    expect(sameVec(moved.segments![0][0], [from[0], from[1] + 0.5, from[2]])).toBe(true);
    // Y el extremo sigue siendo el mismo punto que la esquina de las caras (un solo vértice).
    expect(uniqueVertices(moved)).toHaveLength(9);
    const pivot = moved.faces.flat().find((p) => sameVec(p, moved.segments![0][0]))!;
    expect(pivot).toEqual(moved.segments![0][0]);
  });

  it('mover una pieza solo de segmentos con keepId conserva el id', () => {
    const piece = line([0, 0, 0], [0, 1, 0]);
    const moved = moveVertices(piece, keysOf([0, 1, 0]), [1, 0, 0], true)!;
    expect(moved.id).toBe(piece.id);
    expect(moved.faces).toEqual([]);
    expect(sameVec(moved.segments![0][1], [1, 1, 0])).toBe(true);
  });

  it('placeVertices lleva también los extremos de los segmentos', () => {
    const { piece, to } = withTip();
    const placed = placeVertices(piece, keysOf(to), (p) => [p[0], 5, p[2]])!;
    expect(placed.segments![0][1][1]).toBe(5);
  });

  it('mergeVertices descarta el segmento cuyos extremos coinciden y mueve los demás', () => {
    const { piece, from, to } = withTip();
    expect(mergeVertices(piece, keysOf(from, to))!.segments).toBeUndefined();
    const other = uniqueVertices(piece).find((p) => !sameVec(p, from) && !sameVec(p, to))!;
    const merged = mergeVertices(piece, keysOf(to, other))!;
    expect(merged.segments).toHaveLength(1);
    expect(sameVec(merged.segments![0][1], merged.segments![0][1])).toBe(true);
    expect(sameVec(merged.segments![0][0], from)).toBe(true);
  });

  it('deleteVertices quita el segmento cuyo vértice se borra y deja los demás', () => {
    const { piece, from, to } = withTip();
    expect(deleteVertices(piece, keysOf(to))!.segments).toBeUndefined();
    expect(uniqueVertices(deleteVertices(piece, keysOf(to))!)).toHaveLength(8);
    // Borrar el vértice del que sale también lo quita.
    expect(deleteVertices(piece, keysOf(from))!.segments).toBeUndefined();
    const other = uniqueVertices(piece).find((p) => !sameVec(p, from) && !sameVec(p, to))!;
    expect(deleteVertices(piece, keysOf(other))!.segments).toHaveLength(1);
  });

  it('borrar todos los vértices de una pieza solo de segmentos la deja sin nada (null)', () => {
    const piece = line([0, 0, 0], [0, 1, 0]);
    expect(deleteVertices(piece, keysOf([0, 0, 0]))).toBeNull();
    expect(deleteVertices(piece, keysOf([0, 0, 0], [0, 1, 0]))).toBeNull();
  });

  it('weldVertices junta el extremo con un vértice cercano y descarta el segmento que se queda en un punto', () => {
    const base = cube();
    const from = corner(base);
    const near: Vec3 = [from[0] + 0.001, from[1], from[2]];
    const piece = makePiece(base.faces, base.color, undefined, undefined, undefined, [seg(from, near)]);
    expect(nearVertexCount(piece, 0.01)).toBe(1);
    const welded = weldVertices(piece, 0.01);
    expect(welded.welded).toBe(1);
    expect(welded.piece.segments).toBeUndefined();
    // Un segmento largo con un extremo que se suelda con otro vértice sigue.
    const far: Vec3 = [from[0], from[1] + 2, from[2]];
    const keep = makePiece(base.faces, base.color, undefined, undefined, undefined, [seg(far, [far[0] + 0.001, far[1], far[2]]), seg(from, far)]);
    const result = weldVertices(keep, 0.01);
    expect(result.piece.segments).toHaveLength(1);
  });

  it('canonPiece hace que el extremo del segmento y la esquina de la cara sean el mismo punto', () => {
    const base = cube();
    const from = corner(base);
    const close: Vec3 = [from[0] + 1e-7, from[1], from[2]];
    const piece = makePiece(base.faces, base.color, undefined, undefined, undefined, [seg(close, [from[0], from[1] + 1, from[2]])]);
    const canon = canonPiece(piece);
    expect(canon.id).toBe(piece.id);
    expect(canon.segments![0][0]).toBe(canon.faces.flat().find((p) => sameVec(p, from)));
  });

  it('addFace con dos vértices que son extremos de un segmento quita ese segmento (pasa a ser arista)', () => {
    const base = cube();
    const from = corner(base);
    const neighbour = uniqueVertices(base).find((p) => p[0] !== from[0] && p[1] === from[1] && p[2] === from[2])!;
    // Un triángulo abierto: tres vértices con un segmento entre dos de ellos.
    const third = uniqueVertices(base).find((p) => p[0] === from[0] && p[1] === from[1] && p[2] !== from[2])!;
    const piece = makePiece([], 0x336699, undefined, undefined, undefined, [seg(from, neighbour), seg(neighbour, third)]);
    // Hace falta que existan los tres vértices: salen de los segmentos.
    const made = addFace(piece, keysOf(from, neighbour, third))!;
    expect(made.faces).toHaveLength(1);
    // Los dos segmentos del triángulo pasan a ser aristas; solo queda sin cara lo que no es arista.
    expect(made.segments).toBeUndefined();
  });

  it('addFace deja los segmentos que no son aristas de la cara nueva', () => {
    const { piece, from } = withTip();
    const others = uniqueVertices(piece).filter((p) => !sameVec(p, from) && p[1] === from[1] && Math.abs(p[1] - from[1]) < 1e-9).slice(0, 2);
    const made = addFace(piece, keysOf(from, ...others));
    if (made) expect(made.segments).toHaveLength(1);
  });

  it('triangulate/trazar: una diagonal que coincide con un segmento suelto lo consume', () => {
    const quad = makePiece([[[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]], 0x336699);
    const diagonal = makePiece(quad.faces, quad.color, undefined, undefined, undefined, [seg([0, 0, 0], [1, 0, 1])]);
    const result = connectVertices(diagonal, keysOf([0, 0, 0], [1, 0, 1]))!;
    expect(result.split).toBe(1);
    expect(result.piece.faces).toHaveLength(2);
    expect(result.piece.segments).toBeUndefined();
  });

  it('dissolveEdge quita un segmento suelto entre los dos vértices elegidos y deja los vértices que usa otra cosa', () => {
    const { piece, from, to } = withTip();
    const result = dissolveEdge(piece, keysOf(from, to))!;
    expect(result.segments).toBeUndefined();
    expect(result.faces).toEqual(piece.faces);
    expect(uniqueVertices(result)).toHaveLength(8);
  });

  it('dissolveEdge sobre la última línea de una pieza solo de segmentos no hace nada (null)', () => {
    const piece = line([0, 0, 0], [0, 1, 0]);
    expect(dissolveEdge(piece, keysOf([0, 0, 0], [0, 1, 0]))).toBeNull();
  });

  it('addSegment traza un segmento entre dos vértices que no comparten cara y no repite', () => {
    const base = cube();
    const a = base.faces[0][0];
    const opposite = uniqueVertices(base).find((p) => !base.faces.some((f) => f.some((q) => sameVec(q, a)) && f.some((q) => sameVec(q, p))))!;
    const made = addSegment(base, keysOf(a, opposite))!;
    expect(made.segments).toHaveLength(1);
    expect(addSegment(made, keysOf(a, opposite))).toBeNull();
    // Dos vértices de una misma cara no.
    expect(addSegment(base, keysOf(base.faces[0][0], base.faces[0][2]))).toBeNull();
  });
});

describe('Piece.segments: archivo y deshacer', () => {
  it('guardar y abrir conserva los segmentos, también en una pieza sin caras', () => {
    const { piece } = withTip();
    const only = line([2, 0, 2], [2, 3, 2]);
    const loaded = parseProject(serializeProject([piece, only]));
    expect(loaded).toHaveLength(2);
    expect(loaded[0].segments).toHaveLength(1);
    expect(loaded[0].faces).toHaveLength(piece.faces.length);
    expect(loaded[1].faces).toEqual([]);
    expect(loaded[1].segments).toEqual([[[2, 0, 2], [2, 3, 2]]]);
  });

  it('un proyecto sin segmentos no los lleva en el texto', () => {
    expect(serializeProject([cube()])).not.toContain('segments');
  });

  it('un segmento dañado se descarta y se cuenta; el resto se carga', () => {
    const { piece } = withTip();
    const data = JSON.parse(serializeProject([piece]));
    data.pieces[0].segments.push([[0, 0, 0]], 'x', [[0, 0, 0], [1, 'a', 2]]);
    const loaded = parseProjectFull(JSON.stringify(data));
    expect(loaded.pieces[0].segments).toHaveLength(1);
    expect(loaded.discarded.segments).toBe(3);
    expect(loaded.discarded.faces).toBe(0);
  });

  it('una pieza sin caras ni segmentos válidos sigue siendo un archivo dañado', () => {
    const data = { format: 'gridfacet', version: 1, pieces: [{ color: 0, faces: [] }, { color: 0, faces: [], segments: [[[0, 0, 0]]] }] };
    expect(() => parseProject(JSON.stringify(data))).toThrow();
  });

  it('una pieza con las caras dañadas pero con segmentos válidos se salva', () => {
    const data = { format: 'gridfacet', version: 1, pieces: [{ color: 0, faces: [[[0, 0, 0]]], segments: [[[0, 0, 0], [1, 0, 0]]] }] };
    const loaded = parseProjectFull(JSON.stringify(data));
    expect(loaded.pieces[0].faces).toEqual([]);
    expect(loaded.pieces[0].segments).toHaveLength(1);
    expect(loaded.discarded.faces).toBe(1);
  });

  it('deshacer y rehacer devuelven la pieza con sus segmentos', () => {
    const model = new ModelScene();
    const { piece, to } = withTip();
    model.apply({ added: [piece], removed: [] });
    const moved = moveVertices(piece, keysOf(to), [0, 1, 0], true)!;
    model.preview({ added: [moved], removed: [piece] });
    model.commitPreview({ added: [moved], removed: [piece] });
    expect(model.undoDepth).toBe(2);
    model.undo();
    expect(sameVec(model.all()[0].segments![0][1], to)).toBe(true);
    model.redo();
    expect(sameVec(model.all()[0].segments![0][1], [to[0], to[1] + 1, to[2]])).toBe(true);
  });

  it('commitPreview no anota como cambio lo que solo se movió en un segmento… y sí lo que cambió', () => {
    const model = new ModelScene();
    const { piece, to } = withTip();
    model.apply({ added: [piece], removed: [] });
    const depth = model.undoDepth;
    // Mismas caras, un segmento movido: es un cambio.
    const moved = moveVertices(piece, keysOf(to), [0, 1, 0], true)!;
    model.commitPreview({ added: [moved], removed: [piece] });
    expect(model.undoDepth).toBe(depth + 1);
    // Misma geometría con segmentos iguales: no es cambio.
    const same = moveVertices(moved, keysOf(to), [0, 0, 0], true)!;
    model.commitPreview({ added: [same], removed: [moved] });
    expect(model.undoDepth).toBe(depth + 1);
  });
});

describe('Piece.segments: lo que los ignora a propósito', () => {
  it('exportar omite una pieza solo de segmentos y no cambia el resto', () => {
    const { piece, base } = withTip();
    const only = line([5, 0, 5], [5, 2, 5]);
    for (const mode of ['merged', 'perPiece', 'perLayer'] as const) {
      expect(buildExportMeshes([only], mode)).toEqual([]);
      const meshes = buildExportMeshes([piece, only], mode);
      const clean = buildExportMeshes([base], mode);
      expect(meshes.length).toBe(clean.length);
      for (const mesh of meshes) expect(mesh.positions.every(Number.isFinite)).toBe(true);
    }
  });

  it('exportar a OBJ no falla con piezas sin caras', () => {
    const only = line([5, 0, 5], [5, 2, 5]);
    expect(() => buildObj([only], 'prueba')).not.toThrow();
    expect(buildObj([withTip().piece], 'prueba').obj).not.toContain('NaN');
  });
});
