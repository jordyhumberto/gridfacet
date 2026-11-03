import { CLEAR, uvOf, type FaceTexture } from '../core/texture';
import { faceColorOf, type Piece } from '../core/piece';
import { floodFill, stampLine, textureOfFace, visibleColor } from '../core/pixels';

/** Lo que el editor necesita de la aplicación: las herramientas elegidas y cómo llevar el resultado al modelo. */
export interface FaceEditorHost {
  tool(): string;
  size(): number;
  color(): number;
  pickColor(color: number): void;
  /** ¿Sigue la pieza en el modelo? (un deshacer puede haberla cambiado). */
  stillThere(piece: Piece): boolean;
  /** Dibuja una textura provisional en la vista 3D sin tocar el modelo. */
  preview(piece: Piece, faceIndex: number, texture: FaceTexture): void;
  /** Pasa la textura al modelo como un cambio y devuelve la pieza nueva. */
  commit(piece: Piece, faceIndex: number, texture: FaceTexture): Piece;
}

const MAX_SIDE = 520;

/** Una cara abierta en plano: su textura ampliada para pintarla de frente, con las mismas herramientas que en la vista 3D. */
export class FaceEditor {
  private piece: Piece | null = null;
  private faceIndex = 0;
  private texture: FaceTexture = { w: 1, h: 1, pixels: [CLEAR] };
  private scale = 8;
  private stroke: { texture: FaceTexture; changed: boolean; last: { x: number; y: number } | null } | null = null;
  private readonly context: CanvasRenderingContext2D;

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly host: FaceEditorHost,
  ) {
    this.context = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', () => this.up());
    canvas.addEventListener('pointercancel', () => this.up());
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(piece: Piece, faceIndex: number): void {
    this.piece = piece;
    this.faceIndex = faceIndex;
    this.texture = textureOfFace(piece, faceIndex);
    this.scale = Math.max(4, Math.floor(MAX_SIDE / Math.max(this.texture.w, this.texture.h)));
    this.canvas.width = this.texture.w * this.scale;
    this.canvas.height = this.texture.h * this.scale;
    this.canvas.style.width = `${this.canvas.width}px`;
    this.canvas.style.height = `${this.canvas.height}px`;
    this.root.hidden = false;
    this.draw(this.texture);
  }

  close(): void {
    this.stroke = null;
    this.root.hidden = true;
    this.piece = null;
  }

  private outline(): void {
    const face = this.piece!.faces[this.faceIndex];
    face.map((p) => uvOf(face, p)).forEach(([s, t], i) => {
      const x = s * this.canvas.width;
      const y = t * this.canvas.height;
      if (i === 0) this.context.moveTo(x, y);
      else this.context.lineTo(x, y);
    });
    this.context.closePath();
  }

  private draw(texture: FaceTexture): void {
    const piece = this.piece;
    if (!piece) return;
    const { context, scale } = this;
    const base = faceColorOf(piece, this.faceIndex);
    for (let y = 0; y < texture.h; y++) {
      for (let x = 0; x < texture.w; x++) {
        context.fillStyle = `#${visibleColor(texture, x, y, base).toString(16).padStart(6, '0')}`;
        context.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    if (scale >= 8) {
      context.strokeStyle = 'rgba(0,0,0,0.18)';
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= texture.w; x++) {
        context.moveTo(x * scale + 0.5, 0);
        context.lineTo(x * scale + 0.5, texture.h * scale);
      }
      for (let y = 0; y <= texture.h; y++) {
        context.moveTo(0, y * scale + 0.5);
        context.lineTo(texture.w * scale, y * scale + 0.5);
      }
      context.stroke();
    }
    // Lo que queda fuera del polígono de la cara no se ve en el modelo: se atenúa.
    context.beginPath();
    context.rect(0, 0, this.canvas.width, this.canvas.height);
    this.outline();
    context.fillStyle = 'rgba(10,12,18,0.7)';
    context.fill('evenodd');
    context.strokeStyle = '#fff';
    context.lineWidth = 1.5;
    context.beginPath();
    this.outline();
    context.stroke();
  }

  private cellAt(e: PointerEvent): { x: number; y: number } {
    const box = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * this.texture.w);
    const y = Math.floor(((e.clientY - box.top) / box.height) * this.texture.h);
    return { x: Math.min(this.texture.w - 1, Math.max(0, x)), y: Math.min(this.texture.h - 1, Math.max(0, y)) };
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0 || !this.piece) return;
    if (!this.host.stillThere(this.piece)) {
      this.close();
      return;
    }
    const cell = this.cellAt(e);
    if (e.altKey) {
      this.host.pickColor(visibleColor(this.texture, cell.x, cell.y, faceColorOf(this.piece, this.faceIndex)));
      return;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura el trazo sigue mientras el puntero esté sobre el lienzo.
    }
    this.stroke = { texture: { w: this.texture.w, h: this.texture.h, pixels: [...this.texture.pixels] }, changed: false, last: null };
    this.paint(cell);
  }

  private move(e: PointerEvent): void {
    if (this.stroke) this.paint(this.cellAt(e));
  }

  private paint({ x, y }: { x: number; y: number }): void {
    const stroke = this.stroke;
    if (!stroke || !this.piece) return;
    const tool = this.host.tool();
    const from = stroke.last ?? { x, y };
    stroke.last = { x, y };
    const changed = tool === 'fill' ? floodFill(stroke.texture, x, y, this.host.color()) : stampLine(stroke.texture, from.x, from.y, x, y, this.host.size(), tool === 'eraser' ? CLEAR : this.host.color());
    if (changed === 0) return;
    stroke.changed = true;
    this.draw(stroke.texture);
    this.host.preview(this.piece, this.faceIndex, stroke.texture);
  }

  private up(): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke?.changed || !this.piece) return;
    this.piece = this.host.commit(this.piece, this.faceIndex, stroke.texture);
    this.texture = stroke.texture;
  }
}
