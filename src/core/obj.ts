import { buildExportMeshes } from './export';
import { faceNormal, type Piece, type Vec3 } from './piece';
import { CLEAR, uvOf, type FaceTexture } from './texture';

/** Separación entre texturas dentro del atlas, para que un píxel no se cuele en el vecino. */
const GUTTER = 1;
/** Lo que se separa cada textura de su cara (el mismo valor que al dibujarla en pantalla). */
const LIFT = 0.002;

export interface AtlasSlot {
  x: number;
  y: number;
}

/** Coloca rectángulos en filas de arriba abajo (primero los más altos); devuelve su posición y el tamaño total del atlas. */
export function packAtlas(sizes: { w: number; h: number }[], maxWidth = 1024): { slots: AtlasSlot[]; width: number; height: number } {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || sizes[b].w - sizes[a].w);
  const widest = Math.max(0, ...sizes.map((s) => s.w + GUTTER));
  const limit = Math.max(maxWidth, widest);
  const slots: AtlasSlot[] = new Array(sizes.length);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const i of order) {
    const { w, h } = sizes[i];
    if (x > 0 && x + w + GUTTER > limit) {
      x = 0;
      y += rowHeight + GUTTER;
      rowHeight = 0;
    }
    slots[i] = { x, y };
    x += w + GUTTER;
    rowHeight = Math.max(rowHeight, h);
    width = Math.max(width, x - GUTTER);
  }
  return { slots, width, height: sizes.length === 0 ? 0 : y + rowHeight };
}

export interface ObjExport {
  obj: string;
  mtl: string;
  /** Imagen con todas las texturas juntas (filas de arriba abajo, 0xRRGGBB o `CLEAR`); null si ninguna cara está pintada. */
  atlas: { width: number; height: number; pixels: number[] } | null;
}

const hex = (color: number): string => color.toString(16).padStart(6, '0');
const channel = (value: number): string => (Math.round((value / 255) * 1e4) / 1e4).toString();
const num = (value: number): string => (Math.round(value * 1e6) / 1e6).toString();

/**
 * Modelo en OBJ: la unión de las piezas por color (como el GLB "unión por color") más, aparte, las caras con textura
 * apoyadas sobre sus caras y con UV hacia un atlas. `baseName` da nombre al .mtl y al PNG del atlas.
 */
export function buildObj(pieces: Piece[], baseName: string): ObjExport {
  const lines: string[] = [`mtllib ${baseName}.mtl`];
  const materials = new Map<number, string>();
  let vertexCount = 0;

  for (const mesh of buildExportMeshes(pieces, 'merged')) {
    const material = `color_${hex(mesh.color)}`;
    materials.set(mesh.color, material);
    lines.push(`o ${mesh.name}`, `usemtl ${material}`);
    for (let i = 0; i < mesh.positions.length; i += 3) lines.push(`v ${num(mesh.positions[i])} ${num(mesh.positions[i + 1])} ${num(mesh.positions[i + 2])}`);
    for (let i = 0; i < mesh.indices.length; i += 3) lines.push(`f ${mesh.indices.slice(i, i + 3).map((k) => k + 1 + vertexCount).join(' ')}`);
    vertexCount += mesh.positions.length / 3;
  }

  const painted: { face: Vec3[]; texture: FaceTexture }[] = [];
  for (const piece of pieces) {
    piece.faces.forEach((face, i) => {
      const texture = piece.faceTextures?.[i];
      if (texture) painted.push({ face, texture });
    });
  }

  let atlas: ObjExport['atlas'] = null;
  if (painted.length > 0) {
    const packed = packAtlas(painted.map(({ texture }) => ({ w: texture.w, h: texture.h })));
    const pixels = new Array<number>(packed.width * packed.height).fill(CLEAR);
    painted.forEach(({ texture }, k) => {
      const slot = packed.slots[k];
      for (let y = 0; y < texture.h; y++) for (let x = 0; x < texture.w; x++) pixels[(slot.y + y) * packed.width + slot.x + x] = texture.pixels[y * texture.w + x];
    });
    atlas = { width: packed.width, height: packed.height, pixels };

    lines.push('o Texturas', 'usemtl texturas');
    let textureCoords = 0;
    painted.forEach(({ face, texture }, k) => {
      const slot = packed.slots[k];
      const n = faceNormal(face);
      const length = Math.hypot(n[0], n[1], n[2]) || 1;
      const lift = n.map((c) => (c / length) * LIFT);
      const corner: string[] = [];
      for (const p of face) {
        const [s, t] = uvOf(face, p);
        // En OBJ la v crece hacia arriba y el atlas se lee de arriba abajo.
        const u = (slot.x + s * texture.w) / packed.width;
        const v = 1 - (slot.y + t * texture.h) / packed.height;
        lines.push(`v ${num(p[0] + lift[0])} ${num(p[1] + lift[1])} ${num(p[2] + lift[2])}`, `vt ${num(u)} ${num(v)}`);
        corner.push(`${vertexCount + corner.length + 1}/${textureCoords + corner.length + 1}`);
      }
      for (let i = 1; i < face.length - 1; i++) lines.push(`f ${corner[0]} ${corner[i]} ${corner[i + 1]}`);
      vertexCount += face.length;
      textureCoords += face.length;
    });
  }

  const mtl: string[] = [];
  for (const [color, name] of materials) {
    mtl.push(`newmtl ${name}`, `Kd ${channel((color >> 16) & 255)} ${channel((color >> 8) & 255)} ${channel(color & 255)}`, 'Ks 0 0 0', '');
  }
  if (atlas) mtl.push('newmtl texturas', 'Kd 1 1 1', 'Ks 0 0 0', `map_Kd ${baseName}-texture.png`, `map_d ${baseName}-texture.png`, '');
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n'), atlas };
}
