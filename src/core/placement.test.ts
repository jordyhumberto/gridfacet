import { describe, expect, it } from 'vitest';
import { buildPieces, buildSlab, CATALOG, SLAB_THICKNESS } from './catalog';
import { clearanceLift, edgeLines, flatSurface, gridLines, magnetLines, snapSpan } from './placement';
import { volume } from './piece';
import { boundsOf } from './transform';

const def = (id: string) => CATALOG.find((d) => d.id === id)!;
const at = (id: string, cx: number, cyPlates: number, cz: number, scale = 1) => buildPieces(def(id), cx, cyPlates, cz, 0, 0xff0000, scale);
/** Cubito de medio de lado. */
const small = (cx: number, cyPlates: number, cz: number) => at('cube', cx, cyPlates, cz, 0.5);

describe('subir para no meterse en otras piezas', () => {
  it('una pieza pegada a una rampa no sube aunque sus cajas se solapen', () => {
    // La rampa sube hacia +z (alto = z); su caja ocupa toda la celda pero sobre la parte baja hay aire.
    const ramp = at('ramp', 0, 0, 0);
    const box = boundsOf(ramp)!;
    // Cubito de ¼ sobre la pendiente (alto 0,75 a z = 0,5, donde la rampa llega a 0,5), dentro de su caja envolvente.
    const bit = at('cube', 0.25, 2.25, 0.5, 0.25);
    const bitBox = boundsOf(bit)!;
    const overlapsBox = [0, 1, 2].every((i) => bitBox.min[i] < box.max[i] && box.min[i] < bitBox.max[i]);
    expect(overlapsBox).toBe(true);
    expect(clearanceLift(bit, ramp)).toBe(0);
  });

  it('sin nada debajo no sube', () => {
    expect(clearanceLift(at('cube', 0, 0, 0), [])).toBe(0);
  });

  it('apoyado sobre un cubo exacto, tampoco', () => {
    expect(clearanceLift(at('cube', 0, 3, 0), at('cube', 0, 0, 0))).toBe(0);
  });

  it('un cubo apuntado a la altura de un cubito baja del todo si otro cuadrante es más alto', () => {
    // Un cubito (¼) sobre el suelo, y otro cubo grande de 2 placas más arriba en la misma celda
    const lowStep = small(0, 0, 0);
    const parts = at('cube', 0, 1.5, 0);
    const lift = clearanceLift(parts, lowStep);
    // El cubito mide 1,5 placas; el cubo ya está sobre él (1,5 placas), así que no sube
    expect(lift).toBe(0);
  });

  it('sube hasta la cima de lo que lo atraviesa, en pasos de media placa', () => {
    const blocker = at('cube', 0, 0, 0); // llega a y = 1
    const parts = at('cube', 0, 1, 0); // arranca a y = 1/3: se mete dentro
    const lift = clearanceLift(parts, blocker);
    expect(boundsOf(parts)!.min[1] + lift).toBeCloseTo(1, 6);
  });

  it('con una cuña de 1,5 placas en una esquina y el cubo a 1 placa, queda encima', () => {
    const step = small(0.5, 0, 0.5); // 0,5 de alto
    const parts = at('cube', 0, 0.5, 0); // arranca a y = 1/6
    const lift = clearanceLift(parts, step);
    expect(boundsOf(parts)!.min[1] + lift).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(lift * 6).toBeCloseTo(Math.round(lift * 6), 6);
  });

  it('piezas que solo se tocan por un lado no cuentan', () => {
    expect(clearanceLift(at('cube', 1, 0, 0), at('cube', 0, 0, 0))).toBe(0);
  });

  it('si hay varias capas, sube por encima de todas', () => {
    const tower = [...at('cube', 0, 0, 0), ...at('cube', 0, 3, 0)];
    const parts = at('cube', 0, 1, 0);
    const lift = clearanceLift(parts, tower);
    expect(boundsOf(parts)!.min[1] + lift).toBeCloseTo(2, 6);
  });
});

describe('lámina que crece desde una cara', () => {
  it.each([
    [1, 1, 1],
    [1, -1, 1],
    [0, 1, 0.5],
    [0, -1, 0.5],
    [2, 1, 2],
    [2, -1, 2],
  ] as const)('eje %i, signo %i: grosor de un cuarto pegado a la cara', (axis, sign, surface) => {
    const slab = buildSlab(axis, sign, surface, [0, 0, 0], 0x00ff00);
    expect(volume(slab)).toBeCloseTo(SLAB_THICKNESS, 6);
    const box = boundsOf([slab])!;
    const [lo, hi] = [box.min[axis], box.max[axis]];
    if (sign > 0) expect(lo).toBeCloseTo(surface, 6);
    else expect(hi).toBeCloseTo(surface, 6);
    expect(hi - lo).toBeCloseTo(SLAB_THICKNESS, 6);
  });

  it('con lado y grosor a medida', () => {
    const slab = buildSlab(1, 1, 2, [3, 0, -4], 0, 0.5, 0.125);
    expect(volume(slab)).toBeCloseTo(0.5 * 0.5 * 0.125, 6);
    const box = boundsOf([slab])!;
    expect(box.min[1]).toBeCloseTo(2);
    expect(box.max[1]).toBeCloseTo(2.125);
    expect(box.max[0] - box.min[0]).toBeCloseTo(0.5);
  });

  it('en los otros ejes ocupa una celda entera desde la esquina dada', () => {
    const box = boundsOf([buildSlab(1, 1, 2, [3, 0, -4], 0)])!;
    expect(box.min[0]).toBeCloseTo(3);
    expect(box.max[0]).toBeCloseTo(4);
    expect(box.min[2]).toBeCloseTo(-4);
    expect(box.max[2]).toBeCloseTo(-3);
  });
});

