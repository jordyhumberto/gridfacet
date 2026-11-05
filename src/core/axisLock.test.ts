import { describe, expect, it } from 'vitest';
import { PLANE_XY, PLANE_XZ, PLANE_YZ, axisAllowed, lockLabel, planeNormal } from './axisLock';

describe('límite de movimiento por eje o plano', () => {
  it('libre deja pasar todo y un eje deja solo ese', () => {
    expect([0, 1, 2].map((a) => axisAllowed(null, a))).toEqual([true, true, true]);
    expect([0, 1, 2].map((a) => axisAllowed(1, a))).toEqual([false, true, false]);
  });

  it('cada plano deja fijo el eje que le falta', () => {
    expect([0, 1, 2].map((a) => axisAllowed(PLANE_XY, a))).toEqual([true, true, false]);
    expect([0, 1, 2].map((a) => axisAllowed(PLANE_XZ, a))).toEqual([true, false, true]);
    expect([0, 1, 2].map((a) => axisAllowed(PLANE_YZ, a))).toEqual([false, true, true]);
  });

  it('da nombre a los límites y al eje que fija cada plano', () => {
    expect([0, 1, 2, PLANE_XY, PLANE_XZ, PLANE_YZ].map(lockLabel)).toEqual(['X', 'Y', 'Z', 'XY', 'XZ', 'YZ']);
    expect([null, 0, PLANE_XY, PLANE_XZ, PLANE_YZ].map(planeNormal)).toEqual([null, null, 2, 1, 0]);
  });
});
