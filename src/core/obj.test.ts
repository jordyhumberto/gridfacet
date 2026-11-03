import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { buildObj, packAtlas } from './obj';
import { floodFill, textureOfFace, withFaceTexture } from './pixels';

const cube = (x = 0, color = 0x336699) => buildPiece(CATALOG[0], x, 0, 0, 0, color);

describe('packAtlas', () => {
  it('no solapa rectángulos y respeta el ancho máximo', () => {
    const sizes = [{ w: 16, h: 16 }, { w: 32, h: 16 }, { w: 8, h: 24 }, { w: 16, h: 16 }, { w: 40, h: 8 }];
    const { slots, width, height } = packAtlas(sizes, 64);
    expect(width).toBeLessThanOrEqual(64);
    sizes.forEach((a, i) => {
      expect(slots[i].x + a.w).toBeLessThanOrEqual(width);
      expect(slots[i].y + a.h).toBeLessThanOrEqual(height);
      sizes.forEach((b, j) => {
        if (j <= i) return;
        const apart = slots[i].x + a.w <= slots[j].x || slots[j].x + b.w <= slots[i].x || slots[i].y + a.h <= slots[j].y || slots[j].y + b.h <= slots[i].y;
        expect(apart).toBe(true);
      });
    });
  });

  it('sin rectángulos no hay atlas y uno más ancho que el máximo crece', () => {
    expect(packAtlas([])).toEqual({ slots: [], width: 0, height: 0 });
    expect(packAtlas([{ w: 200, h: 4 }], 64).width).toBe(200);
  });
});

describe('buildObj', () => {
  it('sin texturas escribe la geometría y los colores, sin atlas', () => {
    const { obj, mtl, atlas } = buildObj([cube()], 'mono');
    expect(atlas).toBeNull();
    expect(obj.startsWith('mtllib mono.mtl')).toBe(true);
    expect(obj.match(/^v /gm)).toHaveLength(8);
    expect(obj.match(/^f /gm)).toHaveLength(12);
    expect(obj).not.toContain('Texturas');
    expect(mtl).toContain('newmtl color_336699');
    expect(mtl).toContain('Kd 0.2 0.4 0.6');
  });

  it('con una cara pintada añade una malla de texturas con UV y el atlas', () => {
    const piece = cube();
    const texture = textureOfFace(piece, 0);
    floodFill(texture, 0, 0, 0xff0000);
    const { obj, mtl, atlas } = buildObj([withFaceTexture(piece, 0, texture)], 'mono');
    expect(atlas).toMatchObject({ width: 16, height: 16 });
    expect(atlas!.pixels.every((p) => p === 0xff0000)).toBe(true);
    expect(obj).toContain('o Texturas');
    expect(obj.match(/^vt /gm)).toHaveLength(4);
    expect(obj.match(/^v /gm)).toHaveLength(8 + 4);
    expect(mtl).toContain('map_Kd mono-texture.png');
    expect(mtl).toContain('map_d mono-texture.png');
    const uvs = [...obj.matchAll(/^vt (\S+) (\S+)$/gm)].map((m) => [Number(m[1]), Number(m[2])]);
    for (const [u, v] of uvs) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('los índices de las caras apuntan a vértices y coordenadas que existen', () => {
    const piece = cube();
    const texture = textureOfFace(piece, 1);
    texture.pixels[5] = 0x00ff00;
    const { obj } = buildObj([withFaceTexture(piece, 1, texture), cube(3, 0xaa0000)], 'dos');
    const vertices = obj.match(/^v /gm)!.length;
    const coords = obj.match(/^vt /gm)!.length;
    for (const m of obj.matchAll(/^f (.+)$/gm)) {
      for (const part of m[1].split(' ')) {
        const [v, t] = part.split('/').map(Number);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(vertices);
        if (t !== undefined) {
          expect(t).toBeGreaterThanOrEqual(1);
          expect(t).toBeLessThanOrEqual(coords);
        }
      }
    }
  });
});