describe('mover una pieza pequeña dentro de una cara', () => {
  it('sin nada cerca sigue al cursor en pasos de un cuarto de su tamaño', () => {
    // Medio de lado: pasos de 0,125, con el cursor en el centro de la pieza.
    expect(snapSpan(2.37, 0.5, [])).toBeCloseTo(2.125);
    expect(snapSpan(2.45, 0.5, [])).toBeCloseTo(2.25);
  });

  it('con el tamaño más pequeño también se mueve en pasos propios', () => {
    expect(snapSpan(1.5, 0.25, [])).toBeCloseTo(1.375);
    expect(snapSpan(1.56, 0.25, [])).toBeCloseTo(1.4375);
  });

  it('se imanta con su borde o su centro a una línea cercana', () => {
    expect(snapSpan(2.28, 0.5, [2])).toBeCloseTo(2); // borde menor sobre la línea
    expect(snapSpan(1.72, 0.5, [2])).toBeCloseTo(1.5); // borde mayor sobre la línea
    expect(snapSpan(2.02, 0.5, [2])).toBeCloseTo(1.75); // centro sobre la línea
  });

  it('no se imanta a líneas lejanas', () => {
    expect(snapSpan(2.6, 0.5, [2])).toBeCloseTo(2.375);
  });

  it('se queda dentro de la cara que lo recibe', () => {
    expect(snapSpan(0.05, 0.5, [], 0, 1)).toBeCloseTo(0);
    expect(snapSpan(1.2, 0.5, [], 0, 1)).toBeCloseTo(0.5);
  });

  it('las líneas incluyen los bordes de las piezas próximas y la rejilla', () => {
    const [cube] = at('cube', 1.1, 0, 0, 0.8);
    const lines = magnetLines([cube], 0, [1.5, 0.1, 0.4], 0.6);
    expect(lines.some((l) => Math.abs(l - 1.1) < 1e-6)).toBe(true);
    expect(lines.some((l) => Math.abs(l - 1.9) < 1e-6)).toBe(true);
    expect(lines).toContain(1);
    expect(lines).toContain(2);
  });

  it('una pieza lejana no aporta sus bordes', () => {
    const [far] = at('cube', 8, 0, 8);
    expect(magnetLines([far], 0, [1.5, 0.1, 0.4], 0.6)).not.toContain(8);
  });
});

describe('superficie continua', () => {
  const cube = (x: number, y: number) => at('cube', x, y * 3, 0)[0];
  it('cuatro cubos juntos forman una sola pared', () => {
    const wall = [cube(0, 0), cube(1, 0), cube(0, 1), cube(1, 1)];
    const surface = flatSurface(wall, 2, 1, [0.5, 0.5, 1])!;
    expect(surface.min[0]).toBeCloseTo(0);
    expect(surface.max[0]).toBeCloseTo(2);
    expect(surface.min[1]).toBeCloseTo(0);
    expect(surface.max[1]).toBeCloseTo(2);
  });

  it('un cubo separado no se suma a la superficie', () => {
    const surface = flatSurface([cube(0, 0), cube(1, 0), cube(5, 0)], 2, 1, [0.5, 0.5, 1])!;
    expect(surface.max[0]).toBeCloseTo(2);
  });

  it('un escalón en otra profundidad no cuenta como la misma cara', () => {
    const behind = at('cube', 1, 0, -1)[0];
    const surface = flatSurface([cube(0, 0), behind], 2, 1, [0.5, 0.5, 1])!;
    expect(surface.max[0]).toBeCloseTo(1);
  });

  it('sin cara bajo el cursor devuelve null', () => {
    expect(flatSurface([cube(0, 0)], 2, 1, [3, 0.5, 1])).toBeNull();
  });
});

describe('imán: bordes de piezas antes que rejilla y centros', () => {
  it('un borde de pieza gana a la línea de la rejilla de placas', () => {
    // Escalón de cubitos de ¼ cuyo borde está en 0,25; la rejilla de placas (⅓) cae a 0,0083 de distancia del centro.
    expect(snapSpan(0.31, 0.25, [0.25, 0.5], undefined, undefined, [1 / 3])).toBeCloseTo(0.25);
  });

  it('un borde de pieza gana al centrado en esa misma pieza si ambos están cerca', () => {
    expect(snapSpan(0.4, 0.25, [0.25, 0.5])).toBeCloseTo(0.25);
  });

  it('sin piezas cerca la rejilla sigue imantando', () => {
    expect(snapSpan(1.27, 0.5, [], undefined, undefined, [1])).toBeCloseTo(1);
  });

  it('edgeLines y gridLines por separado forman magnetLines', () => {
    const cube = at('cube', 1, 0, 0)[0];
    const around: [number, number, number] = [1.5, 0.1, 0.4];
    expect(magnetLines([cube], 0, around, 0.6)).toEqual([...edgeLines([cube], 0, around, 0.6), ...gridLines(0, around, 0.6)]);
  });

  it('puede sobresalir hasta la mitad de su largo del borde de la cara para seguir la rejilla', () => {
    // Cara de 1.5 a 3.5: un cubo de 1 se alinea con la línea 1 y con la 4 aunque sobresalga medio cubo.
    expect(snapSpan(1.5, 1, [1, 4], 1.5, 3.5, [], 0.5)).toBeCloseTo(1);
    expect(snapSpan(4.0, 1, [1, 4], 1.5, 3.5, [], 0.5)).toBeCloseTo(3);
    expect(snapSpan(1.5, 1, [], 1.5, 3.5)).toBeCloseTo(1.5);
  });
});
