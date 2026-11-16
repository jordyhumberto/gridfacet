import * as THREE from 'three';
import { CATALOG, SLAB_THICKNESS, buildPieces, buildSlab } from '../core/catalog';
import { clearanceLift, edgeLines, flatSurface, gridLines as cellLines, snapSpan } from '../core/placement';
import { faceNormal, type Piece, type Vec3 } from '../core/piece';
import { faceSpin, leanOnWall, seatOnSlope, slopeAxes, slopeKindOf, standOnSlope, type SlopeKind } from '../core/slope';
import { boundsOf, translatePiece } from '../core/transform';
import { createPieceObject, disposeObject } from '../render/meshes';
import type { ModelScene } from '../scene';

/** Lo que Colocar necesita de la aplicación. */
export interface PlacementHost {
  scene3d: THREE.Scene;
  model: ModelScene;
  hidden: Set<number>;
  mode(): string;
  /** Índice de la pieza elegida en el catálogo. */
  selected(): number;
  /** Vueltas de 90° de la pieza que se coloca. */
  rotation(): number;
  color(): number;
  gridSize(): number;
  /** El campo «Tamaño» (null si es automático). */
  placeSize(): number | null;
  /** El campo «Grosor» de la lámina (null si es automático). */
  slabThick(): number | null;
  /** Añade los reflejos de la simetría activa. */
  expand(pieces: Piece[]): Piece[];
  useColor(color: number): void;
  pieceIdOf(hit: THREE.Intersection | undefined): number | undefined;
}

export interface Placement {
  /** La sombra que se dibuja ahora (para pruebas en desarrollo). */
  readonly ghost: THREE.Object3D | null;
  /** Apunta a lo que hay bajo el cursor: calcula dónde caería la pieza y dibuja su sombra. */
  aim(hit: THREE.Intersection | undefined): void;
  /** Redibuja la sombra (cambió la pieza, el giro, el tamaño o el color). */
  refresh(): void;
  /** Olvida el sitio apuntado y quita la sombra. */
  clear(): void;
  /** Quita la sombra solo si había un sitio apuntado. */
  release(): void;
  /** Coloca la pieza en el sitio apuntado, si hay. */
  place(): void;
}

