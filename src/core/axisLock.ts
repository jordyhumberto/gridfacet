/**
 * Límite de movimiento: `null` es libre; 0, 1 y 2 son un solo eje (X, Y, Z); 3, 4 y 5 son un plano que mezcla dos ejes
 * (XY deja fijo Z, XZ deja fijo Y, YZ deja fijo X).
 */
export type AxisLock = number | null;

export const PLANE_XY = 3;
export const PLANE_XZ = 4;
export const PLANE_YZ = 5;

/** ¿Se puede mover a lo largo del eje `axis` (0 = X, 1 = Y, 2 = Z) con este límite? */
export function axisAllowed(lock: AxisLock, axis: number): boolean {
  if (lock === null) return true;
  if (lock < 3) return axis === lock;
  return axis !== [2, 1, 0][lock - 3];
}

/** Nombre corto del límite para los mensajes: «X», «XY»… */
export function lockLabel(lock: Exclude<AxisLock, null>): string {
  return lock < 3 ? 'XYZ'[lock] : ['XY', 'XZ', 'YZ'][lock - 3];
}

/** El eje que deja fijo un plano (2 para XY, 1 para XZ, 0 para YZ), o null si no es un plano. */
export function planeNormal(lock: AxisLock): number | null {
  return lock !== null && lock >= 3 ? [2, 1, 0][lock - 3] : null;
}
