import { describe, expect, it } from 'vitest';
import { meshNeedReason, titleWithReason, type MeshSituation } from './meshNeeds';

const nothing: MeshSituation = { count: 0, mostInOnePiece: 0, fullFaces: 0, symmetric: false };

describe('motivo de un botón de Malla apagado', () => {
  it('Elegir todos nunca se apaga y Soldar cercanos tampoco', () => {
    expect(meshNeedReason('all', nothing)).toBeNull();
    expect(meshNeedReason('weld', nothing)).toBeNull();
  });

  it('sin vértices elegidos dice qué elegir', () => {
    expect(meshNeedReason('face', nothing)).toContain('3 o más vértices');
    expect(meshNeedReason('bevel', nothing)).toContain('arista');
    expect(meshNeedReason('delete', nothing)).toContain('al menos 1 vértice');
    expect(meshNeedReason('rotate', nothing)).toContain('no hay ninguno');
  });

  it('con vértices de varias piezas pide que sean de la misma', () => {
    const reason = meshNeedReason('merge', { count: 3, mostInOnePiece: 1, fullFaces: 0, symmetric: false });
    expect(reason).toContain('hay 3');
    expect(reason).toContain('solo 1 en una misma pieza');
    expect(meshNeedReason('merge', { count: 3, mostInOnePiece: 3, fullFaces: 0, symmetric: false })).toBeNull();
  });

  it('las acciones de cara piden una cara entera elegida', () => {
    for (const action of ['delface', 'triangulate', 'push', 'flip', 'extrude']) {
      expect(meshNeedReason(action, nothing), action).toContain('una cara con todos sus vértices');
      expect(meshNeedReason(action, { ...nothing, count: 4, mostInOnePiece: 4, fullFaces: 1 }), action).toBeNull();
    }
  });

  it('Simetrizar pide la simetría activa', () => {
    expect(meshNeedReason('symmetrize', nothing)).toContain('simetría');
    expect(meshNeedReason('symmetrize', { ...nothing, symmetric: true })).toBeNull();
  });

  it('el título lleva el motivo delante solo si el botón está apagado', () => {
    expect(titleWithReason('Hace algo', null)).toBe('Hace algo');
    expect(titleWithReason('Hace algo', 'necesita X')).toBe('Apagado: necesita X. Hace algo');
  });
});
