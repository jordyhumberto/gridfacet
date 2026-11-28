// Iconos de los botones de Pintar: trazos propios sobre una caja de 24 × 24 (toman el color del texto del botón).

const SHAPES: Record<string, string> = {
  whole: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
  eraser: '<path d="M8 19l-5-5L13 4l7 7-8 8zM8 9l7 7M8 20h13"/>',
  fill: '<path d="M5 11l7-7 7 7-7 7zM5 11h14"/><path d="M20 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z"/>',
  replace: '<rect x="3" y="3" width="7" height="7" fill="currentColor"/><rect x="14" y="14" width="7" height="7"/><path d="M13 6h5v5M15 9l3 3 3-3M11 18H6v-5M9 15l-3-3-3 3"/>',
  dither: '<path fill="currentColor" d="M3 3h6v6H3zM15 3h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z"/>',
  spray: '<path d="M4 21v-9h7v9zM6 12V9h3v3"/><path d="M13 7h.1M16 5h.1M16 9h.1M19 3h.1M19 7h.1M20 11h.1M13 11h.1"/>',
  shadeup: '<path d="M4 20l1-4 8-8 3 3-8 8z"/><path d="M18 3v8M14 7h8"/>',
  shadedown: '<path d="M4 20l1-4 8-8 3 3-8 8z"/><path d="M14 7h8"/>',
  stamp: '<path d="M10 13V9a3 3 0 1 1 4 0v4h5v4H5v-4zM5 21h14"/>',
  hlines: '<path d="M4 5h16M4 10h16M4 15h16M4 20h16"/>',
  vlines: '<path d="M5 4v16M10 4v16M15 4v16M20 4v16"/>',
  diag: '<path d="M4 10l6-6M4 17L17 4M8 20L20 8M15 20l5-5"/>',
  lattice: '<path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>',
  dots: '<path stroke-width="3.5" d="M5 5h.1M12 5h.1M19 5h.1M5 12h.1M12 12h.1M19 12h.1M5 19h.1M12 19h.1M19 19h.1"/>',
  bricks: '<path d="M3 5h18v14H3zM3 12h18M12 5v7M8 12v7M16 12v7"/>',
  line: '<path d="M6 18L18 6"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
  rectfill: '<rect x="4" y="6" width="16" height="12" fill="currentColor"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  ellipsefill: '<ellipse cx="12" cy="12" rx="9" ry="7" fill="currentColor"/>',
  select: '<path stroke-dasharray="3 3" d="M4 4h16v16H4z"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1"/><path d="M15 5V4H4v11h1"/>',
  paste: '<path d="M9 5H6v16h12V5h-3"/><rect x="9" y="3" width="6" height="4"/>',
  flipH: '<path stroke-dasharray="3 3" d="M12 3v18"/><path d="M9 7L3 17h6zM15 7l6 10h-6z"/>',
  flipV: '<path stroke-dasharray="3 3" d="M3 12h18"/><path d="M7 9l10-6v6zM7 15l10 6v-6z"/>',
  rotate: '<path d="M19 12a7 7 0 1 1-2-5M18 3v5h-5"/>',
  outline: '<rect x="3" y="3" width="18" height="18"/><rect x="8" y="8" width="8" height="8" fill="currentColor"/>',
  lighten: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  darken: '<path d="M20 14a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10z"/>',
  square: '<rect x="6" y="6" width="12" height="12" fill="currentColor"/>',
  round: '<circle cx="12" cy="12" r="7" fill="currentColor"/>',
  mirrorX: '<path stroke-dasharray="3 3" d="M12 3v18"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  mirrorY: '<path stroke-dasharray="3 3" d="M3 12h18"/><path d="M8 8l4-4 4 4M8 16l4 4 4-4"/>',
  flat: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8" y="8" width="8" height="8"/>',
};

export const ICON_NAMES: ReadonlySet<string> = new Set(Object.keys(SHAPES));

export const iconSvg = (name: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHAPES[name] ?? ''}</svg>`;
