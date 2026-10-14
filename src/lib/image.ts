export interface PreparedImage {
  /** JPEG, long edge ≤ 1024px, base64 without the data: prefix */
  base64: string;
  mediaType: 'image/jpeg';
  /** Data URL of the same image, for preview */
  preview: string;
  /** 160×160 centre-cropped JPEG data URL for lists */
  thumb: string;
}

const MAX_EDGE = 1024;
const THUMB = 160;

export async function prepareImage(file: File): Promise<PreparedImage> {
  const img = await loadImage(file);
  const main = scaled(img, MAX_EDGE);
  const preview = main.toDataURL('image/jpeg', 0.85);
  const thumb = cover(main, THUMB).toDataURL('image/jpeg', 0.7);
  return { base64: preview.slice(preview.indexOf(',') + 1), mediaType: 'image/jpeg', preview, thumb };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image-decode'));
    };
    img.src = url;
  });
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

function scaled(img: HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const s = Math.min(1, maxEdge / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  context(c).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function cover(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const side = Math.min(src.width, src.height);
  const sx = (src.width - side) / 2;
  const sy = (src.height - side) / 2;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  context(c).drawImage(src, sx, sy, side, side, 0, 0, size, size);
  return c;
}
