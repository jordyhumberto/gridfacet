import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { parseProjectFull, serializeProject } from './project';
import { defaultReference, nextReferenceId, parseReferences, referenceTransform, withPlane } from './references';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

describe('imágenes de referencia', () => {
  it('una imagen nueva queda al fondo de la sala, de frente y apoyada en el suelo', () => {
    const r = defaultReference(1, 'perfil', IMAGE, 2, 16);
    const t = referenceTransform(r);
    expect(t.position).toEqual([0, 2, -8]);
    expect(t.width).toBe(8);
    expect(t.height).toBe(4);
    expect(t.rotation).toEqual([0, 0, 0]);
  });

  it('de lado queda mirando a +X y desde arriba tumbada', () => {
    const base = defaultReference(1, 'a', IMAGE, 1, 16);
    const side = referenceTransform(withPlane(base, 'side', 16));
    expect(side.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(side.position[0]).toBe(-8);
    const top = referenceTransform(withPlane(base, 'top', 16));
    expect(top.rotation[0]).toBeCloseTo(-Math.PI / 2);
    expect(top.position[1]).toBeLessThan(0);
  });

  it('numera las imágenes sin repetir', () => {
    const a = defaultReference(1, 'a', IMAGE, 1, 16);
    const b = defaultReference(nextReferenceId([a]), 'b', IMAGE, 1, 16);
    expect(b.id).toBe(2);
    expect(nextReferenceId([])).toBe(1);
  });

  it('se guardan en el proyecto y se leen igual', () => {
    const piece = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
    const ref = { ...defaultReference(1, 'frente', IMAGE, 1.5, 16), opacity: 0.4, visible: false };
    const back = parseProjectFull(serializeProject([piece], [], 16, undefined, undefined, [ref])).references;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ name: 'frente', data: IMAGE, aspect: 1.5, plane: 'front', opacity: 0.4, visible: false, width: 8 });
  });

  it('un proyecto sin imágenes sigue abriéndose, y no escribe el campo', () => {
    const piece = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
    const text = serializeProject([piece]);
    expect(text).not.toContain('references');
    expect(parseProjectFull(text).references).toEqual([]);
  });

  it('descarta las imágenes dañadas sin tirar el resto', () => {
    const good = defaultReference(1, 'ok', IMAGE, 1, 16);
    const list = parseReferences([good, { ...good, data: 'http://malo' }, { ...good, aspect: 0 }, { ...good, plane: 'nada' }, null, { ...good, opacity: 7 }]);
    expect(list).toHaveLength(2);
    expect(list[1].opacity).toBe(1);
    expect(parseReferences('x')).toEqual([]);
  });
});
