import { faceNormal, type Piece, type Vec3 } from '../core/piece';

/** Ángulo máximo entre dos caras vecinas para que se suavice el borde que comparten; por encima queda arista viva. */
const SMOOTH_ANGLE = 45;
const COS_LIMIT = Math.cos((SMOOTH_ANGLE * Math.PI) / 180);

const key = (p: Vec3): string => p.map((v) => Math.round(v * 1e5)).join(',');

const unit = (n: Vec3): Vec3 => {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
};

/**
 * Normal de cada vértice de cada cara. Planas (`smooth` falso) son las de la cara; suaves, la media de las caras que
 * comparten el vértice y forman menos de 45° con ella, así los bordes de un cilindro o una esfera se ven redondos
 * y las esquinas de un cubo siguen vivas.
 */
export function faceVertexNormals(piece: Piece, smooth: boolean): Vec3[][] {
  const flat = piece.faces.map((face) => unit(faceNormal(face)));
  if (!smooth) return piece.faces.map((face, i) => face.map(() => flat[i]));

  // Caras que tocan cada vértice, con su normal ponderada por el área (la de Newell sin normalizar).
  const around = new Map<string, { normal: Vec3; weighted: Vec3 }[]>();
  piece.faces.forEach((face, i) => {
    const weighted = faceNormal(face);
    for (const p of face) {
      const k = key(p);
      const list = around.get(k) ?? [];
      list.push({ normal: flat[i], weighted });
      around.set(k, list);
    }
  });
  return piece.faces.map((face, i) =>
    face.map((p) => {
      const sum: Vec3 = [0, 0, 0];
      for (const other of around.get(key(p)) ?? []) {
        const cos = flat[i][0] * other.normal[0] + flat[i][1] * other.normal[1] + flat[i][2] * other.normal[2];
        if (cos < COS_LIMIT) continue;
        for (let k = 0; k < 3; k++) sum[k] += other.weighted[k];
      }
      return Math.hypot(sum[0], sum[1], sum[2]) > 1e-12 ? unit(sum) : flat[i];
    }),
  );
}

/** Clave de una arista sin importar el sentido en que se recorra. */
export function edgeKey(a: Vec3, b: Vec3): string {
  const [ka, kb] = [key(a), key(b)];
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** Aristas entre dos caras que forman menos de 45°: con sombreado suave no se dibujan, porque ahí no hay arista visible. */
export function smoothEdges(piece: Piece): Set<string> {
  const flat = piece.faces.map((face) => unit(faceNormal(face)));
  const seen = new Map<string, number>();
  const smooth = new Set<string>();
  piece.faces.forEach((face, i) => {
    for (let k = 0; k < face.length; k++) {
      const id = edgeKey(face[k], face[(k + 1) % face.length]);
      const other = seen.get(id);
      if (other === undefined) {
        seen.set(id, i);
        continue;
      }
      const cos = flat[i][0] * flat[other][0] + flat[i][1] * flat[other][1] + flat[i][2] * flat[other][2];
      if (cos >= COS_LIMIT) smooth.add(id);
    }
  });
  return smooth;
}
