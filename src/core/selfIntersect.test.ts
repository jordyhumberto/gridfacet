import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { collapses } from './selfIntersect';
import { makePiece, type Vec3 } from './piece';

/** Cubo de lado 1 con las caras de arriba y de abajo en zigzag, como en una figura estirada con malla libre. */
function crown(low: number, topMid: number, corner: number) {
  const f: Vec3[][] = [
    [[-0.5, corner, -0.5], [0, low, -0.75], [0.5, corner, -0.5], [0.75, low, 0], [0.5, corner, 0.5], [0, low, 0.75], [-0.5, corner, 0.5], [-0.75, low, 0]],
    [[-0.5, 1, -0.5], [-0.5, topMid, 0], [-0.5, 1, 0.5], [0, topMid, 0.5], [0.5, 1, 0.5], [0.5, topMid, 0], [0.5, 1, -0.5], [0, topMid, -0.5]],
    [[-0.5, corner, -0.5], [-0.5, 1, -0.5], [0, topMid, -0.5], [0.5, 1, -0.5], [0.5, corner, -0.5], [0, low, -0.75]],
    [[-0.5, corner, 0.5], [0, low, 0.75], [0.5, corner, 0.5], [0.5, 1, 0.5], [0, topMid, 0.5], [-0.5, 1, 0.5]],
    [[-0.5, corner, -0.5], [-0.75, low, 0], [-0.5, corner, 0.5], [-0.5, 1, 0.5], [-0.5, topMid, 0], [-0.5, 1, -0.5]],
    [[0.5, corner, -0.5], [0.5, 1, -0.5], [0.5, topMid, 0], [0.5, 1, 0.5], [0.5, corner, 0.5], [0.75, low, 0]],
  ];
  return makePiece(f, 0xff0000);
}

describe('collapses', () => {
  it('las piezas del catálogo no se atraviesan', () => {
    for (const entry of CATALOG) expect(collapses(buildPiece(entry, 0, 0, 0, 0, 0xffffff))).toBe(false);
  });

  it('un cuerpo con la cara de arriba hundida pero por encima de la de abajo sigue entero', () => {
    expect(collapses(crown(0, 0.8, 0.25))).toBe(false);
  });

  it('cuando la cara de arriba baja hasta la de abajo, el cuerpo se aplasta', () => {
    expect(collapses(crown(0, 0.5, 0.5))).toBe(true);
  });

  it('cuando la cara de arriba atraviesa la de abajo, también', () => {
    expect(collapses(crown(0, 0.2, 0.5))).toBe(true);
  });

  /** Esfera de muchas caras (cuadriláteros y triángulos en los polos); un vértice de la altura 10 se puede llevar a otro sitio. */
  function sphere(slices: number, stacks: number, push = 0): ReturnType<typeof makePiece> {
    const pt = (i: number, j: number): Vec3 => {
      if (i === 0) return [0, 3, 0];
    if (i === 10 && j % slices === 0 && push !== 0) return [push, 3, 0.2];
      const a = (Math.PI * i) / stacks;
      const b = (2 * Math.PI * (j % slices)) / slices;
      return [3 * Math.sin(a) * Math.cos(b), 3 * Math.cos(a), 3 * Math.sin(a) * Math.sin(b)];
    };
    const faces: Vec3[][] = [];
    for (let j = 0; j < slices; j++) {
      faces.push([pt(0, 0), pt(1, j + 1), pt(1, j)]);
      for (let i = 1; i < stacks - 1; i++) faces.push([pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)]);
      faces.push([pt(stacks, 0), pt(stacks - 1, j), pt(stacks - 1, j + 1)]);
    }
    return makePiece(faces, 0xff0000);
  }

  it('una malla de miles de caras sin cruces no se aplasta (el recorrido por barrido no inventa choques)', () => {
    expect(collapses(sphere(40, 30))).toBe(false);
  });

  it('en una malla grande, un vértice llevado al otro lado atraviesa las caras de enfrente aunque estén lejos en la lista', () => {
    // Un vértice del ecuador se lleva al otro lado de la esfera: sus caras atraviesan la pared de enfrente.
    expect(collapses(sphere(40, 30, -8))).toBe(true);
  });
});
