import * as THREE from 'three';
import { buildExportMeshes } from '../core/export';
import type { Piece } from '../core/piece';
import { CAMERA_ELEVATION, addOutline, flipRows, sheetLayout, viewYaws, type SpriteCamera } from '../core/sprites';

export interface SpriteOptions {
  size: number;
  views: number;
  camera: SpriteCamera;
  /** `flat` pinta los colores tal cual; `shaded` suma luz y sombra según la orientación de cada cara. */
  shading: 'flat' | 'shaded';
  outline: boolean;
  outlineColor: number;
}

/** Los píxeles de una vista: filas de arriba abajo, RGBA, sin suavizar. */
export interface SpriteFrame {
  rgba: Uint8ClampedArray;
  size: number;
}

/** Arma la escena del sprite con las piezas dadas y devuelve el centro y el radio que las encierra. */
function buildSpriteScene(pieces: Piece[], shading: SpriteOptions['shading']): { scene: THREE.Scene; center: THREE.Vector3; radius: number } {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const materials = new Map<number, THREE.Material>();
  for (const mesh of buildExportMeshes(pieces, 'perPiece')) {
    let material = materials.get(mesh.color);
    if (!material) {
      material = shading === 'flat' ? new THREE.MeshBasicMaterial({ color: mesh.color }) : new THREE.MeshStandardMaterial({ color: mesh.color, roughness: 0.8, metalness: 0 });
      materials.set(mesh.color, material);
    }
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geometry.setIndex(mesh.indices);
    // Sin compartir vértices entre caras, para que cada cara tenga su normal y se vea facetada.
    geometry = geometry.toNonIndexed();
    geometry.computeVertexNormals();
    root.add(new THREE.Mesh(geometry, material));
  }
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x454a56, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 12, 8);
  scene.add(sun);
  const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
  return { scene, center: sphere.center, radius: Math.max(sphere.radius, 1e-3) };
}

/**
 * Dibuja el modelo desde `options.views` direcciones con una cámara ortográfica, directo a `size × size` píxeles y sin suavizado.
 * Todas las vistas comparten escala y encuadre: la esfera que encierra el modelo cabe en el cuadro, gire hacia donde gire.
 */
export function renderSprites(renderer: THREE.WebGLRenderer, pieces: Piece[], options: SpriteOptions): SpriteFrame[] {
  const { size, shading } = options;
  const { scene, center, radius } = buildSpriteScene(pieces, shading);
  // Con contorno se deja un píxel libre por cada lado.
  const margin = options.outline ? size / Math.max(size - 2, 1) : 1;
  const half = radius * margin;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, radius * 8);
  const elevation = (CAMERA_ELEVATION[options.camera] * Math.PI) / 180;
  const target = new THREE.WebGLRenderTarget(size, size, { colorSpace: THREE.SRGBColorSpace, samples: 0, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

  const previous = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), pixelRatio: renderer.getPixelRatio() };
  const frames: SpriteFrame[] = [];
  try {
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    for (const yawDegrees of viewYaws(options.views)) {
      const yaw = (yawDegrees * Math.PI) / 180;
      const distance = radius * 4;
      camera.position.set(
        center.x + distance * Math.sin(yaw) * Math.cos(elevation),
        center.y + distance * Math.sin(elevation),
        center.z + distance * Math.cos(yaw) * Math.cos(elevation),
      );
      // Desde arriba "arriba" en pantalla es hacia donde mira el frente de la vista.
      camera.up.set(0, 1, 0);
      if (options.camera === 'top') camera.up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      renderer.clear();
      renderer.render(scene, camera);
      const raw = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, raw);
      let rgba = flipRows(raw, size, size);
      if (options.outline) rgba = addOutline(rgba, size, size, options.outlineColor);
      frames.push({ rgba, size });
    }
  } finally {
    renderer.setRenderTarget(previous.target);
    renderer.setClearColor(previous.color, previous.alpha);
    target.dispose();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });
  }
  return frames;
}

function frameCanvas(frame: SpriteFrame): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = frame.size;
  canvas.height = frame.size;
  canvas.getContext('2d')!.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.size, frame.size), 0, 0);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no se pudo crear el PNG'))), 'image/png'));

/** Un PNG transparente por vista. */
export function framesToPngs(frames: SpriteFrame[]): Promise<Blob[]> {
  return Promise.all(frames.map((frame) => toBlob(frameCanvas(frame))));
}

/** Todas las vistas en un solo PNG, ordenadas de izquierda a derecha y de arriba abajo. */
export function framesToSheet(frames: SpriteFrame[]): Promise<{ blob: Blob; cols: number; rows: number }> {
  const size = frames[0].size;
  const layout = sheetLayout(frames.length, size);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d')!;
  frames.forEach((frame, i) => context.drawImage(frameCanvas(frame), ...layout.at(i)));
  return toBlob(canvas).then((blob) => ({ blob, cols: layout.cols, rows: layout.rows }));
}
