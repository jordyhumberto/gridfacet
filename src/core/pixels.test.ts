import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { copyRegion, drawShape, roundMask, moveRegion, pasteRegion, paintCell, rectBetween, replaceColor, floodFill, stamp, stampLine, texelAt, textureOfFace, visibleColor, withFaceTexture } from './pixels';
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

describe('formas, reemplazar color y tramado', () => {
  const grid = (w = 9, h = 9) => blankTexture(w, h);
  const at = (t: ReturnType<typeof blankTexture>, x: number, y: number) => t.pixels[y * t.w + x];
  const count = (t: ReturnType<typeof blankTexture>, v: number) => t.pixels.filter((p) => p === v).length;

  it('el rectángulo vacío deja solo el borde', () => {
    const t = grid();
    drawShape(t, 'rect', { x: 1, y: 1 }, { x: 5, y: 4 }, 1, 7);
    expect(at(t, 1, 1)).toBe(7);
    expect(at(t, 5, 4)).toBe(7);
    expect(at(t, 3, 2)).toBe(CLEAR);
    expect(count(t, 7)).toBe(2 * 5 + 2 * 2);
  });

  it('el rectángulo lleno cubre todo el área, también si se arrastra hacia atrás', () => {
    const t = grid();
    drawShape(t, 'rectfill', { x: 5, y: 4 }, { x: 1, y: 1 }, 1, 7);
    expect(count(t, 7)).toBe(5 * 4);
  });

  it('la elipse llena es simétrica y no sale de su rectángulo; la vacía tiene hueco', () => {
    const full = grid();
    drawShape(full, 'ellipsefill', { x: 0, y: 0 }, { x: 8, y: 8 }, 1, 3);
    expect(at(full, 0, 0)).toBe(CLEAR);
    expect(at(full, 4, 4)).toBe(3);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) expect(at(full, x, y)).toBe(at(full, 8 - x, y));
    const ring = grid();
    drawShape(ring, 'ellipse', { x: 0, y: 0 }, { x: 8, y: 8 }, 1, 3);
    expect(at(ring, 4, 4)).toBe(CLEAR);
    expect(at(ring, 4, 0)).toBe(3);
  });

  it('reemplazar color cambia todas las casillas de ese color y solo esas', () => {
    const t = grid(4, 1);
    t.pixels = [1, 2, 1, CLEAR];
    expect(replaceColor(t, 0, 0, 9)).toBe(2);
    expect(t.pixels).toEqual([9, 2, 9, CLEAR]);
    expect(replaceColor(t, 3, 0, 5)).toBe(1);
  });

  it('la forma sigue al puntero sin dejar rastro de las posiciones anteriores', () => {
    const t = grid();
    const state = { start: null, last: null, base: null };
    paintCell(t, state, 'rectfill', { x: 1, y: 1 }, 1, 7);
    paintCell(t, state, 'rectfill', { x: 6, y: 6 }, 1, 7);
    paintCell(t, state, 'rectfill', { x: 2, y: 2 }, 1, 7);
    expect(count(t, 7)).toBe(4);
  });

  it('el tramado pinta casillas alternas', () => {
    const t = grid(6, 1);
    paintCell(t, { start: null, last: null, base: null }, 'dither', { x: 0, y: 0 }, 1, 4);
    paintCell(t, { start: null, last: { x: 0, y: 0 }, base: null }, 'dither', { x: 5, y: 0 }, 1, 4);
    expect(t.pixels).toEqual([4, CLEAR, 4, CLEAR, 4, CLEAR]);
  });
});

describe('seleccionar y mover', () => {
  const row = (pixels: number[]) => ({ w: pixels.length, h: 1, pixels });

  it('mueve solo la región y deja libre lo que dejó', () => {
    const t = row([1, 2, 3, CLEAR, CLEAR, 9]);
    const moved = moveRegion(t, { x0: 0, y0: 0, x1: 1, y1: 0 }, 2, 0);
    expect(moved.pixels).toEqual([CLEAR, CLEAR, 1, 2, CLEAR, 9]);
    expect(t.pixels).toEqual([1, 2, 3, CLEAR, CLEAR, 9]);
  });

  it('sin región mueve toda la cara y pierde lo que sale', () => {
    expect(moveRegion(row([1, 2, 3]), null, 1, 0).pixels).toEqual([CLEAR, 1, 2]);
    expect(moveRegion(row([1, 2, 3]), null, -1, 0).pixels).toEqual([2, 3, CLEAR]);
  });

  it('el rectángulo se ordena sea cual sea la dirección del arrastre', () => {
    expect(rectBetween({ x: 5, y: 4 }, { x: 1, y: 2 })).toEqual({ x0: 1, y0: 2, x1: 5, y1: 4 });
  });

  it('Mover en un trazo parte siempre de la textura original, sin acumular movimientos', () => {
    const t = row([1, CLEAR, CLEAR, CLEAR]);
    const state: Parameters<typeof paintCell>[1] = { start: null, last: null, base: null, selection: null };
    paintCell(t, state, 'move', { x: 0, y: 0 }, 1, 5);
    paintCell(t, state, 'move', { x: 3, y: 0 }, 1, 5);
    paintCell(t, state, 'move', { x: 1, y: 0 }, 1, 5);
    expect(t.pixels).toEqual([CLEAR, 1, CLEAR, CLEAR]);
    expect(state.shift).toEqual({ x: 1, y: 0 });
  });
});

