import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { paintChange } from './paint';
import { makePiece, withLayer, type Piece, type Vec3 } from './piece';
import { parseProjectFull, serializeProject } from './project';
import { reflectPiece } from './symmetry';
import { CLEAR, blankTexture, normalizeTextures, packTexture, pointOf, remapTexture, sampleTexture, textureSizeFor, unpackTexture, uvOf, type FaceTexture } from './texture';
import { mirrorPiece, rotatePieceY, translatePiece } from './transform';

const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);

/** Textura asimétrica: cada píxel lleva un color distinto según su posición, para notar giros y espejos. */
function patterned(w: number, h: number): FaceTexture {
  const texture = blankTexture(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x * 3 + y * 5) % 4 !== 0) texture.pixels[y * w + x] = ((x + 1) << 16) | ((y + 1) << 8) | 7;
  return texture;
}

/** Cubo con una textura asimétrica distinta en cada cara. */
function texturedCube(): Piece {
  const base = cube();
  return makePiece(base.faces, base.color, undefined, base.faces.map((face) => {
    const { w, h } = textureSizeFor(face);
    return patterned(w, h);
  }));
}

/** Cada píxel de la cara `from` debe seguir en el mismo sitio de la cara `to` al pasar por `map`. */
function expectSameSurface(from: Piece, to: Piece, map: (p: Vec3) => Vec3): void {
  from.faces.forEach((face, i) => {
    const source = from.faceTextures![i]!;
    const target = to.faceTextures![i]!;
    for (let y = 0; y < source.h; y++) {
      for (let x = 0; x < source.w; x++) {
        const q = pointOf(face, (x + 0.5) / source.w, (y + 0.5) / source.h);
        const [s, t] = uvOf(to.faces[i], map(q));
        expect(sampleTexture(target, s, t)).toBe(source.pixels[y * source.w + x]);
      }
    }
  });
}

describe('marco y tamaño de una cara', () => {
  it('uvOf y pointOf son inversas y el origen está arriba a la izquierda', () => {
    const face = cube().faces[0];
    for (const [s, t] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.75]] as const) {
      const [s2, t2] = uvOf(face, pointOf(face, s, t));
      expect(s2).toBeCloseTo(s);
      expect(t2).toBeCloseTo(t);
    }
  });

  it('una cara de una celda mide 16 × 16 píxeles y una de 2 × 1 mide 32 × 16', () => {
    expect(textureSizeFor(cube().faces[0])).toEqual({ w: 16, h: 16 });
    const wide = buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);
    const stretched = wide.faces.map((face) => face.map((p): Vec3 => [p[0] * 2, p[1], p[2]]));
    const sizes = stretched.map(textureSizeFor).map(({ w, h }) => `${w}x${h}`);
    expect(sizes).toContain('32x16');
  });
});

describe('guardado compacto', () => {
  it('empaqueta y desempaqueta sin perder píxeles', () => {
    const texture = patterned(8, 6);
    expect(unpackTexture(packTexture(texture))).toEqual(texture);
  });

  it('una textura casi vacía ocupa pocos números', () => {
    const texture = blankTexture(16, 16);
    texture.pixels[100] = 0xff0000;
    expect(packTexture(texture).runs.length).toBeLessThanOrEqual(6);
  });

  it('rechaza datos que no cuadran', () => {
    expect(unpackTexture(null)).toBeNull();
    expect(unpackTexture({ w: 2, h: 2, runs: [3, -1] })).toBeNull();
    expect(unpackTexture({ w: 2, h: 2, runs: [5, -1] })).toBeNull();
    expect(unpackTexture({ w: 2, h: 2, runs: [4, 0x1000000] })).toBeNull();
    expect(unpackTexture({ w: 0, h: 2, runs: [] })).toBeNull();
    expect(unpackTexture({ w: 2, h: 2, runs: [4, -1, 1] })).toBeNull();
  });

  it('las texturas en blanco no se guardan', () => {
    expect(normalizeTextures([blankTexture(2, 2), null])).toBeUndefined();
    expect(makePiece(cube().faces, 1, undefined, cube().faces.map(() => blankTexture(2, 2))).faceTextures).toBeUndefined();
  });
});

describe('las texturas viajan con la pieza', () => {
  it('mover y girar las conservan tal cual', () => {
    const piece = texturedCube();
    const moved = translatePiece(piece, 3, 1, -2);
    expect(moved.faceTextures).toEqual(piece.faceTextures);
    expect(rotatePieceY(piece, 1, 0, 0).faceTextures).toEqual(piece.faceTextures);
  });

  it('cambiar de capa y pintar otra cara las conservan', () => {
    const piece = texturedCube();
    expect(withLayer(piece, 2).faceTextures).toEqual(piece.faceTextures);
    const painted = paintChange([{ piece, index: 0 }], 0xff00ff).added[0];
    expect(painted.faceTextures).toEqual(piece.faceTextures);
  });

  it('el espejo deja cada píxel en su sitio sobre la superficie', () => {
    const piece = texturedCube();
    const mirrored = mirrorPiece(piece, 'x', 0.5);
    const flip = (p: Vec3): Vec3 => [1 - p[0], p[1], p[2]];
    expectSameSurface(piece, mirrored, flip);
  });

  it('la simetría también', () => {
    const piece = texturedCube();
    const reflection = { point: (p: Vec3): Vec3 => [-p[0], p[1], p[2]], dir: (v: Vec3): Vec3 => [-v[0], v[1], v[2]], flips: true };
    expectSameSurface(piece, reflectPiece(piece, reflection), reflection.point);
  });

  it('remapTexture con la identidad devuelve lo mismo', () => {
    const face = cube().faces[2];
    const texture = patterned(16, 16);
    expect(remapTexture(texture, face, face, (p) => p)).toEqual(texture);
  });
});

describe('proyecto guardado', () => {
  it('las texturas sobreviven a guardar y abrir', () => {
    const piece = texturedCube();
    const { pieces } = parseProjectFull(serializeProject([piece]));
    expect(pieces[0].faceTextures).toEqual(piece.faceTextures);
  });

  it('un proyecto sin texturas no escribe nada de más', () => {
    expect(serializeProject([cube()])).not.toContain('faceTextures');
  });

  it('una textura dañada se descarta y la pieza se abre igual', () => {
    const text = serializeProject([texturedCube()]).replace(/"runs":\[[^\]]*\]/, '"runs":[1]');
    const { pieces } = parseProjectFull(text);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].faceTextures?.[0] ?? null).toBeNull();
    expect(pieces[0].faceTextures?.[1]).toBeTruthy();
  });

  it('CLEAR es el valor de píxel sin pintar', () => {
    expect(CLEAR).toBe(-1);
  });
});
