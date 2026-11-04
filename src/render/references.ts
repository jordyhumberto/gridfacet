import * as THREE from 'three';
import { referenceTransform, type RefImage } from '../core/references';

/** Las imágenes de referencia dibujadas al fondo de la escena: no se pueden señalar, no tapan las piezas y no entran en las exportaciones. */
export class ReferenceLayer {
  readonly group = new THREE.Group();
  private readonly textures = new Map<string, THREE.Texture>();

  constructor() {
    this.group.renderOrder = -10;
  }

  /** Redibuja todas las imágenes según la lista. */
  set(images: RefImage[]): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    const used = new Set<string>();
    for (const image of images) {
      if (!image.visible) continue;
      used.add(image.data);
      const { position, rotation, width, height } = referenceTransform(image);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: this.textureOf(image.data), transparent: true, opacity: image.opacity, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      );
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.renderOrder = -10;
      // La imagen es solo para mirar: los clics y el cursor la atraviesan.
      mesh.raycast = () => {};
      this.group.add(mesh);
    }
    for (const [data, texture] of this.textures) {
      if (used.has(data)) continue;
      texture.dispose();
      this.textures.delete(data);
    }
  }

  private textureOf(data: string): THREE.Texture {
    let texture = this.textures.get(data);
    if (!texture) {
      texture = new THREE.TextureLoader().load(data);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(data, texture);
    }
    return texture;
  }
}

/** Abre una imagen elegida, la reduce a 1024 px de lado como mucho y la devuelve como dirección de datos (PNG; JPEG si pesa demasiado). */
export async function loadReferenceFile(file: File): Promise<{ data: string; aspect: number; name: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let data = file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png');
  if (data.length > 1_500_000) data = canvas.toDataURL('image/jpeg', 0.85);
  return { data, aspect: w / h, name: file.name.replace(/\.[^.]+$/, '') };
}
