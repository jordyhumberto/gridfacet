import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { floodFill, stamp, stampLine, texelAt, textureOfFace, visibleColor, withFaceTexture } from './pixels';
import { CLEAR, blankTexture, pointOf } from './texture';

const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);

describe('edición de píxeles', () => {
  it('una cara sin textura da una en blanco del tamaño que le toca', () => {
    const texture = textureOfFace(cube(), 0);
    expect([texture.w, texture.h]).toEqual([16, 16]);
    expect(texture.pixels.every((p) => p === CLEAR)).toBe(true);
  });

  it('texelAt traduce un punto de la cara a su casilla y rechaza lo de fuera', () => {
    const piece = cube();
    const face = piece.faces[0];
    const texture = textureOfFace(piece, 0);
    expect(texelAt(face, texture, pointOf(face, 0.01, 0.01))).toEqual({ x: 0, y: 0 });
    expect(texelAt(face, texture, pointOf(face, 0.99, 0.99))).toEqual({ x: 15, y: 15 });
    expect(texelAt(face, texture, pointOf(face, 0.5, 0.5))).toEqual({ x: 8, y: 8 });
    expect(texelAt(face, texture, pointOf(face, 1.5, 0.5))).toBeNull();
  });

  it('stamp pinta un cuadrado, recorta en los bordes y cuenta los cambios', () => {
    const texture = blankTexture(8, 8);
    expect(stamp(texture, 4, 4, 1, 0xff0000)).toBe(1);
    expect(stamp(texture, 4, 4, 1, 0xff0000)).toBe(0);
    expect(stamp(texture, 0, 0, 3, 0x00ff00)).toBe(4);
    expect(texture.pixels[0]).toBe(0x00ff00);
    expect(texture.pixels[1 * 8 + 1]).toBe(0x00ff00);
    expect(texture.pixels[2 * 8 + 2]).toBe(CLEAR);
  });

  it('stamp con CLEAR borra', () => {
    const texture = blankTexture(4, 4);
    stamp(texture, 1, 1, 1, 0xabcdef);
    expect(stamp(texture, 1, 1, 1, CLEAR)).toBe(1);
    expect(texture.pixels.every((p) => p === CLEAR)).toBe(true);
  });

  it('floodFill rellena la región conectada y no cruza el contorno', () => {
    const texture = blankTexture(5, 5);
    for (let i = 0; i < 5; i++) texture.pixels[2 * 5 + i] = 0x111111;
    expect(floodFill(texture, 0, 0, 0xff0000)).toBe(10);
    expect(texture.pixels[3 * 5]).toBe(CLEAR);
    expect(texture.pixels[1 * 5 + 4]).toBe(0xff0000);
    expect(floodFill(texture, 0, 0, 0xff0000)).toBe(0);
  });

  it('visibleColor devuelve el píxel o, si no hay, el color de la cara', () => {
    const texture = blankTexture(2, 1);
    texture.pixels[0] = 0x123456;
    expect(visibleColor(texture, 0, 0, 0xffffff)).toBe(0x123456);
    expect(visibleColor(texture, 1, 0, 0xffffff)).toBe(0xffffff);
  });

  it('withFaceTexture cambia solo esa cara y conserva el resto', () => {
    const piece = { ...cube(), group: 3, layer: 2 };
    const first = textureOfFace(piece, 0);
    stamp(first, 2, 2, 1, 0xff0000);
    const a = withFaceTexture(piece, 0, first);
    const second = textureOfFace(a, 1);
    stamp(second, 0, 0, 1, 0x00ff00);
    const b = withFaceTexture(a, 1, second);
    expect(b.id).not.toBe(a.id);
    expect([b.group, b.layer]).toEqual([3, 2]);
    expect(b.faceTextures![0]).toEqual(first);
    expect(b.faceTextures![1]).toEqual(second);
    expect(b.faceTextures![2]).toBeNull();
    expect(piece.faceTextures).toBeUndefined();
  });

  it('borrar todo lo pintado deja la pieza sin texturas', () => {
    const piece = cube();
    const texture = textureOfFace(piece, 0);
    stamp(texture, 3, 3, 1, 0xff0000);
    const painted = withFaceTexture(piece, 0, texture);
    stamp(texture, 3, 3, 1, CLEAR);
    expect(withFaceTexture(painted, 0, texture).faceTextures).toBeUndefined();
  });
});

describe('stampLine', () => {
  it('une dos casillas sin dejar huecos, en horizontal y en diagonal', () => {
    const row = blankTexture(8, 3);
    expect(stampLine(row, 0, 1, 7, 1, 1, 0xff0000)).toBe(8);
    const diagonal = blankTexture(6, 6);
    expect(stampLine(diagonal, 0, 0, 5, 5, 1, 0xff0000)).toBe(6);
    for (let i = 0; i < 6; i++) expect(diagonal.pixels[i * 6 + i]).toBe(0xff0000);
  });

  it('con una sola casilla equivale a stamp y admite el sentido contrario', () => {
    const one = blankTexture(4, 4);
    expect(stampLine(one, 2, 2, 2, 2, 1, 0x00ff00)).toBe(1);
    const back = blankTexture(8, 1);
    expect(stampLine(back, 6, 0, 1, 0, 1, 0x00ff00)).toBe(6);
  });
});
