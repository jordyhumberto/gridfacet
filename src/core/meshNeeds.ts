// Qué necesita cada acción del panel de Malla para poder usarse, y cómo decirlo cuando el botón está apagado.

/** Cuántos vértices (de una misma pieza) pide cada acción; «face» pide al menos una cara con todos sus vértices elegidos. Las que no figuran piden al menos uno. */
export const MESH_NEEDS: Record<string, number | 'face'> = {
  weld: 0,
  merge: 2,
  ring: 2,
  bevel: 2,
  face: 3,
  fillhole: 1,
  delface: 'face',
  triangulate: 'face',
  push: 'face',
  flip: 'face',
  extrude: 'face',
  connect: 2,
  dissolve: 2,
  growedge: 2,
  tip: 1,
  straighten: 3,
  flatten: 3,
  taper: 2,
  twist: 2,
  bend: 2,
};

/** Lo que hay elegido ahora en Malla. */
export interface MeshSituation {
  /** Vértices elegidos en total. */
  count: number;
  /** Vértices elegidos en la pieza que más tiene. */
  mostInOnePiece: number;
  /** Caras con todos sus vértices elegidos. */
  fullFaces: number;
  /** Hay algún eje de simetría activo. */
  symmetric: boolean;
}

/** Lo que dice el título de un botón apagado para decir qué hay que elegir (por acción; si no figura, se usa el recuento). */
const WHAT: Record<string, string> = {
  merge: '2 o más vértices de la misma pieza',
  ring: 'los 2 vértices de una arista',
  bevel: 'los 2 vértices de una arista',
  dissolve: 'los 2 vértices de un segmento',
  growedge: 'los 2 vértices de un segmento',
  connect: '2 vértices de una misma cara',
  face: '3 o más vértices de la misma pieza',
  straighten: '3 o más vértices de la misma pieza',
  flatten: '3 o más vértices de la misma pieza',
  fillhole: '1 vértice del borde abierto',
  tip: '1 o más vértices',
  taper: '2 o más vértices de la misma pieza',
  twist: '2 o más vértices de la misma pieza',
  bend: '2 o más vértices de la misma pieza',
};

/** Por qué no se puede usar la acción ahora (con lo que hay que hacer), o `null` si se puede. */
export function meshNeedReason(action: string, situation: MeshSituation): string | null {
  if (action === 'all') return null;
  if (action === 'symmetrize') return situation.symmetric ? null : 'necesita la simetría activa (casillas X, Y o Z de «Simetría»)';
  const need = MESH_NEEDS[action];
  if (need === 'face') return situation.fullFaces > 0 ? null : 'necesita una cara con todos sus vértices elegidos';
  const least = need ?? 1;
  if (situation.count >= least && (need === undefined || situation.mostInOnePiece >= need)) return null;
  const what = WHAT[action] ?? (least <= 1 ? 'al menos 1 vértice' : `${least} o más vértices de la misma pieza`);
  const have = situation.count === 0 ? 'no hay ninguno elegido' : `hay ${situation.count} elegido(s)${need !== undefined && situation.count >= least ? `, pero solo ${situation.mostInOnePiece} en una misma pieza` : ''}`;
  return `necesita elegir ${what} (${have})`;
}

/** Texto de un botón: su título de siempre y, si está apagado, el motivo delante. */
export function titleWithReason(base: string, reason: string | null): string {
  return reason ? `Apagado: ${reason}. ${base}` : base;
}
