import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import { MESH_ICON_NAMES } from './meshIcons';

const panel = html.slice(html.indexOf('id="meshActions"'), html.indexOf('id="bevelActions"'));

describe('iconos de Malla', () => {
  it('cada data-icon del panel tiene su dibujo', () => {
    const used = [...panel.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(35);
    expect(used.filter((name) => !MESH_ICON_NAMES.has(name))).toEqual([]);
  });

  it('cada botón de acción lleva icono y nombre', () => {
    const buttons = [...panel.matchAll(/<button [^>]*>/g)].map((m) => m[0]);
    expect(buttons.length).toBeGreaterThan(30);
    expect(buttons.filter((b) => !/data-icon="/.test(b) || !/aria-label="/.test(b) || !/title="/.test(b))).toEqual([]);
  });
});
