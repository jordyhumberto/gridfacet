import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { clipPiece, faceNormal, makePiece, type Piece } from './piece';
import { extrudeFaceChange } from './modeling';
import { blankTexture, pointOf, sampleTexture, textureSizeFor, uvOf } from './texture';

const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);

/** Cubo con un color distinto por píxel en cada cara. */
function texturedCube(): Piece {
  const base = cube();
  return makePiece(base.faces, base.color, undefined, base.faces.map((face, f) => {
    const { w, h } = textureSizeFor(face);
    const texture = blankTexture(w, h);
    for (let i = 0; i < w * h; i++) texture.pixels[i] = ((f + 1) << 20) | (i + 1);
    return texture;
  }));
}

const xs = (piece: Piece) => piece.faces.flat().map((p) => p[0]);

describe('cortar conserva las texturas', () => {
  it('una cara que no cambia conserva su textura; la tapa nueva no lleva', () => {
    const piece = texturedCube();
    const mid = (Math.min(...xs(piece)) + Math.max(...xs(piece))) / 2;
    const result = clipPiece(piece, { n: [1, 0, 0], d: mid })!;
    const untouched = result.faces.findIndex((face) => piece.faces.some((f) => f.length === face.length && f.every((q, k) => q.every((c, j) => c === face[k][j]))));
    expect(untouched).toBeGreaterThanOrEqual(0);
    const original = piece.faces.findIndex((f) => f.every((q, k) => q.every((c, j) => c === result.faces[untouched][k][j])));
    expect(result.faceTextures![untouched]).toBe(piece.faceTextures![original]);
    const cap = result.faces.findIndex((face) => face.every((p) => Math.abs(p[0] - mid) < 1e-9));
    expect(result.faceTextures![cap]).toBeNull();
  });

  it('una cara recortada mantiene cada píxel en su sitio del espacio', () => {
    const piece = texturedCube();
    const mid = (Math.min(...xs(piece)) + Math.max(...xs(piece))) / 2;
    const result = clipPiece(piece, { n: [1, 0, 0], d: mid })!;
    let resampled = 0;
    result.faces.forEach((face, i) => {
      const target = result.faceTextures?.[i];
      if (!target) return;
      // La cara original es la que contiene todos los vértices nuevos en su plano.
      const sourceIndex = piece.faces.findIndex((f) => {
        const origin = f[0];
        const a = [f[1][0] - origin[0], f[1][1] - origin[1], f[1][2] - origin[2]];
        const b = [f[2][0] - origin[0], f[2][1] - origin[1], f[2][2] - origin[2]];
        const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        return face.every((q) => Math.abs((q[0] - origin[0]) * n[0] + (q[1] - origin[1]) * n[1] + (q[2] - origin[2]) * n[2]) < 1e-9);
      });
      const source = piece.faceTextures![sourceIndex]!;
      for (let y = 0; y < target.h; y++) {
        for (let x = 0; x < target.w; x++) {
          const q = pointOf(face, (x + 0.5) / target.w, (y + 0.5) / target.h);
          const [s, t] = uvOf(piece.faces[sourceIndex], q);
          expect(target.pixels[y * target.w + x]).toBe(sampleTexture(source, s, t));
        }
      }
      resampled++;
    });
    expect(resampled).toBeGreaterThan(0);
  });

  it('sin texturas el resultado tampoco las tiene', () => {
    const mid = (Math.min(...xs(cube())) + Math.max(...xs(cube()))) / 2;
    expect(clipPiece(cube(), { n: [1, 0, 0], d: mid })!.faceTextures).toBeUndefined();
  });
});

describe('crecer lleva la textura a la cara de arriba', () => {
  const topOf = (piece: Piece) => piece.faces.findIndex((f) => faceNormal(f)[1] > 0.5);

  it('la cara nueva repite los píxeles de la cara de origen en su sitio', () => {
    const piece = texturedCube();
    const index = topOf(piece);
    const { added } = extrudeFaceChange(piece, index, 0.5);
    const body = added[0];
    const top = topOf(body);
    const source = piece.faceTextures![index]!;
    const target = body.faceTextures![top]!;
    expect(target).toBeTruthy();
    for (let y = 0; y < source.h; y++) {
      for (let x = 0; x < source.w; x++) {
        const q = pointOf(piece.faces[index], (x + 0.5) / source.w, (y + 0.5) / source.h);
        const [s, t] = uvOf(body.faces[top], [q[0], q[1] + 0.5, q[2]]);
        expect(sampleTexture(target, s, t)).toBe(source.pixels[y * source.w + x]);
      }
    }
    // Las demás caras del cuerpo nuevo nacen sin pintar.
    expect(body.faceTextures!.filter(Boolean)).toHaveLength(1);
  });

  it('sin textura en la cara de origen el cuerpo nuevo no lleva ninguna', () => {
    const piece = cube();
    expect(extrudeFaceChange(piece, topOf(piece), 0.5).added[0].faceTextures).toBeUndefined();
  });
});
