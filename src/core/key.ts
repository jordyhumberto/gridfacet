import type { Vec3 } from './piece';

/**
 * Cuánto pueden separarse dos esquinas y seguir siendo «el mismo vértice» (en celdas). Es la única definición del programa:
 * el editor, la simetría, el guardado y la exportación comparan vértices con esta misma clave, así dos esquinas que el editor
 * trata como una no se exportan sin soldar.
 */
export const VERTEX_EPSILON = 1e-5;

const SCALE = 1 / VERTEX_EPSILON;

/** Clave de un vértice por su posición (coordenadas redondeadas a `VERTEX_EPSILON`): los vértices de varias caras que coinciden comparten clave. */
export const vertexKey = (p: Vec3): string => `${Math.round(p[0] * SCALE)},${Math.round(p[1] * SCALE)},${Math.round(p[2] * SCALE)}`;
