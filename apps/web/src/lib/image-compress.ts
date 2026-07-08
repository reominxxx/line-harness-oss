/**
 * 画像圧縮ユーティリティ
 *
 * リッチメニューは LINE 仕様で固定サイズ・1MB 以下が要求される。
 * 大きい / 小さい画像を渡されても自動でリサイズして JPEG 品質を段階的に
 * 落とし、上限内に収まる File を返す。
 */

export interface CompressOptions {
  targetWidth: number;
  targetHeight: number;
  /** 上限バイト数（既定 1MB - 安全マージン込み 950KB） */
  maxBytes?: number;
  /** 初期品質（0〜1） */
  initialQuality?: number;
  /** 最低品質（これ以下に下げない） */
  minQuality?: number;
  /** 出力 mime（既定 image/jpeg） */
  mimeType?: 'image/jpeg' | 'image/png';
}

export interface CompressResult {
  file: File;
  width: number;
  height: number;
  quality: number;
  originalBytes: number;
  compressedBytes: number;
}

const RICH_MENU_LARGE = { w: 2500, h: 1686 } as const;
const RICH_MENU_COMPACT = { w: 2500, h: 843 } as const;

// 配信用クリエイティブの推奨サイズ。gpt-image-2 出力をそのまま使えるよう、
// 元アスペクト比 (1:1 / 3:2 / 16:9 / 2:3) を維持。LINE 画像メッセージは
// 1MB 以下推奨なので圧縮処理を通す。
const BROADCAST_SQUARE = { w: 1024, h: 1024 } as const;
const BROADCAST_LANDSCAPE = { w: 1536, h: 1024 } as const;
const BROADCAST_PORTRAIT = { w: 1024, h: 1536 } as const;
const BROADCAST_BANNER_WIDE = { w: 1536, h: 864 } as const;

export type ImageTargetSize =
  | 'large'
  | 'compact'
  | 'square'
  | 'landscape'
  | 'portrait'
  | 'banner_wide';

export function imageTargetSize(size: ImageTargetSize): { w: number; h: number } {
  switch (size) {
    case 'large': return RICH_MENU_LARGE;
    case 'compact': return RICH_MENU_COMPACT;
    case 'square': return BROADCAST_SQUARE;
    case 'landscape': return BROADCAST_LANDSCAPE;
    case 'portrait': return BROADCAST_PORTRAIT;
    case 'banner_wide': return BROADCAST_BANNER_WIDE;
  }
}

// 互換 (既存呼び出し)
export function richMenuTargetSize(size: 'large' | 'compact'): { w: number; h: number } {
  return size === 'large' ? RICH_MENU_LARGE : RICH_MENU_COMPACT;
}

export async function compressImage(file: File, options: CompressOptions): Promise<CompressResult> {
  const maxBytes = options.maxBytes ?? 950 * 1024;
  const initialQuality = options.initialQuality ?? 0.92;
  const minQuality = options.minQuality ?? 0.5;
  const mimeType = options.mimeType ?? 'image/jpeg';
  const originalBytes = file.size;

  const bitmap = await fileToImageBitmap(file);
  try {
    const { canvas, width, height } = drawCovered(bitmap, options.targetWidth, options.targetHeight);

    // 段階的に品質を下げて上限内に収める
    let quality = initialQuality;
    let blob: Blob | null = null;
    for (let i = 0; i < 12; i++) {
      blob = await canvasToBlob(canvas, mimeType, quality);
      if (!blob) throw new Error('画像のエンコードに失敗しました');
      if (blob.size <= maxBytes) break;
      if (quality <= minQuality + 0.001) break;
      // 大きさによって減衰幅を変える（過剰品質ロスを防ぐ）
      const overRatio = blob.size / maxBytes;
      const step = overRatio > 2 ? 0.15 : overRatio > 1.3 ? 0.08 : 0.04;
      quality = Math.max(minQuality, quality - step);
    }
    if (!blob) throw new Error('圧縮に失敗しました');

    const name = file.name.replace(/\.[^.]+$/, '') + (mimeType === 'image/png' ? '.png' : '.jpg');
    const compressed = new File([blob], name, { type: mimeType });

    return {
      file: compressed,
      width,
      height,
      quality,
      originalBytes,
      compressedBytes: compressed.size,
    };
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

async function fileToImageBitmap(file: File): Promise<ImageBitmap> {
  // createImageBitmap は Safari でも大体動くが、メタデータの orientation 等は
  // imageOrientation: 'from-image' で吸収する
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

function drawCovered(
  bitmap: ImageBitmap,
  targetW: number,
  targetH: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context not available');

  // 白背景（PNG 透過 → JPEG 化時の黒抜け対策）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);

  const srcAspect = bitmap.width / bitmap.height;
  const dstAspect = targetW / targetH;

  // contain: 縮小して全体を入れる（余白は白）
  let drawW: number;
  let drawH: number;
  if (srcAspect > dstAspect) {
    drawW = targetW;
    drawH = Math.round(targetW / srcAspect);
  } else {
    drawH = targetH;
    drawW = Math.round(targetH * srcAspect);
  }
  const dx = Math.round((targetW - drawW) / 2);
  const dy = Math.round((targetH - drawH) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, dx, dy, drawW, drawH);

  return { canvas, width: targetW, height: targetH };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/**
 * リッチメニュー / 配信用 共通ショートカット。
 * 与えられた file を size 別のターゲット解像度 & 1MB 以下に整える。
 */
export async function compressForRichMenu(
  file: File,
  size: ImageTargetSize,
): Promise<CompressResult> {
  const { w, h } = imageTargetSize(size);
  return compressImage(file, {
    targetWidth: w,
    targetHeight: h,
    mimeType: 'image/jpeg',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
