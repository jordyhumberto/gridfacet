import * as THREE from 'three';
import type { Piece } from '../core/piece';
import { triangulateFace } from '../core/convex';
import { FACE_DOUBLE, FACE_UNLIT, faceNormal } from '../core/piece';
import { CLEAR, uvOf, type FaceTexture } from '../core/texture';

/** Lo que se separa cada textura de su cara para no confundirse con ella al dibujar. */
const LIFT = 0.002;

function canvasTexture(texture: FaceTexture): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = texture.w;
  canvas.height = texture.h;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(texture.w, texture.h);
  texture.pixels.forEach((value, i) => {
    if (value === CLEAR) return;
    image.data[i * 4] = (value >> 16) & 255;
    image.data[i * 4 + 1] = (value >> 8) & 255;
    image.data[i * 4 + 2] = value & 255;
    image.data[i * 4 + 3] = 255;
  });
  context.putImageData(image, 0, 0);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  // Sin suavizado: cada píxel pintado se ve como un cuadrado.
  result.magFilter = THREE.NearestFilter;
  result.minFilter = THREE.NearestFilter;
  result.generateMipmaps = false;
  return result;
}

/** Malla de una cara con su textura. `flat` la dibuja sin luz (colores tal cual), para los sprites planos. */
export function faceMesh(face: [number, number, number][], texture: FaceTexture, flat = false, flags = 0): THREE.Mesh {
  const n = faceNormal(face);
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  const lift = [n[0] / length, n[1] / length, n[2] / length].map((c) => c * LIFT);
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  for (const triangle of triangulateFace(face)) {
    for (const v of triangle) {
      const p = face[v];
      const [s, t] = uvOf(face, p);
      positions.push(p[0] + lift[0], p[1] + lift[1], p[2] + lift[2]);
      // La textura se dibuja con la fila 0 arriba: en UV de three, v crece hacia arriba.
      uvs.push(s, 1 - t);
      normals.push(lift[0] / LIFT, lift[1] / LIFT, lift[2] / LIFT);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const shared = {
    map: canvasTexture(texture),
    alphaTest: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: flags & FACE_DOUBLE ? THREE.DoubleSide : THREE.FrontSide,
  };
  const material = flat || flags & FACE_UNLIT ? new THREE.MeshBasicMaterial(shared) : new THREE.MeshStandardMaterial({ ...shared, roughness: 0.7, metalness: 0 });
  return new THREE.Mesh(geometry, material);
}

/**
 * Las texturas de las caras, dibujadas encima de las piezas: un objeto por pieza con una malla por cara pintada.
 * Siguen a su pieza (se ocultan con ella y se desplazan al arrastrarla) y se pueden ver con una textura provisional mientras se pinta.
 */
export class TextureLayer {
  readonly group = new THREE.Group();
  private byPiece = new Map<number, THREE.Group>();

  /** Dibuja las texturas de la pieza (sustituye las que hubiera). */
  add(piece: Piece): void {
    this.remove(piece.id);
    if (!piece.faceTextures) return;
    const object = new THREE.Group();
    piece.faces.forEach((face, i) => {
      const texture = piece.faceTextures![i];
      if (texture) object.add(faceMesh(face, texture, false, piece.faceFlags?.[i] ?? 0));
    });
    this.byPiece.set(piece.id, object);
    this.group.add(object);
  }

  remove(id: number): void {
    const object = this.byPiece.get(id);
    if (!object) return;
    this.group.remove(object);
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const material = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    });
    this.byPiece.delete(id);
  }

  /** Desplaza las texturas de estas piezas (para seguirlas mientras se arrastran). */
  setOffset(ids: number[], offset: THREE.Vector3): void {
    for (const id of ids) this.byPiece.get(id)?.position.copy(offset);
  }

  /** Dibuja la pieza con una textura provisional en una de sus caras, sin tocar el modelo. */
  preview(piece: Piece, faceIndex: number, texture: FaceTexture): void {
    const textures = piece.faces.map((_, i) => (i === faceIndex ? texture : (piece.faceTextures?.[i] ?? null)));
    this.add({ ...piece, faceTextures: textures });
  }
}

/** Una malla por cada cara con textura de las piezas dadas (para sprites y exportación). */
export function textureMeshes(pieces: Piece[], flat = false): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const piece of pieces) {
    piece.faces.forEach((face, i) => {
      const texture = piece.faceTextures?.[i];
      if (!texture) return;
      const mesh = faceMesh(face, texture, flat, piece.faceFlags?.[i] ?? 0);
      mesh.name = `Pieza_${piece.id}_cara${i}_textura`;
      meshes.push(mesh);
    });
  }
  return meshes;
}

/** El atlas del OBJ como PNG transparente (los píxeles sin pintar quedan transparentes). */
export function atlasToPng(atlas: { width: number; height: number; pixels: number[] }): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = atlas.width;
  canvas.height = atlas.height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(atlas.width, atlas.height);
  atlas.pixels.forEach((value, i) => {
    if (value === CLEAR) return;
    image.data[i * 4] = (value >> 16) & 255;
    image.data[i * 4 + 1] = (value >> 8) & 255;
    image.data[i * 4 + 2] = value & 255;
    image.data[i * 4 + 3] = 255;
  });
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no se pudo crear el PNG'))), 'image/png'));
}