describe('copiar y pegar píxeles', () => {
  const tex = (w: number, h: number, pixels: number[]) => ({ w, h, pixels });

  it('copiar con la región da un trozo con su tamaño', () => {
    const t = tex(3, 2, [1, 2, 3, 4, 5, 6]);
    expect(copyRegion(t, { x0: 1, y0: 0, x1: 2, y1: 1 })).toEqual(tex(2, 2, [2, 3, 5, 6]));
    expect(copyRegion(t, null)).toEqual(t);
  });

  it('pegar pone el trozo en su esquina, sin borrar lo de debajo con lo sin pintar y cortando lo que sale', () => {
    const base = tex(4, 1, [7, 7, 7, 7]);
    const clip = tex(3, 1, [1, CLEAR, 2]);
    const pasted = pasteRegion(base, clip, 2, 0);
    expect(pasted.texture.pixels).toEqual([7, 7, 1, 7]);
    expect(pasted.rect).toEqual({ x0: 2, y0: 0, x1: 4, y1: 0 });
    expect(base.pixels).toEqual([7, 7, 7, 7]);
  });

  it('mover con copia deja el original y no borra con lo sin pintar', () => {
    const t = tex(4, 1, [1, CLEAR, 9, CLEAR]);
    expect(moveRegion(t, { x0: 0, y0: 0, x1: 1, y1: 0 }, 2, 0, true).pixels).toEqual([1, CLEAR, 1, CLEAR]);
  });
});

describe('pincel redondo y espejo en la cara', () => {
  const grid = (w: number, h: number) => blankTexture(w, h);
  const state = () => ({ start: null, last: null, base: null });
  const count = (t: ReturnType<typeof blankTexture>) => t.pixels.filter((p) => p !== CLEAR).length;

  it('el pincel redondo quita las esquinas del cuadrado cuando es grande', () => {
    const square = grid(9, 9);
    const round = grid(9, 9);
    paintCell(square, state(), 'pencil', { x: 4, y: 4 }, 5, 1);
    paintCell(round, state(), 'pencil', { x: 4, y: 4 }, 5, 1, { round: true });
    expect(count(square)).toBe(25);
    expect(count(round)).toBeLessThan(25);
    expect(round.pixels[2 * 9 + 2]).toBe(CLEAR);
    expect(round.pixels[4 * 9 + 4]).toBe(1);
    expect(round.pixels[4 * 9 + 2]).toBe(1);
  });

  it('con 1 o 2 px el pincel redondo es igual que el cuadrado', () => {
    expect(roundMask(1)).toBeUndefined();
    expect(roundMask(2)).toBeUndefined();
  });

  it('el espejo horizontal repite el trazo reflejado', () => {
    const t = grid(8, 4);
    const st = state();
    paintCell(t, st, 'pencil', { x: 1, y: 1 }, 1, 3, { mirrorX: true });
    paintCell(t, st, 'pencil', { x: 3, y: 1 }, 1, 3, { mirrorX: true });
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) expect(t.pixels[y * 8 + x]).toBe(t.pixels[y * 8 + (7 - x)]);
    expect(count(t)).toBe(6);
  });

  it('con los dos espejos salen cuatro copias, también en una forma', () => {
    const t = grid(8, 8);
    paintCell(t, state(), 'pencil', { x: 1, y: 2 }, 1, 3, { mirrorX: true, mirrorY: true });
    expect(count(t)).toBe(4);
    const r = grid(8, 8);
    const st = state();
    paintCell(r, st, 'rectfill', { x: 0, y: 0 }, 1, 3, { mirrorX: true });
    paintCell(r, st, 'rectfill', { x: 2, y: 1 }, 1, 3, { mirrorX: true });
    expect(count(r)).toBe(12);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(r.pixels[y * 8 + x]).toBe(r.pixels[y * 8 + (7 - x)]);
  });
});
