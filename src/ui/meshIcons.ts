// Iconos de los botones y casillas de Malla: trazos propios sobre una caja de 24 × 24 (toman el color del texto).
// Los puntos rellenos son vértices; la línea a trazos, lo que se quita o una referencia.

const dot = (x: number, y: number): string => `<circle cx="${x}" cy="${y}" r="2" fill="currentColor"/>`;
const axis = (letter: string): string =>
  `<path stroke-dasharray="3 3" d="M19 3v18"/>${dot(5, 5)}<path d="M8 5h8M13 2l3 3-3 3"/><text x="8" y="21" font-size="12" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">${letter}</text>`;

const SHAPES: Record<string, string> = {
  // Modos
  add: `<path d="M3 19L15 7"/>${dot(9, 13)}<path d="M18 13v8M14 17h8"/>`,
  slide: `<path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3"/>${dot(12, 12)}`,
  remove: `<path d="M3 19L15 7"/>${dot(9, 13)}<path d="M14 18h8"/>`,
  seeBehind: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  // Elegir y vértices
  all: `<path stroke-dasharray="3 3" d="M5 5h14v14H5z"/>${dot(5, 5)}${dot(19, 5)}${dot(5, 19)}${dot(19, 19)}`,
  tip: `<path d="M5 19L17 7"/>${dot(5, 19)}${dot(18, 6)}<path d="M9 6h4M11 4v4"/>`,
  tipFaces: `<path fill="currentColor" fill-opacity="0.35" d="M12 3l8 16H4z"/>${dot(12, 3)}`,
  merge: `<path d="M3 3l6 6M9 4v5H4M21 21l-6-6M15 20v-5h5M21 3l-6 6M15 4v5h5M3 21l6-6M4 15h5v5"/>`,
  delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  snap: `<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>${dot(15, 9)}`,
  weld: `${dot(10, 12)}${dot(14, 12)}<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/>`,
  distance: '<path d="M3 12h18M3 7v10M21 7v10M7 9l-4 3 4 3M17 9l4 3-4 3"/>',
  // Transformar
  rotate: '<path d="M19 12a7 7 0 1 1-2-5M18 3v5h-5"/>',
  scale: '<rect x="4" y="12" width="8" height="8"/><path d="M12 12l8-8M14 4h6v6"/>',
  taper: '<path d="M9 4h6l5 16H4z"/>',
  twist: '<path d="M6 3c0 6 12 6 12 9s-12 3-12 9M18 3c0 6-12 6-12 9s12 3 12 9"/>',
  bend: '<path d="M5 21C5 10 10 5 21 5M11 21c0-6 4-10 10-10"/>',
  // Caras
  face: `<path fill="currentColor" fill-opacity="0.35" d="M5 5l14 2-2 12-12-2z"/>${dot(5, 5)}${dot(19, 7)}${dot(17, 19)}${dot(5, 17)}`,
  fillhole: '<path d="M3 3h18v18H3z"/><path fill="currentColor" fill-opacity="0.35" stroke-dasharray="3 2" d="M8 8h8v8H8z"/>',
  push: '<path d="M4 16l8-4 8 4-8 4zM12 14V3M9 6l3-3 3 3"/>',
  delface: '<path stroke-dasharray="3 3" d="M4 4h16v16H4z"/><path d="M9 9l6 6M15 9l-6 6"/>',
  flip: '<path d="M5 8h12l-3-3M19 16H7l3 3"/>',
  growAmount: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
  growedge: `<path d="M5 19h14"/>${dot(5, 19)}${dot(19, 19)}<path fill="currentColor" fill-opacity="0.35" stroke-dasharray="3 2" d="M5 19V9h14v10"/><path d="M12 11V3M9 6l3-3 3 3"/>`,
  extrude: '<path d="M4 14l8-4 8 4-8 4zM4 14v4l8 4 8-4v-4M12 8V2M9 5l3-3 3 3"/>',
  // Segmentos
  bevelSize: '<path d="M4 20V10l6-6h10"/><path d="M3 3l5 5M4 8h4V4"/>',
  bevel: '<path d="M4 20V10l6-6h10M4 20h16V4"/>',
  ring: '<path d="M4 4h16v16H4zM12 4v16"/><path stroke-dasharray="3 2" d="M4 12h16"/>',
  connect: `<path d="M4 4h16v16H4z" stroke-opacity="0.5"/><path d="M4 20L20 4"/>${dot(4, 20)}${dot(20, 4)}`,
  dissolve: `<path stroke-dasharray="3 3" d="M5 19L19 5"/>${dot(5, 19)}${dot(19, 5)}<path d="M14 15l6 6M20 15l-6 6"/>`,
  triangulate: '<path d="M4 4h16v16H4zM4 20L20 4"/>',
  // Ordenar
  straighten: `<path d="M3 17L21 7"/>${dot(3, 17)}${dot(12, 12)}${dot(21, 7)}`,
  flatten: `<path d="M3 17h18"/>${dot(6, 17)}${dot(12, 17)}${dot(18, 17)}<path d="M12 3v9M9 9l3 3 3-3"/>`,
  alignX: axis('X'),
  alignY: axis('Y'),
  alignZ: axis('Z'),
  symmetrize: '<path stroke-dasharray="3 3" d="M12 3v18"/><path d="M9 7L3 17h6zM15 7l6 10h-6z"/>',
  autoFlat: '<path d="M3 20h18M12 3v11M8 10l4 4 4-4"/>',
  // Aspecto
  double: '<path d="M4 7l8-4v14l-8 4z"/><path fill="currentColor" fill-opacity="0.35" d="M12 3l8 4v14l-8-4z"/>',
  unlit: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4 4l16 16"/>',
  behind: '<path fill="currentColor" fill-opacity="0.5" d="M3 3h11v11H3z"/><path d="M10 10h11v11H10z"/>',
};

export const MESH_ICON_NAMES: ReadonlySet<string> = new Set(Object.keys(SHAPES));

export const meshIconSvg = (name: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHAPES[name] ?? ''}</svg>`;
