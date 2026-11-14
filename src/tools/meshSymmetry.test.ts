import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from '../core/catalog';
import type { Piece, Vec3 } from '../core/piece';
import { translatePiece } from '../core/transform';
import { moveVertices, uniqueVertices, vertexKey } from '../core/vertices';
import { ModelScene } from '../scene';
import { MeshTool } from './meshTool';

/** Una herramienta de Malla sobre un modelo real, con simetría en X y una pieza que cruza el plano. */
function setup() {
  const model = new ModelScene();
  const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
  const xs = uniqueVertices(cube).map((p) => p[0]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const piece = translatePiece(cube, -centerX, 0, 0);
  model.apply({ added: [piece], removed: [] });
  const el = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLElement;
  const symmetry = { x: true, y: false, z: false, center: [0, 0, 0] as Vec3 };
  const tool = new MeshTool({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    domElement: el,
    setOrbit: () => {},
    model,
    selectedPieces: () => [],
    isHidden: () => false,
    symmetry: () => symmetry,
    status: () => {},
    onSelectionChange: () => {},
  });
  tool.activate();
  const choose = (predicate: (p: Vec3) => boolean) => {
    const current = model.all()[0];
    const keys = new Set(uniqueVertices(current).filter(predicate).map(vertexKey));
    (tool as unknown as { selection: Map<number, Set<string>> }).selection = new Map([[current.id, keys]]);
    tool.refresh();
  };
  return { model, tool, choose };
}

/** Cada vértice tiene su imagen en espejo en X, y cada cara la suya. */
function isSymmetric(pieces: Piece[]): boolean {
  const keys = new Set(pieces.flatMap((piece) => uniqueVertices(piece).map(vertexKey)));
  const mirrored = (p: Vec3) => vertexKey([-p[0], p[1], p[2]]);
  if (!pieces.every((piece) => uniqueVertices(piece).every((p) => keys.has(mirrored(p))))) return false;
  const faces = new Set(pieces.flatMap((piece) => piece.faces.map((face) => face.map(vertexKey).sort().join('|'))));
  return pieces.every((piece) => piece.faces.every((face) => faces.has(face.map(mirrored).sort().join('|'))));
}

describe('Malla con simetría y una pieza que cruza el espejo', () => {
  it('el punto de partida es simétrico', () => {
    const { model } = setup();
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('borrar un vértice de un lado quita también el del otro', () => {
    const { model, tool, choose } = setup();
    const top = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[1]));
    choose((p) => p[0] > 0 && p[1] === top && p[2] === Math.max(...uniqueVertices(model.all()[0]).map((q) => q[2])));
    tool.deleteSelected();
    expect(isSymmetric(model.all())).toBe(true);
    expect(model.all().flatMap(uniqueVertices)).toHaveLength(6);
  });

  it('borrar una cara de un lado quita también su espejo', () => {
    const { model, tool, choose } = setup();
    const faces = model.all()[0].faces.length;
    const front = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[2]));
    choose((p) => p[2] === front);
    tool.deleteFacesSelected();
    expect(isSymmetric(model.all())).toBe(true);
    expect(model.all()[0].faces.length).toBe(faces - 1);
  });

  it('fusionar dos vértices de un lado fusiona también los del otro', () => {
    const { model, tool, choose } = setup();
    const top = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[1]));
    choose((p) => p[0] > 0 && p[1] === top);
    tool.mergeSelected();
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('girar las caras, extruir y deshacer mantienen la simetría', () => {
    const { model, tool, choose } = setup();
    const front = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[2]));
    choose((p) => p[2] === front && p[0] > 0);
    tool.flipSelected();
    expect(isSymmetric(model.all())).toBe(true);
    tool.extrudeSelected(0.5);
    expect(isSymmetric(model.all())).toBe(true);
    model.undo();
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('tapar hueco cierra el hueco y también su espejo', () => {
    const { model, tool, choose } = setup();
    const faces = model.all()[0].faces.length;
    const right = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[0]));
    // Se quitan las dos caras de los lados (la de la derecha y su espejo) y se vuelve a cerrar eligiendo un solo vértice.
    choose((p) => p[0] === right);
    tool.deleteFacesSelected();
    expect(model.all()[0].faces.length).toBe(faces - 2);
    expect(isSymmetric(model.all())).toBe(true);
    choose((p) => p[0] === right && p[1] === Math.max(...uniqueVertices(model.all()[0]).map((q) => q[1])) && p[2] === Math.max(...uniqueVertices(model.all()[0]).map((q) => q[2])));
    tool.fillHolesSelected();
    expect(model.all()[0].faces.length).toBe(faces);
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('triangular parte las caras y se deshace (una cara que cruza el espejo no puede quedar con diagonales simétricas)', () => {
    const { model, tool, choose } = setup();
    choose(() => true);
    tool.triangulateSelected();
    expect(model.all()[0].faces).toHaveLength(12);
    expect(uniqueVertices(model.all()[0])).toHaveLength(8);
    model.undo();
    expect(model.all()[0].faces).toHaveLength(6);
  });

  it('Simetrizar arregla un modelo que se descuadró y se deshace de un paso', () => {
    const { model, tool, choose } = setup();
    const piece = model.all()[0];
    const right = uniqueVertices(piece).filter((p) => p[0] > 0)[0];
    model.apply({ added: [translateOne(piece, right, [0.01, 0.005, 0])], removed: [piece] });
    expect(isSymmetric(model.all())).toBe(false);
    choose(() => false);
    tool.symmetrizeAll();
    expect(isSymmetric(model.all())).toBe(true);
    model.undo();
    expect(isSymmetric(model.all())).toBe(false);
  });
});

function translateOne(piece: Piece, at: Vec3, delta: Vec3): Piece {
  return moveVertices(piece, new Set([vertexKey(at)]), delta)!;
}
