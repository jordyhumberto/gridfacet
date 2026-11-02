/** Una paleta con nombre: colores 0xRRGGBB sin repetir, en su orden. */
export interface Palette {
  name: string;
  colors: number[];
}

/**
 * Lee colores de un texto: un valor hexadecimal de 6 cifras por línea (formato .hex de Lospec), con o sin "#",
 * o varios separados por comas, espacios o punto y coma. Lo que no sea un color se ignora; los repetidos se quitan.
 */
export function parseHexColors(text: string): number[] {
  const seen = new Set<number>();
  for (const token of text.split(/[\s,;]+/)) {
    const match = /^#?([0-9a-f]{6})$/i.exec(token);
    if (match) seen.add(parseInt(match[1], 16));
  }
  return [...seen];
}

/** El mismo formato que lee `parseHexColors`: un color por línea, sin "#". */
export function toHexText(colors: number[]): string {
  return colors.map((c) => c.toString(16).padStart(6, '0')).join('\n') + '\n';
}

/** Valida lo guardado en el navegador: descarta paletas mal formadas sin romper las demás. */
export function parsePalettes(raw: unknown): Palette[] {
  if (!Array.isArray(raw)) return [];
  const out: Palette[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, colors } = item as { name?: unknown; colors?: unknown };
    if (typeof name !== 'string' || !name.trim() || !Array.isArray(colors)) continue;
    const valid = colors.filter((c): c is number => Number.isInteger(c) && c >= 0 && c <= 0xffffff);
    if (valid.length > 0) out.push({ name: name.trim(), colors: [...new Set(valid)] });
  }
  return out;
}

/** Guarda o reemplaza (por nombre, sin distinguir mayúsculas) una paleta; devuelve la lista nueva. */
export function upsertPalette(palettes: Palette[], palette: Palette): Palette[] {
  const key = palette.name.toLowerCase();
  const next = palettes.filter((p) => p.name.toLowerCase() !== key);
  return [...next, palette];
}
