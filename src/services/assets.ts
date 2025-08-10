/* eslint-disable */
// @ts-nocheck
import { MAX_IMAGE_DIM } from '@/constants';
import type { ImageAsset, VideoAsset } from '@/types';
import { scheduleRedraw } from '@/canvas/renderer';
import { loadImageCached } from '@/services/imageCache';
import { scaleToCanvas } from '@/services/layout';

export async function loadImageFromUrl(url: string): Promise<ImageAsset> {
  try {
    // Decode scaled to display target (~2x DPR) to reduce memory without visible quality loss
    const canvas = document.getElementById('main-canvas') as HTMLCanvasElement | null;
    const desired = canvas ? scaleToCanvas(1920, 1080, canvas, 0.35) : { width: 0, height: 0 }; // upper hint
    const cached = await loadImageCached(url, desired.width && desired.height ? { resizeWidth: desired.width * 2, resizeHeight: desired.height * 2 } : undefined);
    const naturalWidth = cached.width || cached.element?.naturalWidth || 0;
    const naturalHeight = cached.height || cached.element?.naturalHeight || 0;
    // Compute placement size relative to canvas to avoid immediate resizes later
    // Use canvas computed earlier
    const sized = canvas ? scaleToCanvas(naturalWidth, naturalHeight, canvas, 0.35) : { width: naturalWidth, height: naturalHeight };
    const width = sized.width; const height = sized.height;
    // Always create a fresh element/bitmap reference to avoid shared-state deletion issues
    let element: HTMLImageElement | null = null;
    let bitmap: ImageBitmap | null = null;
    if (cached.bitmap) {
      bitmap = cached.bitmap; // drawImage works with shared bitmap safely
    } else if (cached.element) {
      element = new Image();
      element.crossOrigin = 'anonymous';
      (element as any).decoding = 'async';
      element.src = cached.element.currentSrc || cached.element.src || url;
    }
    // Center placement on canvas initially for faster composition
    let x = 0, y = 0;
    if (canvas) { const rect = canvas.getBoundingClientRect(); x = Math.round((rect.width - width) / 2); y = Math.round((rect.height - height) / 2); }
    return { type: 'image', x, y, width, height, element, bitmap, loaded: true, sourceUrl: url, naturalWidth, naturalHeight };
  } catch {
    // Fallback
    const img = new Image();
    img.crossOrigin = 'anonymous';
    (img as any).decoding = 'async';
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    const naturalWidth = loaded.naturalWidth || loaded.width || 0;
    const naturalHeight = loaded.naturalHeight || loaded.height || 0;
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(naturalWidth, naturalHeight));
    const width = Math.round(naturalWidth * scale);
    const height = Math.round(naturalHeight * scale);
    return { type: 'image', x: 0, y: 0, width, height, element: loaded, loaded: true, sourceUrl: url, naturalWidth, naturalHeight };
  }
}

export function createVideoFromUrl(url: string): VideoAsset {
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous';
  v.playsInline = true;
  v.muted = true;
  v.loop = true;
  v.preload = 'auto';
  const asset: VideoAsset = { type: 'video', x: 0, y: 0, width: 480, height: 270, element: v, ready: false, sourceUrl: url };
  const updateSizeFromMetadata = () => {
    const vw = v.videoWidth || 0; const vh = v.videoHeight || 0;
    if (vw > 0 && vh > 0) {
      const baseW = 480;
      const ar = vw / vh;
      asset.width = Math.round(baseW);
      asset.height = Math.round(baseW / ar);
    }
  };
  v.addEventListener('loadedmetadata', () => {
    updateSizeFromMetadata();
    try { v.currentTime = 0; } catch {}
    try { (v as any).requestVideoFrameCallback && (v as any).requestVideoFrameCallback(() => {}); } catch {}
  });
  v.addEventListener('seeked', () => {
    if (!asset.ready) { asset.ready = true; try { v.pause(); scheduleRedraw(); } catch {} }
  });
  v.addEventListener('loadeddata', () => { asset.ready = true; try { v.pause(); scheduleRedraw(); } catch {} });
  v.src = url;
  return asset;
}


