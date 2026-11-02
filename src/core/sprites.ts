/** Vista de la cámara que mira el modelo: ángulo sobre el suelo y a qué eje apunta "arriba" en pantalla. */
export type SpriteCamera = 'isometric' | 'top' | 'side';

/** Elevación de la cámara en grados: 30° es la vista isométrica de píxel art. */
export const CAMERA_ELEVATION: Record<SpriteCamera, number> = { isometric: 30, top: 90, side: 0 };

/** Giros alrededor del modelo, en grados, repartidos por igual; la primera vista mira de frente. */
export function viewYaws(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i * 360) / count);
}

/** Cómo se ordenan las vistas en una hoja de sprites: de izquierda a derecha y de arriba abajo, en una cuadrícula casi cuadrada. */
export function sheetLayout(count: number, cell: number): { cols: number; rows: number; width: number; height: number; at: (i: number) => [number, number] } {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return {
    cols,
    rows,
    width: cols * cell,
    height: rows * cell,
    at: (i) => [(i % cols) * cell, Math.floor(i / cols) * cell],
  };
}

/**
 * Dibuja un contorno de un píxel (en `color`, 0xRRGGBB) alrededor de lo que no es transparente.
 * `rgba` son filas de arriba abajo, 4 bytes por píxel; devuelve una copia.
 */
export function addOutline(rgba: Uint8ClampedArray, width: number, height: number, color: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && rgba[(y * width + x) * 4 + 3] > 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (rgba[at + 3] > 0) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        out[at] = (color >> 16) & 255;
        out[at + 1] = (color >> 8) & 255;
        out[at + 2] = color & 255;
        out[at + 3] = 255;
      }
    }
  }
  return out;
}

/** Voltea las filas (la lectura de la tarjeta gráfica viene de abajo arriba). */
export function flipRows(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) out.set(rgba.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return out;
}

/** Nombre de archivo de una vista: proyecto, tamaño y número (empezando en 1). */
export function spriteFileName(project: string, size: number, view: number): string {
  return `${project.replace(/\.json$/i, '').replace(/[\\/:*?"<>|]+/g, '_')}-${size}px-view${view}.png`;
}
