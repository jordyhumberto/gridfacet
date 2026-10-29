import { makePiece, type Piece, type Vec3 } from './piece';

/** Una celda mide 1 en X/Z; la altura se mide en placas (1 placa = 1/3 de celda). */
export const PLATE = 1 / 3;

/** Poliedro convexo como lista de caras, con las normales hacia fuera (antihorario visto desde fuera). */
type Solid = Vec3[][];

export interface PieceDef {
  id: string;
  name: string;
  /** Texto corto para el botón del panel. */
  short: string;
  /** Alto en placas. */
  heightPlates: number;
  /** Huella en celdas [ancho en X, fondo en Z] antes de girar. */
  footprint: [number, number];
  /**
   * Poliedros convexos que forman la pieza, en coordenadas locales con la esquina mínima en el origen.
   * Una forma cóncava (como una esquina interior o un arco) se compone de varias partes convexas.
   */
  parts(h: number): Solid[];
  /** La pieza no se apoya en la rejilla: crece pegada a la cara a la que se apunta (ver `buildSlab`). */
  grows?: boolean;
}

function box(w: number, h: number, d: number): Solid {
  return [
    [[0, 0, 0], [w, 0, 0], [w, 0, d], [0, 0, d]],
    [[0, h, 0], [0, h, d], [w, h, d], [w, h, 0]],
    [[0, 0, 0], [0, h, 0], [w, h, 0], [w, 0, 0]],
    [[0, 0, d], [w, 0, d], [w, h, d], [0, h, d]],
    [[0, 0, 0], [0, 0, d], [0, h, d], [0, h, 0]],
    [[w, 0, 0], [w, h, 0], [w, h, d], [w, 0, d]],
  ];
}

/** Cuña: la cara inclinada baja hacia z = 0. */
function ramp(h: number): Solid {
  return [
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 1], [1, h, 1], [0, h, 1]],
    [[0, 0, 0], [0, 0, 1], [0, h, 1]],
    [[1, 0, 0], [1, h, 1], [1, 0, 1]],
    [[0, 0, 0], [0, h, 1], [1, h, 1], [1, 0, 0]],
  ];
}

/** Pirámide con la punta sobre la esquina (0, 0): el remate de un tejado a cuatro aguas. */
function outerCorner(h: number): Solid {
  return [
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 0, 0], [0, h, 0], [1, 0, 0]],
    [[0, 0, 0], [0, 0, 1], [0, h, 0]],
    [[1, 0, 0], [0, h, 0], [1, 0, 1]],
    [[1, 0, 1], [0, h, 0], [0, 0, 1]],
  ];
}

/** Espeja una pieza intercambiando X y Z; al invertir la orientación hay que dar la vuelta a las caras. */
function swapXZ(solid: Solid): Solid {
  return solid.map((face) => face.map((p): Vec3 => [p[2], p[1], p[0]]).reverse());
}

/** Valle donde dos rampas se encuentran: la altura es h·máx(x, z), que es cóncava y se parte en dos cuñas. */
function innerCorner(h: number): Solid[] {
  const wedge: Solid = [
    [[0, 0, 0], [1, 0, 0], [1, 0, 1]],
    [[1, 0, 0], [1, h, 0], [1, h, 1], [1, 0, 1]],
    [[0, 0, 0], [1, h, 0], [1, 0, 0]],
    [[0, 0, 0], [1, 0, 1], [1, h, 1]],
    [[0, 0, 0], [1, h, 1], [1, h, 0]],
  ];
  return [wedge, swapXZ(wedge)];
}

/** Extruye en Z un polígono convexo del plano XY (antihorario) entre z = 0 y z = d. */
function prism(poly: [number, number][], d: number): Solid {
  const faces: Solid = [
    poly.map(([x, y]): Vec3 => [x, y, 0]).reverse(),
    poly.map(([x, y]): Vec3 => [x, y, d]),
  ];
  poly.forEach(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    faces.push([[ax, ay, 0], [bx, by, 0], [bx, by, d], [ax, ay, d]]);
  });
  return faces;
}

const CYLINDER_SIDES = 16;

function cylinder(h: number): Solid {
  const ring = (i: number): [number, number] => {
    const a = (2 * Math.PI * i) / CYLINDER_SIDES;
    return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)];
  };
  const idx = [...Array(CYLINDER_SIDES).keys()];
  const faces: Solid = [
    idx.map((i): Vec3 => [ring(i)[0], 0, ring(i)[1]]),
    idx.map((i): Vec3 => [ring(i)[0], h, ring(i)[1]]).reverse(),
  ];
  for (const i of idx) {
    const [ax, az] = ring(i);
    const [bx, bz] = ring((i + 1) % CYLINDER_SIDES);
    faces.push([[bx, 0, bz], [ax, 0, az], [ax, h, az], [bx, h, bz]]);
  }
  return faces;
}

