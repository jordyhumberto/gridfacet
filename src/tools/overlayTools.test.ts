import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from '../core/catalog';
import type { Vec3 } from '../core/piece';
import { Selection } from '../selection';
import { ModelScene } from '../scene';
import { CutTool } from './cutTool';
import { FillTool } from './fillTool';
import { OutlineTool } from './outlineTool';
import { VertexTool } from './vertexTool';

/** Los objetos que cuelgan de la capa de dibujo de una herramienta (el primer hijo de la escena). */
const drawn = (scene: THREE.Scene): THREE.Object3D[] => (scene.children[0] as THREE.Group).children;

describe('mover el cursor en Cortar, Rellenar y Figura solo cambia lo que lo sigue', () => {
  it('Rellenar: la vista previa y el mensaje no se vuelven a hacer en cada movimiento', () => {
    const scene = new THREE.Scene();
    const messages: string[] = [];
    const tool = new FillTool(scene, new ModelScene(), () => 0xff0000, (m) => messages.push(m));
    tool.activate();
    for (const p of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) tool.addPoint(p);
    // El primer hijo es la capa del cursor; el resto son los cuatro puntos y la vista previa.
    const layer = drawn(scene)[0] as THREE.Group;
    const shape = drawn(scene).filter((child) => child !== layer);
    expect(shape.length).toBeGreaterThan(4);
    const said = messages.length;
    tool.setHover([2, 2, 2]);
    tool.setHover([3, 3, 3]);
    expect(messages.length).toBe(said);
    // Los mismos objetos de antes siguen ahí (no se rehicieron) y hay una marca del cursor.
    for (const child of shape) expect(drawn(scene)).toContain(child);
    expect(layer.children).toHaveLength(1);
    expect(layer.children[0].position.toArray()).toEqual([3, 3, 3]);
    tool.setHover(null);
    expect(layer.children).toHaveLength(0);
  });

  it('Figura: con menos de tres puntos la línea llega hasta el cursor; con tres o más, la figura no se rehace', () => {
    const scene = new THREE.Scene();
    const messages: string[] = [];
    const tool = new OutlineTool(scene, new ModelScene(), () => false, () => 1, (m) => messages.push(m));
    tool.activate();
    tool.addPoint([0, 0, 0]);
    tool.setHover([1, 0, 0]);
    const layer = drawn(scene)[0] as THREE.Group;
    // La marca del cursor y la línea del primer punto al cursor.
    expect(layer.children).toHaveLength(2);
    tool.addPoint([1, 0, 0]);
    tool.addPoint([1, 0, 1]);
    const said = messages.length;
    const before = drawn(scene).filter((child) => child !== layer);
    tool.setHover([0, 0, 1]);
    tool.setHover([0, 0, 2]);
    expect(messages.length).toBe(said);
    for (const child of before) expect(drawn(scene)).toContain(child);
    expect(layer.children).toHaveLength(1);
  });

  it('Cortar: con la región cerrada el cursor no vuelve a dibujar nada, y sin cerrar no pisa el mensaje', () => {
    const scene = new THREE.Scene();
    const messages: string[] = [];
    const tool = new CutTool(scene, new ModelScene(), new Selection(), (m) => messages.push(m));
    tool.activate();
    for (const p of [[0, 0, 0], [1, 0, 0], [0, 0, 1]] as Vec3[]) tool.addPoint(p);
    const said = messages.length;
    tool.setHover([2, 0, 2]);
    expect(messages.length).toBe(said);
    tool.addPoint([0, 0, 0]);
    expect(tool.isClosed).toBe(true);
    const shape = [...drawn(scene)];
    expect(shape.length).toBeGreaterThan(0);
    tool.setHover([3, 0, 3]);
    expect(drawn(scene)).toEqual(shape);
  });
});

describe('Vértice: mover el cursor no rehace los puntos y deshacer recalcula los candidatos', () => {
  it('los puntos amarillos se dibujan una vez; la marca del cursor es aparte', () => {
    const model = new ModelScene();
    model.apply({ added: [buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699)], removed: [] });
    const scene = new THREE.Scene();
    const tool = new VertexTool(scene, model, () => model.all(), () => {});
    let phases = 0;
    tool.onPhaseChange = () => phases++;
    tool.activate();
    expect(phases).toBe(1);
    const overlay = scene.children[0] as THREE.Group;
    const screenOf = (p: Vec3) => ({ x: p[0] * 100, y: p[1] * 100 });
    const ray = new THREE.Ray();
    tool.hoverAt({ x: 0, y: 0 }, ray, screenOf, false);
    const dots = overlay.children[0];
    expect(dots).toBeInstanceOf(THREE.Points);
    for (const x of [10, 20, 30]) tool.hoverAt({ x, y: 0 }, ray, screenOf, false);
    expect(overlay.children[0]).toBe(dots);
    expect(overlay.children.length).toBeLessThanOrEqual(2);
    // Un cambio en el modelo y su deshacer: los candidatos se calculan otra vez.
    model.apply({ added: [buildPiece(CATALOG[0], 1, 0, 0, 0, 0x336699)], removed: [] });
    model.undo();
    tool.hoverAt({ x: 0, y: 0 }, ray, screenOf, false);
    expect(phases).toBe(2);
  });
});
