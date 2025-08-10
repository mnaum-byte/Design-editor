/* eslint-disable */
// @ts-nocheck
import { computeGeometry } from '@/canvas/renderer';

export type LayoutPreset = 'landscape' | 'square' | 'portrait';

export function computeCanvasCssSize(stageWidth: number, stageHeight: number, preset: LayoutPreset) {
  const spacer = 32;
  const maxHeight = Math.min(stageHeight * 0.8, Math.max(0, stageHeight - 48 - spacer));
  const maxWidth = stageWidth * 0.98;
  let targetWidth = maxWidth;
  let targetHeight = maxHeight;
  if (preset === 'square') {
    const size = Math.min(maxWidth, maxHeight);
    targetWidth = size;
    targetHeight = size;
  } else if (preset === 'portrait') {
    const portraitW = 9;
    const portraitH = 19.5;
    const widthByHeight = maxHeight * (portraitW / portraitH);
    const heightByWidth = maxWidth * (portraitH / portraitW);
    if (widthByHeight <= maxWidth) { targetWidth = widthByHeight; targetHeight = maxHeight; }
    else { targetWidth = maxWidth; targetHeight = heightByWidth; }
  } else {
    const heightByWidth = maxWidth * (9 / 16);
    const widthByHeight = maxHeight * (16 / 9);
    if (heightByWidth <= maxHeight) { targetWidth = maxWidth; targetHeight = heightByWidth; }
    else { targetWidth = widthByHeight; targetHeight = maxHeight; }
  }
  return { width: Math.floor(targetWidth), height: Math.floor(targetHeight) };
}

export function getResponsiveGrid(width: number, height: number) {
  const cols = width < 600 ? 4 : (width < 1024 ? 8 : 12);
  const maxByHeight = Math.max(1, Math.floor(height / 130));
  const finalColumns = Math.min(cols, maxByHeight);
  const rows = Math.max(1, Math.min(Math.round(finalColumns), maxByHeight));
  return computeGeometry(width, height, finalColumns, rows);
}

// Scale an asset so its longest side is at most a fraction of the canvas' shortest side
export function scaleToCanvas(maxPixelWidth: number, maxPixelHeight: number, canvas: HTMLCanvasElement, fraction = 0.35) {
  const rect = canvas.getBoundingClientRect();
  const limit = Math.max(1, Math.round(Math.min(rect.width, rect.height) * fraction));
  const longest = Math.max(maxPixelWidth || 1, maxPixelHeight || 1);
  const scale = Math.min(1, limit / longest);
  return {
    width: Math.max(1, Math.round((maxPixelWidth || 1) * scale)),
    height: Math.max(1, Math.round((maxPixelHeight || 1) * scale)),
  };
}


