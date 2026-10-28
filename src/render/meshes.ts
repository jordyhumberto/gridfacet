import * as THREE from 'three';
import { faceColorOf, type Piece } from '../core/piece';
import { edgeKey, faceVertexNormals, smoothEdges } from './shading';

/** Geometría sin indexar con normales planas; cada cara convexa se triangula en abanico. */
export function pieceGeometry(piece: Piece): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const paint = new THREE.Color();
  const vertexNormals = faceVertexNormals(piece, smoothShading);
  for (const [faceIndex, face] of piece.faces.entries()) {
    paint.set(faceColorOf(piece, faceIndex));
    for (let i = 1; i < face.length - 1; i++) {
      for (const v of [0, i, i + 1]) {
        const p = face[v];
        const n = vertexNormals[faceIndex][v];
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
        colors.push(paint.r, paint.g, paint.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  // Solo se usa si la pieza tiene caras pintadas (ver createPieceObject).
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Vista de solo líneas y vértices: las caras se ocultan y las aristas toman el color de la pieza. */
let wireframe = false;
export const setWireframeView = (on: boolean): void => {
  wireframe = on;
};
export const isWireframeView = (): boolean => wireframe;

/** Sombreado suave: las caras vecinas que forman poco ángulo comparten normales y se ven redondeadas. */
let smoothShading = false;
export const setSmoothShading = (on: boolean): void => {
  smoothShading = on;
};
export const isSmoothShading = (): boolean => smoothShading;

const OUTLINE_COLOR = 0x14161b;
const POINT_COLOR = 0xe6e8ee;

/** Color de las aristas en la vista de líneas: el de la pieza, aclarado para que se vea sobre el fondo oscuro. */
export function wireColor(color: number): number {
  return new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex();
}

export function pieceOutline(piece: Piece, color = OUTLINE_COLOR): THREE.LineSegments {
  const points: number[] = [];
  const hide = smoothShading && !wireframe ? smoothEdges(piece) : null;
  for (const face of piece.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      if (hide?.has(edgeKey(a, b))) continue;
      points.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
  lines.userData.baseColor = color;
  return lines;
}

/** Un punto por vértice distinto de la pieza. */
export function pieceVertices(piece: Piece): THREE.Points {
  const seen = new Set<string>();
  const positions: number[] = [];
  for (const face of piece.faces) {
    for (const p of face) {
      const key = p.map((v) => Math.round(v * 1e5)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      positions.push(p[0], p[1], p[2]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: POINT_COLOR, size: 5, sizeAttenuation: false }));
}

/** Malla con contorno; `userData.pieceId` permite volver de un clic a la pieza. */
export function createPieceObject(piece: Piece, ghost = false): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    // Con caras pintadas, el color sale de la geometría (un color por cara).
    color: piece.faceColors ? 0xffffff : piece.color,
    vertexColors: piece.faceColors !== undefined,
    roughness: 0.7,
    metalness: 0,
    transparent: ghost,
    opacity: ghost ? 0.5 : 1,
    // Los fantasmas se superponen a caras existentes; el desplazamiento evita el parpadeo.
    polygonOffset: ghost,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(pieceGeometry(piece), material);
  mesh.userData.pieceId = piece.id;
  // Los fantasmas y avisos (vistas previas) conservan sus caras translúcidas incluso en la vista de líneas.
  const wire = wireframe && !ghost;
  mesh.visible = !wire;
  group.add(mesh, pieceOutline(piece, wire ? wireColor(piece.color) : OUTLINE_COLOR));
  if (wire) group.add(pieceVertices(piece));
  group.userData.pieceId = piece.id;
  return group;
}

/** Tiñe la pieza y su contorno para marcarla como seleccionada. */
export function setHighlight(object: THREE.Object3D, on: boolean): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      (child.material as THREE.MeshStandardMaterial).emissive.setHex(on ? 0x5a3d00 : 0x000000);
    } else if (child instanceof THREE.LineSegments) {
      (child.material as THREE.LineBasicMaterial).color.setHex(on ? 0xffb020 : (child.userData.baseColor as number) ?? OUTLINE_COLOR);
    }
  });
}

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
      child.geometry.dispose();
      const material = child.material;
      (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
    }
  });
}
