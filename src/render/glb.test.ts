import { beforeAll, describe, expect, it } from 'vitest';
import { emptyAnimation, setKey } from '../core/animation';
import { CATALOG, buildPiece } from '../core/catalog';
import { FACE_UNLIT, type Piece } from '../core/piece';
import { exportGlb } from './glb';

/** El exportador de glTF lee sus trozos con FileReader, que Node no trae: se le da uno mínimo. */
beforeAll(() => {
  class FakeReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
    readAsDataURL(): void {
      throw new Error('no se espera una imagen');
    }
  }
  (globalThis as { FileReader?: unknown }).FileReader ??= FakeReader;
});

/** El JSON de un GLB: cabecera de 12 bytes, luego el trozo JSON. */
function jsonOf(glb: ArrayBuffer): { asset: unknown; nodes?: { name?: string }[]; meshes?: unknown[]; materials?: { name?: string; doubleSided?: boolean; extensions?: Record<string, unknown> }[]; animations?: { name?: string; channels: unknown[] }[] } {
  const view = new DataView(glb);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
  expect(view.getUint32(8, true)).toBe(glb.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, length)));
}

const cube = (x: number, group?: number, name?: string): Piece => {
  const piece = buildPiece(CATALOG[0], x, 0, 0, 0, 0xff0000);
  if (group !== undefined) {
    piece.group = group;
    if (name) piece.groupName = name;
  }
  return piece;
};

describe('escritor de GLB', () => {
  it('escribe un GLB válido con una malla por objeto y sin animación', async () => {
    const glb = jsonOf(await exportGlb([cube(0), cube(3)], 'perPiece'));
    expect(glb.meshes).toHaveLength(2);
    expect(glb.animations).toBeUndefined();
  });

  it('las caras sin luz salen con KHR_materials_unlit y las dobles con doubleSided', async () => {
    const lit = cube(0);
    const unlit = cube(3);
    unlit.faceFlags = unlit.faces.map(() => FACE_UNLIT);
    const glb = jsonOf(await exportGlb([lit, unlit], 'perPiece'));
    const names = glb.materials!.map((m) => m.name ?? '');
    expect(names.some((n) => n.includes('sinluz'))).toBe(true);
    const unlitMaterial = glb.materials!.find((m) => (m.name ?? '').includes('sinluz'))!;
    expect(unlitMaterial.extensions?.KHR_materials_unlit).toBeDefined();
  });

  it('un grupo animado sale como un nodo propio y la animación lleva posición, giro y escala', async () => {
    const pieces = [cube(0, 1, 'Brazo derecho'), cube(3)];
    let animation = emptyAnimation();
    animation = setKey(animation, 1, 0, { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] });
    animation = setKey(animation, 1, 5, { pos: [0, 2, 0], rot: [0, 90, 0], scale: [1, 1, 1] });
    const glb = jsonOf(await exportGlb(pieces, 'merged', undefined, animation));
    expect(glb.animations).toHaveLength(1);
    expect(glb.animations![0].name).toBe('Animacion');
    expect(glb.animations![0].channels).toHaveLength(3);
    expect(glb.nodes!.some((n) => n.name === 'Brazo_derecho_1')).toBe(true);
  });

  it('una animación cuyo grupo ya no tiene piezas no escribe clip', async () => {
    let animation = emptyAnimation();
    animation = setKey(animation, 9, 0, { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] });
    const glb = jsonOf(await exportGlb([cube(0)], 'merged', undefined, animation));
    expect(glb.animations).toBeUndefined();
  });

  it('sin piezas escribe igualmente un archivo válido', async () => {
    const glb = jsonOf(await exportGlb([], 'merged'));
    expect(glb.asset).toBeDefined();
  });
});