/** Arco de 2 × 1: dos pilares y, sobre una abertura de medio círculo de 8 lados, cuatro piezas que forman el dintel. */
function arch(h: number): Solid[] {
  const k = 0.5 * Math.SQRT1_2;
  const left = 1 - k;
  const right = 1 + k;
  const shoulder = 0.5 + k;
  const polys: [number, number][][] = [
    [[0, 0], [0.5, 0], [0.5, h], [0, h]],
    [[1.5, 0], [2, 0], [2, h], [1.5, h]],
    [[0.5, 0.5], [left, shoulder], [left, h], [0.5, h]],
    [[left, shoulder], [1, 1], [1, h], [left, h]],
    [[1, 1], [right, shoulder], [right, h], [1, h]],
    [[right, shoulder], [1.5, 0.5], [1.5, h], [right, h]],
  ];
  return polys.map((poly) => prism(poly, 1));
}

export const CATALOG: PieceDef[] = [
  { id: 'cube', name: 'Cubo', short: 'Cubo', heightPlates: 3, footprint: [1, 1], parts: (h) => [box(1, h, 1)] },
  { id: 'plate', name: 'Placa', short: 'Placa', heightPlates: 1, footprint: [1, 1], parts: (h) => [box(1, h, 1)] },
  { id: 'ramp', name: 'Rampa', short: 'Rampa', heightPlates: 3, footprint: [1, 1], parts: (h) => [ramp(h)] },
  { id: 'brick', name: 'Ladrillo 2×1', short: '2×1', heightPlates: 3, footprint: [2, 1], parts: (h) => [box(2, h, 1)] },
  {
    id: 'slab',
    name: 'Lámina (crece desde la cara a la que apuntas; lado = Tamaño, grosor aparte)',
    short: 'Lámina',
    heightPlates: 0.75,
    footprint: [1, 1],
    parts: (h) => [box(1, h, 1)],
    grows: true,
  },
  { id: 'cylinder', name: 'Cilindro', short: 'Cilindro', heightPlates: 3, footprint: [1, 1], parts: (h) => [cylinder(h)] },
  { id: 'arch', name: 'Arco', short: 'Arco', heightPlates: 4, footprint: [2, 1], parts: arch },
  { id: 'outer', name: 'Esquina exterior', short: 'Esq. ext.', heightPlates: 3, footprint: [1, 1], parts: (h) => [outerCorner(h)] },
  { id: 'inner', name: 'Esquina interior', short: 'Esq. int.', heightPlates: 3, footprint: [1, 1], parts: innerCorner },
];

/** Grosor de la lámina que crece desde una cara: un cuarto de celda. */
export const SLAB_THICKNESS = 0.25;

/**
 * Lámina de `side` × `side` y `thickness` de grosor (por defecto 1 × 1 y SLAB_THICKNESS) pegada a una cara. `axis` (0 = X, 1 = Y, 2 = Z)
 * y `sign` dicen hacia dónde mira la cara a la que se pega y `surface` dónde está; la lámina crece hacia fuera de ella. `tangentMin`
 * da la esquina mínima en los otros dos ejes (el valor del eje de la cara se ignora).
 */
export function buildSlab(
  axis: 0 | 1 | 2,
  sign: 1 | -1,
  surface: number,
  tangentMin: Vec3,
  color: number,
  side = 1,
  thickness = SLAB_THICKNESS,
): Piece {
  const min: Vec3 = [tangentMin[0], tangentMin[1], tangentMin[2]];
  min[axis] = sign > 0 ? surface : surface - thickness;
  const size: Vec3 = [side, side, side];
  size[axis] = thickness;
  const solid = box(size[0], size[1], size[2]);
  return makePiece(
    solid.map((face) => face.map((p): Vec3 => [p[0] + min[0], p[1] + min[1], p[2] + min[2]])),
    color,
  );
}

/** Gira (x, z) en múltiplos de 90° alrededor del origen. */
function rotateY(p: Vec3, quarterTurns: number): Vec3 {
  const q = ((quarterTurns % 4) + 4) % 4;
  const [x, y, z] = p;
  return [[x, y, z], [z, y, -x], [-x, y, -z], [-z, y, x]][q] as Vec3;
}

/**
 * Crea las piezas de una entrada del catálogo con la esquina mínima de su huella girada en la celda
 * (cx, cz) y la placa cyPlates. Un mismo elemento puede dar varias piezas convexas.
 * `scale` encoge o agranda la pieza entera (1 = tamaño normal) manteniendo fija su esquina mínima.
 */
export function buildPieces(def: PieceDef, cx: number, cyPlates: number, cz: number, rotation: number, color: number, scale = 1): Piece[] {
  const [w, d] = def.footprint;
  const corners = ([[0, 0], [w * scale, 0], [w * scale, d * scale], [0, d * scale]] as [number, number][]).map(([x, z]) =>
    rotateY([x, 0, z], rotation),
  );
  const minX = Math.min(...corners.map((c) => c[0]));
  const minZ = Math.min(...corners.map((c) => c[2]));
  const lift = cyPlates * PLATE;

  return def.parts(def.heightPlates * PLATE).map((solid) =>
    makePiece(
      solid.map((face) =>
        face.map((p) => {
          const r = rotateY([p[0] * scale, p[1] * scale, p[2] * scale], rotation);
          return [r[0] - minX + cx, r[1] + lift, r[2] - minZ + cz] as Vec3;
        }),
      ),
      color,
    ),
  );
}

/** Atajo para entradas de una sola parte. */
export function buildPiece(def: PieceDef, cx: number, cyPlates: number, cz: number, rotation: number, color: number): Piece {
  return buildPieces(def, cx, cyPlates, cz, rotation, color)[0];
}
