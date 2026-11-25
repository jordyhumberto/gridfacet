import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import { ICON_NAMES } from './paintIcons';

describe('iconos de Pintar', () => {
  it('cada data-icon del panel tiene su dibujo', () => {
    const used = [...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(20);
    expect(used.filter((name) => !ICON_NAMES.has(name))).toEqual([]);
  });

  it('cada herramienta de píxeles de la lista tiene su botón', () => {
    const list = html.match(/<select id="pixelTool"[^>]*>(.*?)<\/select>/)![1];
    const options = [...list.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
    const buttons = [...html.matchAll(/data-pixeltool="([^"]+)"/g)].map((m) => m[1]);
    expect(buttons.sort()).toEqual(options.sort());
  });
});
