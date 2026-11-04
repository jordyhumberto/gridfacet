import { describe, expect, it } from 'vitest';
import { emptyAnimation, groupCentre, parseAnimation, pruneTracks, REST_POSE, removeKey, resize, sampleTrack, setKey, trackOf, type Pose } from './animation';
import { CATALOG, buildPiece } from './catalog';
import { withGroup } from './piece';

const pose = (x: number, rotY = 0, scale = 1): Pose => ({ pos: [x, 0, 0], rot: [0, rotY, 0], scale: [scale, scale, scale] });

describe('claves y muestreo', () => {
  it('sin claves el grupo está en reposo', () => {
    expect(sampleTrack(undefined, 5)).toEqual(REST_POSE);
  });

  it('interpola linealmente entre claves y mantiene los extremos', () => {
    let a = emptyAnimation();
    a = setKey(a, 1, 0, pose(0, 0, 1));
    a = setKey(a, 1, 10, pose(10, 90, 3));
    const track = trackOf(a, 1);
    expect(sampleTrack(track, 5).pos[0]).toBeCloseTo(5, 9);
    expect(sampleTrack(track, 5).rot[1]).toBeCloseTo(45, 9);
    expect(sampleTrack(track, 5).scale[0]).toBeCloseTo(2, 9);
    expect(sampleTrack(track, -3).pos[0]).toBe(0);
    expect(sampleTrack(track, 20).pos[0]).toBe(10);
  });

  it('poner una clave donde ya había otra la reemplaza, y las claves quedan en orden', () => {
    let a = emptyAnimation();
    a = setKey(a, 1, 8, pose(8));
    a = setKey(a, 1, 2, pose(2));
    a = setKey(a, 1, 8, pose(80));
    expect(trackOf(a, 1)!.keys.map((k) => [k.frame, k.pos[0]])).toEqual([[2, 2], [8, 80]]);
  });

  it('quitar la última clave quita la pista', () => {
    let a = setKey(emptyAnimation(), 3, 4, pose(1));
    a = removeKey(a, 3, 4);
    expect(a.tracks).toHaveLength(0);
  });

  it('las claves se quedan dentro de la duración', () => {
    const a = setKey(emptyAnimation(), 1, 999, pose(1));
    expect(trackOf(a, 1)!.keys[0].frame).toBe(23);
  });

  it('acortar la animación descarta las claves de más', () => {
    let a = setKey(emptyAnimation(), 1, 0, pose(0));
    a = setKey(a, 1, 20, pose(1));
    a = resize(a, 10, 12);
    expect(trackOf(a, 1)!.keys.map((k) => k.frame)).toEqual([0]);
  });
});

describe('grupos', () => {
  it('quita las pistas de grupos que ya no existen', () => {
    const p = withGroup(buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699), 7);
    let a = setKey(emptyAnimation(), 7, 0, pose(0));
    a = setKey(a, 9, 0, pose(0));
    expect(pruneTracks(a, [p]).tracks.map((t) => t.group)).toEqual([7]);
  });

  it('el centro de un grupo es el de su caja', () => {
    const a = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
    const b = buildPiece(CATALOG[0], 4, 0, 0, 0, 0x336699);
    const centre = groupCentre([a, b]);
    const xs = [a, b].flatMap((p) => p.faces.flat().map((v) => v[0]));
    expect(centre[0]).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 9);
  });
});

describe('leer una animación guardada', () => {
  it('ida y vuelta por JSON', () => {
    const a = setKey(setKey(emptyAnimation(), 2, 0, pose(0)), 2, 12, pose(5, 45));
    expect(parseAnimation(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it('descarta claves y pistas dañadas sin fallar', () => {
    const parsed = parseAnimation({
      frames: 10,
      fps: 12,
      tracks: [
        { group: 1, keys: [{ frame: 0, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }, { frame: 99, pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }, { frame: 1, pos: 'x' }] },
        { group: -4, keys: [] },
        null,
      ],
    });
    expect(parsed!.tracks).toHaveLength(1);
    expect(parsed!.tracks[0].keys).toHaveLength(1);
  });

  it('algo que no es una animación da undefined', () => {
    expect(parseAnimation(null)).toBeUndefined();
    expect(parseAnimation({ frames: 'x' })).toBeUndefined();
  });
});