/** Colocar: la sombra de la pieza que se va a poner y dónde cae (rejilla, láminas, pendientes y superficies). */
export function createPlacement(host: PlacementHost): Placement {
  const { scene3d, model } = host;
  let ghost: THREE.Object3D | null = null;
  let target = { cx: 0, cy: 0, cz: 0, ox: 0, oz: 0 };
  let hasTarget = false;

  /**
   * Coloca una pieza menor que una celda siguiendo al cursor dentro de la cara apuntada, sin saltar de celda en celda:
   * se mueve en pasos de un cuarto de su tamaño, se imanta a las aristas de las piezas cercanas y a la rejilla, y no se sale de la superficie que la recibe.
   * En el eje de la cara queda a ras de ella. En una pared también se mueve en vertical.
   * Las piezas de una celda o más también se sueltan de la rejilla: en el suelo y las paredes de la sala, y sobre una superficie de varias figuras en la que caben.
   */
  function freePlacement(hit: THREE.Intersection, footW: number, footD: number, scale: number): void {
    const n = hit.face!.normal;
    const components = [n.x, n.y, n.z];
    const axis = components.map(Math.abs).indexOf(Math.max(...components.map(Math.abs))) as 0 | 1 | 2;
    const sign = components[axis] >= 0 ? 1 : -1;
    const point: [number, number, number] = [hit.point.x, hit.point.y, hit.point.z];
    const id = host.pieceIdOf(hit);
    const under = id === undefined ? undefined : model.get(id);
    const others = model.all().filter((piece) => !host.hidden.has(piece.id));
    // Con una cara recta, el límite es toda la superficie continua (varios cubos juntos son una pared); si no, la pieza apuntada.
    const flat = Math.abs(components[axis]) > 0.999 ? flatSurface(others, axis, sign, [point[0], point[1], point[2]]) : null;
    const hostBox = flat ?? (under ? boundsOf([under]) : null);
    const place = (a: 0 | 2, size: number): number => {
      if (axis === a) return sign > 0 ? Math.round(point[a] * 1e4) / 1e4 : Math.round(point[a] * 1e4) / 1e4 - size;
      // Puede sobresalir hasta la mitad de su largo del borde de la cara: la mitad queda apoyada y la alineación con la rejilla sigue.
      return snapSpan(point[a], size, edgeLines(others, a, point, size + 0.6), hostBox?.min[a], hostBox?.max[a], cellLines(a, point, size + 0.6), size / 2);
    };
    // Una pieza de una celda o más también se mueve libre sobre una superficie formada por varias figuras, si cabe en ella.
    // En el suelo y en las paredes de la sala (sin pieza debajo) también se mueve libre, no solo de celda en celda.
    const fits = (a: 0 | 1 | 2, size: number): boolean => (flat !== null && (axis === a || flat.max[a] - flat.min[a] >= size - 1e-6)) || (flat === null && under === undefined);
    if (footW < 1 || fits(0, footW)) {
      const start = place(0, footW);
      target.cx = Math.floor(start + 1e-6);
      target.ox = start - target.cx;
    }
    if (footD < 1 || fits(2, footD)) {
      const start = place(2, footD);
      target.cz = Math.floor(start + 1e-6);
      target.oz = start - target.cz;
    }
    const height = (CATALOG[host.selected()].heightPlates / 3) * scale;
    if (axis !== 1 && (scale < 1 || fits(1, height))) {
      const start = snapSpan(point[1], height, edgeLines(others, 1, point, height + 0.6), hostBox?.min[1], hostBox?.max[1], cellLines(1, point, height + 0.6));
      target.cy = start * 3;
    }
  }

  /**
   * Dónde empieza (dentro de la celda, de 0 a 1 − tamaño) una pieza de `size` < 1 centrada en el cursor `frac`.
   * Salta de medio en medio tamaño, así una pieza de ½ cabe en las dos esquinas y también en el centro de la celda.
   */
  function centeredOffset(frac: number, size: number): number {
    const step = size / 2;
    const offset = Math.round((frac - size / 2) / step) * step;
    return Math.min(Math.max(offset, 0), 1 - size);
  }

  function refreshGhost(): void {
    if (ghost) {
      scene3d.remove(ghost);
      disposeObject(ghost);
      ghost = null;
    }
    if (host.mode() !== 'place' || !hasTarget) return;
    const group = new THREE.Group();
    for (const piece of currentParts()) group.add(createPieceObject(piece, true));
    ghost = group;
    scene3d.add(ghost);
  }

  /** Lámina que crece desde la cara apuntada: eje y sentido de la cara, dónde está y la esquina de su celda en los otros ejes. */
  let slabTarget: { axis: 0 | 1 | 2; sign: 1 | -1; surface: number; tangentMin: Vec3 } | null = null;

  function slabAt(hit: THREE.Intersection, probe: THREE.Vector3): typeof slabTarget {
    const n = hit.face!.normal;
    const components = [n.x, n.y, n.z];
    const axis = components.map(Math.abs).indexOf(Math.max(...components.map(Math.abs))) as 0 | 1 | 2;
    const sign: 1 | -1 = components[axis] >= 0 ? 1 : -1;
    const surface = Math.round(hit.point.getComponent(axis) * 1e4) / 1e4;
    // El lado de la lámina es el "Tamaño" del panel. Menor que una celda, se coloca en el trozo de la celda al que apunta el cursor.
    const side = host.placeSize() ?? 1;
    const snap = (value: number): number => {
      const cell = Math.floor(value);
      return side < 1 ? cell + centeredOffset(value - cell, side) : cell;
    };
    const tangentMin: Vec3 = [snap(probe.x), Math.floor(probe.y * 3) / 3, snap(probe.z)];
    // De costado, la lámina arranca desde la base de la pieza a la que se pega, así queda a ras aunque esa pieza no siga la rejilla de placas.
    if (axis !== 1) {
      const id = host.pieceIdOf(hit);
      const piece = id === undefined ? undefined : model.get(id);
      const box = piece ? boundsOf([piece]) : null;
      // Medida desde la base de la pieza; una lámina pequeña puede ir más arriba, centrada en el cursor, sin pasarse del alto de una celda.
      if (box) tangentMin[1] = box.min[1] + (side < 1 ? centeredOffset(probe.y - box.min[1], side) : 0);
      else if (side < 1) tangentMin[1] = snap(probe.y);
    }
    const [x, y, z] = tangentMin;
    if (Math.abs(x + 0.5) >= host.gridSize() / 2 || Math.abs(z + 0.5) >= host.gridSize() / 2 || y < 0 || y >= host.gridSize()) return null;
    return { axis, sign, surface, tangentMin: [x, y, z] };
  }

  /** Qué hacer al apuntar a una cara inclinada, y a dónde. */
  let slopeAim: { kind: SlopeKind; n: Vec3; point: Vec3; face: Vec3[] | null } | null = null;
  let slopeMode: SlopeKind | 'grid' = 'seat';
  const slopeModeEl = document.getElementById('slopeMode') as HTMLSelectElement;
  slopeModeEl.addEventListener('change', () => {
    slopeMode = slopeModeEl.value as SlopeKind | 'grid';
    slopeAim = null;
    slopeModeEl.blur();
    hasTarget = false;
    refreshGhost();
  });

  /** La pieza elegida sobre la pendiente apuntada: asentada (vertical con la base cortada) o perpendicular a ella. */
  function slopeParts(def: (typeof CATALOG)[number], others: Piece[]): Piece[] {
    if (!slopeAim) return [];
    const { kind, n, point } = slopeAim;
    const parts = buildPieces(def, 0, 0, 0, host.rotation(), host.color(), host.placeSize() ?? 1);
    const box = boundsOf(parts)!;
    const [w, d] = [box.max[0] - box.min[0], box.max[2] - box.min[2]];
    const length = Math.hypot(...n);
    const unit: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
    if (kind === 'seat') {
      // El centro de la huella sigue al cursor en pasos de un cuarto de su tamaño y se imanta a las aristas cercanas.
      const x = snapSpan(point[0], w, edgeLines(others, 0, point, w + 0.6), undefined, undefined, cellLines(0, point, w + 0.6)) + w / 2;
      const z = snapSpan(point[2], d, edgeLines(others, 2, point, d + 0.6), undefined, undefined, cellLines(2, point, d + 0.6)) + d / 2;
      return seatOnSlope(parts, unit, point, [x, z]);
    }
    // Perpendicular: la pieza se alinea con los lados de la cara que la recibe y se mueve sobre ella en pasos de un cuarto de su
    // tamaño, imantada a los bordes de esa cara y de las vecinas del mismo plano. Así se pega a otras y se apila en línea.
    const spin = slopeAim.face ? faceSpin(unit, slopeAim.face) : 0;
    const [ax, az] = slopeAxes(unit, spin);
    const along = (v: Vec3, axis: Vec3): number => v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
    const coplanar = [slopeAim.face, ...others.flatMap((piece) => piece.faces)].filter((f): f is Vec3[] => {
      if (!f) return false;
      const fn = faceNormal(f);
      const length = Math.hypot(...fn) || 1;
      const offset = (fn[0] * (point[0] - f[0][0]) + fn[1] * (point[1] - f[0][1]) + fn[2] * (point[2] - f[0][2])) / length;
      return (fn[0] * unit[0] + fn[1] * unit[1] + fn[2] * unit[2]) / length > 0.9995 && Math.abs(offset) < 1e-3 && f.some((p) => Math.hypot(p[0] - point[0], p[1] - point[1], p[2] - point[2]) < Math.max(w, d) + 0.8);
    });
    const slide = (axis: Vec3, size: number): number => {
      const cursor = along(point, axis);
      const origin = slopeAim!.face ? Math.min(...slopeAim!.face.map((p) => along(p, axis))) : 0;
      const lines = coplanar.flatMap((f) => f.map((p) => along(p, axis) - origin));
      return origin + snapSpan(cursor - origin, size, lines) + size / 2 - cursor;
    };
    if (kind === 'wall') {
      // Pared que no sigue los ejes: de pie contra ella, girada para quedar a ras, moviéndose a lo largo y en altura.
      const flat = Math.hypot(unit[0], unit[2]) || 1;
      const out: Vec3 = [unit[0] / flat, 0, unit[2] / flat];
      const tangent: Vec3 = [out[2], 0, -out[0]];
      const shift = slide(tangent, w);
      const height = box.max[1] - box.min[1];
      const y = snapSpan(point[1], height, edgeLines(others, 1, point, height + 0.6), undefined, undefined, cellLines(1, point, height + 0.6));
      return leanOnWall(parts, out, [point[0] + tangent[0] * shift, Math.max(0, y), point[2] + tangent[2] * shift]);
    }
    const [da, db] = [slide(ax, w), slide(az, d)];
    const center: Vec3 = [point[0] + ax[0] * da + az[0] * db, point[1] + ax[1] * da + az[1] * db, point[2] + ax[2] * da + az[2] * db];
    return standOnSlope(parts, unit, center, spin);
  }

  /** Piezas que se colocarían ahora; un elemento del catálogo puede componerse de varias partes convexas. */
  function currentParts(): Piece[] {
    const def = CATALOG[host.selected()];
    const others = model.all().filter((piece) => !host.hidden.has(piece.id));
    if (def.grows) {
      if (!slabTarget) return [];
      const { axis, sign, surface, tangentMin } = slabTarget;
      let slab = buildSlab(axis, sign, surface, tangentMin, host.color(), host.placeSize() ?? 1, host.slabThick() ?? SLAB_THICKNESS);
      // Sobre una cara de arriba, si la celda cubre algo más alto se apoya encima en vez de atravesarlo.
      if (axis === 1 && sign > 0) slab = translatePiece(slab, 0, clearanceLift([slab], others), 0);
      return host.expand([slab]);
    }
    if (slopeAim) return host.expand(slopeParts(def, others));
    const parts = buildPieces(def, target.cx + target.ox, target.cy, target.cz + target.oz, host.rotation(), host.color(), host.placeSize() ?? 1);
    const lift = clearanceLift(parts, others);
    return host.expand(lift > 0 ? parts.map((part) => translatePiece(part, 0, lift, 0)) : parts);
  }

  function placePiece(): void {
    if (!hasTarget) return;
    model.apply({ added: currentParts(), removed: [] });
    host.useColor(host.color());
  }


  /** Apunta a lo que hay bajo el cursor (la herramienta Colocar): calcula dónde caería la pieza y dibuja su sombra. */
  function aim(hit: THREE.Intersection | undefined): void {
    if (!hit || !hit.face) {
      hasTarget = false;
      refreshGhost();
      return;
    }
    // Apoyada sobre una cara horizontal, la pieza admite medias placas; al lado de otra, queda a ras de placa.
    // Se avanza un poco por la normal para caer en la celda vecina a la cara tocada.
    const probe = hit.point.clone().addScaledVector(hit.face.normal, 0.001);
    slopeAim = null;
    if (CATALOG[host.selected()].grows) {
      slabTarget = slabAt(hit, probe);
      hasTarget = slabTarget !== null;
      refreshGhost();
      return;
    }
    // Sobre una pendiente (el techo de rampas) la pieza se asienta o se apoya perpendicular, en vez de caer a la rejilla.
    const slope = slopeKindOf([hit.face.normal.x, hit.face.normal.y, hit.face.normal.z], slopeMode);
    if (slope) {
      const n: Vec3 = [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z];
      const hitId = host.pieceIdOf(hit);
      const hitPiece = hitId === undefined ? undefined : model.get(hitId);
      // El polígono de la cara apuntada: la pieza que la tiene y el plano que pasa por el punto.
      const face = hitPiece?.faces.find((f) => {
        const fn = faceNormal(f);
        const length = Math.hypot(...fn) || 1;
        return (fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2]) / length > 0.999 && Math.abs((fn[0] * (hit.point.x - f[0][0]) + fn[1] * (hit.point.y - f[0][1]) + fn[2] * (hit.point.z - f[0][2])) / length) < 1e-3;
      });
      slopeAim = { kind: slope, n, point: [hit.point.x, hit.point.y, hit.point.z], face: face ?? null };
      hasTarget = Math.abs(hit.point.x - 0.5) < host.gridSize() / 2 + 0.5 && Math.abs(hit.point.z - 0.5) < host.gridSize() / 2 + 0.5 && hit.point.y >= 0;
      refreshGhost();
      return;
    }
    slopeAim = null;
    // Sobre una cara plana la pieza se apoya justo en ella, aunque no caiga en la rejilla de placas (por ejemplo encima de una lámina);
    // sobre una inclinada se alinea a media placa.
    const flatTop = hit.face.normal.y > 0.999;
    // Colgada de una cara plana de abajo, la pieza queda debajo de ella: su base es la cara menos su alto.
    const flatBottom = hit.face.normal.y < -0.999;
    const hangHeight = (CATALOG[host.selected()].heightPlates / 3) * (host.placeSize() ?? 1);
    target = {
      cx: Math.floor(probe.x),
      cy: flatTop ? (Math.round(hit.point.y * 1e4) / 1e4) * 3 : flatBottom ? (Math.round((hit.point.y - hangHeight) * 1e4) / 1e4) * 3 : Math.abs(hit.face.normal.y) > 0.5 ? Math.floor(probe.y * 6 + 1e-6) / 2 : Math.floor(probe.y * 3),
      cz: Math.floor(probe.z),
      ox: 0,
      oz: 0,
    };
    // Las piezas menores que una celda se colocan en el trozo de la celda sobre el que apunta el cursor (mitades, tercios, cuartos...).
    const scale = host.placeSize() ?? 1;
    const turned = host.rotation() % 2 !== 0;
    const footW = CATALOG[host.selected()].footprint[turned ? 1 : 0] * scale;
    const footD = CATALOG[host.selected()].footprint[turned ? 0 : 1] * scale;
    freePlacement(hit, footW, footD, scale);
    hasTarget = Math.abs(target.cx + 0.5) < host.gridSize() / 2 && Math.abs(target.cz + 0.5) < host.gridSize() / 2 && target.cy >= 0 && target.cy < host.gridSize() * 3;
    refreshGhost();
  }

  return {
    get ghost() {
      return ghost;
    },
    aim,
    refresh: refreshGhost,
    clear: () => {
      hasTarget = false;
      refreshGhost();
    },
    release: () => {
      if (hasTarget) {
        hasTarget = false;
        refreshGhost();
      }
    },
    place: placePiece,
  };
}
