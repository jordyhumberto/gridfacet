import type { Vec3 } from './piece';

/** Hacia dónde mira la imagen de referencia: de frente (se ve desde +Z), de lado (desde +X) o plana, vista desde arriba. */
export type RefPlane = 'front' | 'side' | 'top';

/** Una imagen que se coloca al fondo de la escena para modelar tomándola de referencia. No es una pieza: no se exporta ni se puede elegir. */
export interface RefImage {
  id: number;
  name: string;
  /** La imagen como dirección de datos (se guarda dentro del proyecto). */
  data: string;
  /** Ancho entre alto de la imagen. */
  aspect: number;
  plane: RefPlane;
  /** Centro de la imagen dentro de su plano: horizontal y vertical, en celdas. */
  u: number;
  v: number;
  /** Distancia a lo largo de la normal del plano (hacia delante o atrás), en celdas. */
  depth: number;
  /** Ancho en celdas; el alto sale de la proporción. */
  width: number;
  opacity: number;
  visible: boolean;
}

export const PLANES: RefPlane[] = ['front', 'side', 'top'];

/** Dónde y con qué giro queda la imagen en el mundo (el plano de Three.js mira hacia +Z sin girar). */
export function referenceTransform(r: Pick<RefImage, 'plane' | 'u' | 'v' | 'depth' | 'width' | 'aspect'>): { position: Vec3; rotation: Vec3; width: number; height: number } {
  const width = r.width;
  const height = r.width / (r.aspect || 1);
  if (r.plane === 'front') return { position: [r.u, r.v, r.depth], rotation: [0, 0, 0], width, height };
  // De lado: la imagen mira a +X y su derecha apunta a −Z, como al mirarla desde la derecha del modelo.
  if (r.plane === 'side') return { position: [r.depth, r.v, -r.u], rotation: [0, Math.PI / 2, 0], width, height };
  // Desde arriba: tumbada, con su parte alta hacia −Z (hacia el fondo de la vista superior).
  return { position: [r.u, r.depth, -r.v], rotation: [-Math.PI / 2, 0, 0], width, height };
}

/** Una imagen nueva, al fondo de la sala: de frente, centrada y apoyada en el suelo, con la mitad del ancho de la sala. */
export function defaultReference(id: number, name: string, data: string, aspect: number, gridSize: number): RefImage {
  const width = Math.max(2, gridSize / 2);
  return { id, name, data, aspect, plane: 'front', u: 0, v: width / (aspect || 1) / 2, depth: -gridSize / 2, width, opacity: 0.6, visible: true };
}

/** Lo que cambia de sitio al pasar la imagen a otro plano, para que no quede en un lugar absurdo. */
export function withPlane(r: RefImage, plane: RefPlane, gridSize: number): RefImage {
  if (plane === r.plane) return r;
  const height = r.width / (r.aspect || 1);
  if (plane === 'top') return { ...r, plane, u: 0, v: 0, depth: -0.05 };
  return { ...r, plane, u: 0, v: height / 2, depth: -gridSize / 2 };
}

export const nextReferenceId = (list: RefImage[]): number => list.reduce((m, r) => Math.max(m, r.id), 0) + 1;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Lee las imágenes de un proyecto guardado; descarta las que no son válidas en vez de tirar el proyecto. */
export function parseReferences(raw: unknown): RefImage[] {
  if (!Array.isArray(raw)) return [];
  const out: RefImage[] = [];
  for (const item of raw) {
    const r = item as Partial<RefImage> | null;
    if (!r || typeof r.data !== 'string' || !r.data.startsWith('data:image/')) continue;
    if (!finite(r.aspect) || r.aspect <= 0 || !finite(r.width) || r.width <= 0) continue;
    if (!PLANES.includes(r.plane as RefPlane)) continue;
    out.push({
      id: out.length + 1,
      name: typeof r.name === 'string' ? r.name.slice(0, 80) : 'Imagen',
      data: r.data,
      aspect: r.aspect,
      plane: r.plane as RefPlane,
      u: finite(r.u) ? r.u : 0,
      v: finite(r.v) ? r.v : 0,
      depth: finite(r.depth) ? r.depth : 0,
      width: r.width,
      opacity: finite(r.opacity) ? Math.min(1, Math.max(0.05, r.opacity)) : 0.6,
      visible: r.visible !== false,
    });
  }
  return out;
}
