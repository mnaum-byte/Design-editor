/* eslint-disable */
// @ts-nocheck
import { CANVAS_BG_COLOR, GRID_LINE_COLOR, OUTLINE_STROKE, MAX_IMAGE_DIM } from '@/constants';
import { assets, backgroundLayer, interactionState } from '@/state/store';
import { pushHistory } from '@/state/history';

let canvas: HTMLCanvasElement;
let lastGeometry: any = null;
let gridCacheCanvas: HTMLCanvasElement | null = null;
let gridCacheCtx: CanvasRenderingContext2D | null = null;
let gridCacheBitmap: ImageBitmap | null = null;
let lastCacheSignature = '';
let lowQualityMode = false;
let gridEnabled = false;
let backgroundCacheCanvas: HTMLCanvasElement | null = null;
let backgroundCacheCtx: CanvasRenderingContext2D | null = null;
let backgroundCacheBitmap: ImageBitmap | null = null;
let backgroundCacheDirty = true;
let isCanvasVisible = true;
let redrawScheduled = false;
const HANDLE_SIZE = 10;
// Damping factors to reduce sensitivity of text resizing
const TEXT_SIDE_HANDLE_GAIN = 0.75;  // < 1 to slow down horizontal width changes
const TEXT_CORNER_GAIN = 0.65;       // < 1 to slow down proportional scaling from corners
const SIZE_QUANTIZATION = 2;         // snap size changes to multiples of N px to avoid jitter
const VIDEO_ICON_RADIUS = 22;
const FRAME_THROTTLE_MS = 33; // ~30fps

// Per-video offscreen surfaces to avoid main-canvas scaling cost
const videoSurfaceMap = new WeakMap<HTMLVideoElement, { canvas: any; ctx: CanvasRenderingContext2D }>();
let lastVideoFramePaintTs = 0;

function anyVideoPlaying(): boolean {
  return assets.some((a) => a.type === 'video' && a.element && !a.element.paused && !a.element.ended)
    || !!(backgroundLayer && backgroundLayer.type === 'video' && backgroundLayer.element && !backgroundLayer.element.paused && !backgroundLayer.element.ended);
}

function getVideoSurface(v: HTMLVideoElement, width: number, height: number) {
  let entry = videoSurfaceMap.get(v);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (!entry) {
    const off = (('OffscreenCanvas' in window) ? new (window as any).OffscreenCanvas(w, h) : document.createElement('canvas')) as any;
    if (!('getContext' in off)) { (off as any).width = w; (off as any).height = h; }
    const ctx = off.getContext('2d', { alpha: true }) as CanvasRenderingContext2D;
    entry = { canvas: off, ctx };
    videoSurfaceMap.set(v, entry);
  }
  // Resize if needed
  if ((entry.canvas.width !== w) || (entry.canvas.height !== h)) {
    entry.canvas.width = w; entry.canvas.height = h;
  }
  return entry;
}

function ensureVideoFrameCallback(v: HTMLVideoElement) {
  if (!(v as any).__vfcAttached) {
    (v as any).__vfcAttached = true;
    const loop = (_now: number) => {
      const now = performance.now();
      if (now - lastVideoFramePaintTs >= FRAME_THROTTLE_MS) {
        lastVideoFramePaintTs = now;
        scheduleRedraw();
      }
      if (!v.paused && !v.ended) {
        try { v.requestVideoFrameCallback(loop); } catch { requestAnimationFrame(() => loop(performance.now())); }
      }
    };
    const start = () => { try { v.requestVideoFrameCallback(loop); } catch { requestAnimationFrame(() => loop(performance.now())); } };
    v.addEventListener('play', start);
    v.addEventListener('ratechange', () => { if (!v.paused && !v.ended) start(); });
    v.addEventListener('seeked', () => { if (!v.paused && !v.ended) start(); });
    if (!v.paused && !v.ended) start();
  }
}

export function setLowQualityMode(v: boolean) { lowQualityMode = v; backgroundCacheDirty = true; }
export function setCanvasVisibility(v: boolean) { isCanvasVisible = v; }
export function setGridEnabled(v: boolean) { gridEnabled = v; scheduleRedraw(); }
export function getGridEnabled() { return gridEnabled; }

export function initRenderer(el: HTMLCanvasElement) {
  canvas = el;
  // Basic interaction hooks: mark hovering background, enable future selection wiring
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    interactionState.hoveringBackground = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    // Hover detection for assets
    const ctx = currentCtx();
    let hovered = -1;
    for (let i = assets.length - 1; i >= 0; i -= 1) {
      const b = getAssetBounds(ctx, assets[i]);
      if (!b || b.w <= 0 || b.h <= 0) continue;
      if (x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h) { hovered = i; break; }
    }
    if (hovered !== interactionState.hoveredAssetIndex) {
      interactionState.hoveredAssetIndex = hovered;
      scheduleRedraw();
    }

    // Move or resize interactions
    if (interactionState.isMovingSelected) {
      if (!interactionState.historyPushedInGesture) { try { pushHistory(); } catch {} interactionState.historyPushedInGesture = true; }
      const dx = x - interactionState.lastMoveClientX;
      const dy = y - interactionState.lastMoveClientY;
      interactionState.lastMoveClientX = x;
      interactionState.lastMoveClientY = y;
      for (const idx of interactionState.selectedAssetIndices) {
        const a = assets[idx];
        a.x += dx; a.y += dy;
      }
      // Show grabbing cursor while moving
      canvas.style.cursor = 'grabbing';
      scheduleRedraw();
      return;
    }
    if (interactionState.isResizingSelected) {
      if (!interactionState.historyPushedInGesture) { try { pushHistory(); } catch {} interactionState.historyPushedInGesture = true; }
      const only = Array.from(interactionState.selectedAssetIndices)[0];
      if (only !== undefined) {
        const a = assets[only];
        const minW = 16, minH = 16;
        const start = interactionState.initialSelectionBounds || { x: a.x, y: a.y, w: a.width, h: a.height };
        const dxStart = x - (interactionState.resizeStartClientX || x);
        const dyStart = y - (interactionState.resizeStartClientY || y);
        let nx = start.x, ny = start.y, nw = start.w, nh = start.h;
        const h = interactionState.activeHandle || '';
        if (a.type === 'text') {
          const isSide = h === 'ml' || h === 'mr';
          if (isSide) {
            const hasL = h === 'ml';
            const sign = hasL ? -1 : 1;
            const baseW = a.maxWidth || start.w || 200;
            // Symmetric around center, damped and quantized
            const rawDelta = 2 * dxStart * sign;
            const delta = rawDelta * TEXT_SIDE_HANDLE_GAIN;
            let newMax = baseW + delta;
            if (SIZE_QUANTIZATION > 1) newMax = Math.round(newMax / SIZE_QUANTIZATION) * SIZE_QUANTIZATION;
            newMax = Math.max(120, Math.round(newMax));
            a.maxWidth = newMax;
            scheduleRedraw();
            return;
          }
          // Corner handles: proportional resize like images by scaling font size/maxWidth
          const ratio = start.w > 0 && start.h > 0 ? start.w / start.h : 1;
          const signX = (h === 'tr' || h === 'br') ? 1 : -1;
          const signY = (h === 'bl' || h === 'br') ? 1 : -1;
          const sW = (start.w + signX * dxStart) / start.w;
          const sH = (start.h + signY * dyStart) / start.h;
          const candidates = [sW, sH].filter((v) => isFinite(v) && v > 0);
          let s = candidates.length ? Math.min(...candidates) : 1;
          // Dampen scale to reduce sensitivity
          s = 1 + (s - 1) * TEXT_CORNER_GAIN;
          const sMin = Math.max(minW / start.w, minH / start.h);
          if (s < sMin) s = sMin;
          const currentPx = parseFontPx(a.font) || 16;
          let newPx = currentPx * s;
          if (SIZE_QUANTIZATION > 1) newPx = Math.round(newPx / 1) * 1; // keep px integer
          newPx = Math.max(8, Math.round(newPx));
          a.font = setFontPx(a.font, newPx);
          let newMaxW = (a.maxWidth ? a.maxWidth : start.w) * s;
          if (SIZE_QUANTIZATION > 1) newMaxW = Math.round(newMaxW / SIZE_QUANTIZATION) * SIZE_QUANTIZATION;
          a.maxWidth = Math.max(120, Math.round(newMaxW));
          // Recompute new box and reposition like images
          const nw = Math.round(start.w * s);
          const nh = Math.round(start.h * s);
          let nx = start.x; let ny = start.y;
          if (h === 'br') { nx = start.x; ny = start.y; }
          if (h === 'tr') { nx = start.x; ny = start.y + (start.h - nh); }
          if (h === 'bl') { nx = start.x + (start.w - nw); ny = start.y; }
          if (h === 'tl') { nx = start.x + (start.w - nw); ny = start.y + (start.h - nh); }
          a.x = Math.round(nx); a.y = Math.round(ny);
          scheduleRedraw();
          return;
        }
        // Aspect-ratio locked corner scaling (continuous)
        const ratio = start.w > 0 && start.h > 0 ? start.w / start.h : 1;
        const signX = (h === 'tr' || h === 'br') ? 1 : -1;
        const signY = (h === 'bl' || h === 'br') ? 1 : -1;
        const sW = (start.w + signX * dxStart) / start.w;
        const sH = (start.h + signY * dyStart) / start.h;
        // Choose the smaller positive scale so both axes remain within the drag intent
        const candidates = [sW, sH].filter((v) => isFinite(v) && v > 0);
        let s = candidates.length ? Math.min(...candidates) : 1;
        const sMin = Math.max(minW / start.w, minH / start.h);
        if (s < sMin) s = sMin;
        nw = Math.max(minW, Math.round(start.w * s));
        nh = Math.max(minH, Math.round(nw / ratio));
        // Position based on fixed corner
        if (h === 'br') { nx = start.x; ny = start.y; }
        if (h === 'tr') { nx = start.x; ny = start.y + (start.h - nh); }
        if (h === 'bl') { nx = start.x + (start.w - nw); ny = start.y; }
        if (h === 'tl') { nx = start.x + (start.w - nw); ny = start.y + (start.h - nh); }
        a.x = Math.round(nx); a.y = Math.round(ny); a.width = Math.round(nw); a.height = Math.round(nh);
        scheduleRedraw();
      }
      return;
    }

    // Update marquee end while dragging
    if (interactionState.isMarqueeSelecting) {
      interactionState.marqueeEndCX = x;
      interactionState.marqueeEndCY = y;
      // Live-update selection during marquee
      const x1 = Math.min(interactionState.marqueeStartCX, interactionState.marqueeEndCX);
      const y1 = Math.min(interactionState.marqueeStartCY, interactionState.marqueeEndCY);
      const x2 = Math.max(interactionState.marqueeStartCX, interactionState.marqueeEndCX);
      const y2 = Math.max(interactionState.marqueeStartCY, interactionState.marqueeEndCY);
      const ctxSel = currentCtx();
      const base = new Set<number>(interactionState.marqueeAdditive && interactionState.initialSelectedSnapshot ? (interactionState.initialSelectedSnapshot as any) : []);
      for (let i = 0; i < assets.length; i += 1) {
        const b = getAssetBounds(ctxSel, assets[i]);
        if (!b || b.w <= 0 || b.h <= 0) continue;
        const ix = Math.max(x1, b.x);
        const iy = Math.max(y1, b.y);
        const ax = Math.min(x2, b.x + b.w);
        const ay = Math.min(y2, b.y + b.h);
        if (ix < ax && iy < ay) base.add(i);
      }
      interactionState.selectedAssetIndices = base;
      interactionState.hoveredAssetIndex = -1; // suppress hover while marquee
      scheduleRedraw();
      return;
    }

    // Handle hover detection for 4 corner resize handles
    canvas.style.cursor = 'default';
    interactionState.hoveredHandle = null;
    if (interactionState.selectedAssetIndices.size === 1) {
      const only = Array.from(interactionState.selectedAssetIndices)[0];
      const b = getAssetBounds(ctx, assets[only]);
      const handles = getHandleRects(b);
      for (const [id, r] of Object.entries(handles)) {
        if (x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h) {
          interactionState.hoveredHandle = id;
          canvas.style.cursor = cursorForHandle(id);
          break;
        }
      }
    }
    // If not on a resize handle, but an asset is hoverable, show grab cursor
    if (!interactionState.hoveredHandle) {
      if (interactionState.hoveredAssetIndex >= 0) {
        canvas.style.cursor = 'grab';
      } else {
        canvas.style.cursor = 'default';
      }
    }
  }, { passive: true });

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = getMouseCanvasXY(e);
    const ctx = currentCtx();
    let hit = -1;
    for (let i = assets.length - 1; i >= 0; i -= 1) {
      const b = getAssetBounds(ctx, assets[i]);
      if (!b || b.w <= 0 || b.h <= 0) continue;
      if (x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h) { hit = i; break; }
    }
    if (hit >= 0) {
      const asset = assets[hit];
      // If clicking video overlay icon, toggle play/pause only when inside icon
      if (asset.type === 'video' && asset.element && asset.ready) {
        const cx = Math.round(asset.x + asset.width / 2);
        const cy = Math.round(asset.y + asset.height / 2);
        const dx = x - cx; const dy = y - cy;
        const inside = (dx * dx + dy * dy) <= ((VIDEO_ICON_RADIUS + 6) * (VIDEO_ICON_RADIUS + 6));
        if (inside) {
          try { if (asset.element.paused || asset.element.ended) asset.element.play(); else asset.element.pause(); } catch {}
          scheduleRedraw();
          return; // stop further selection/move handling
        }
      }
      const additive = !!(e.shiftKey || (e as any).metaKey || (e as any).ctrlKey || (e as any).altKey);
      if (!additive) interactionState.selectedAssetIndices.clear();
      const already = interactionState.selectedAssetIndices.has(hit);
      if (additive && ((e as any).metaKey || (e as any).ctrlKey || (e as any).altKey)) {
        if (already) interactionState.selectedAssetIndices.delete(hit);
        else interactionState.selectedAssetIndices.add(hit);
      } else {
        interactionState.selectedAssetIndices.add(hit);
      }
      // If handle hovered, begin resizing; else begin moving
      const b = getAssetBounds(ctx, assets[hit]);
      const handles = getHandleRects(b);
      let startedResize = false;
      for (const [id, r] of Object.entries(handles)) {
        if (x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h) {
          interactionState.isResizingSelected = true;
          interactionState.activeHandle = id;
          interactionState.initialSelectionBounds = { ...b };
          interactionState.resizeStartClientX = x;
          interactionState.resizeStartClientY = y;
          interactionState.lastMoveClientX = x;
          interactionState.lastMoveClientY = y;
          interactionState.historyPushedInGesture = false;
          startedResize = true;
          break;
        }
      }
      if (!startedResize) {
        interactionState.isMovingSelected = true;
        interactionState.lastMoveClientX = x;
        interactionState.lastMoveClientY = y;
        interactionState.historyPushedInGesture = false;
        canvas.style.cursor = 'grabbing';
      }
      scheduleRedraw();
    } else {
      // If clicked directly on a handle (which is just outside bounds), allow resizing current selection
      // Also allow toggling play/pause for background video via center overlay hit-test
      if (backgroundLayer && backgroundLayer.type === 'video' && backgroundLayer.element && backgroundLayer.ready) {
        const rect = canvas.getBoundingClientRect();
        const cx = Math.round(rect.width / 2);
        const cy = Math.round(rect.height / 2);
        const dx0 = x - cx; const dy0 = y - cy;
        const insideBg = (dx0 * dx0 + dy0 * dy0) <= ((VIDEO_ICON_RADIUS + 6) * (VIDEO_ICON_RADIUS + 6));
        if (insideBg) {
          try { if (backgroundLayer.element.paused || backgroundLayer.element.ended) backgroundLayer.element.play(); else backgroundLayer.element.pause(); } catch {}
          scheduleRedraw();
          return;
        }
      }
      if (interactionState.selectedAssetIndices.size === 1) {
        const only = Array.from(interactionState.selectedAssetIndices)[0];
        const b = getAssetBounds(ctx, assets[only]);
        const handles = getHandleRects(b);
        for (const [id, r] of Object.entries(handles)) {
          if (x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h) {
            interactionState.isResizingSelected = true;
            interactionState.activeHandle = id;
            interactionState.initialSelectionBounds = { ...b };
            interactionState.resizeStartClientX = x;
            interactionState.resizeStartClientY = y;
            interactionState.lastMoveClientX = x;
            interactionState.lastMoveClientY = y;
            interactionState.historyPushedInGesture = false;
            scheduleRedraw();
            return;
          }
        }
      }
      // Start marquee selection
      interactionState.isMarqueeSelecting = true;
      interactionState.marqueeStartCX = x;
      interactionState.marqueeStartCY = y;
      interactionState.marqueeEndCX = x;
      interactionState.marqueeEndCY = y;
      interactionState.marqueeAdditive = !!(e.shiftKey || (e as any).metaKey || (e as any).ctrlKey || (e as any).altKey);
      interactionState.initialSelectedSnapshot = new Set<number>(interactionState.selectedAssetIndices);
      scheduleRedraw();
    }
  });

  window.addEventListener('mouseup', () => {
    if (interactionState.isMovingSelected || interactionState.isResizingSelected) {
      interactionState.isMovingSelected = false;
      interactionState.isResizingSelected = false;
      interactionState.hoveredHandle = null;
      interactionState.historyPushedInGesture = false;
    }
    if (interactionState.isMarqueeSelecting) {
      // Finalize marquee selection
      const x1 = Math.min(interactionState.marqueeStartCX, interactionState.marqueeEndCX);
      const y1 = Math.min(interactionState.marqueeStartCY, interactionState.marqueeEndCY);
      const x2 = Math.max(interactionState.marqueeStartCX, interactionState.marqueeEndCX);
      const y2 = Math.max(interactionState.marqueeStartCY, interactionState.marqueeEndCY);
      const w = x2 - x1; const h = y2 - y1;
      const smallDrag = w < 3 && h < 3;
      const ctx = currentCtx();
      if (!interactionState.marqueeAdditive && !smallDrag) interactionState.selectedAssetIndices.clear();
      if (!smallDrag) {
        for (let i = 0; i < assets.length; i += 1) {
          const b = getAssetBounds(ctx, assets[i]);
          if (!b || b.w <= 0 || b.h <= 0) continue;
          const ix = Math.max(x1, b.x);
          const iy = Math.max(y1, b.y);
          const ax = Math.min(x2, b.x + b.w);
          const ay = Math.min(y2, b.y + b.h);
          if (ix < ax && iy < ay) interactionState.selectedAssetIndices.add(i);
        }
      } else if (!interactionState.marqueeAdditive) {
        // Small click in empty area clears selection
        interactionState.selectedAssetIndices.clear();
      }
      interactionState.isMarqueeSelecting = false;
      scheduleRedraw();
    }
  });
}

// Class-based facade to expose a stable, modular API
export class CanvasRenderer {
  private element: HTMLCanvasElement;

  constructor(element: HTMLCanvasElement) {
    this.element = element;
    initRenderer(element);
  }

  resize() { resizeCanvasAndDraw(); }
  draw(ctx: CanvasRenderingContext2D) { draw(ctx); }
  scheduleRedraw() { scheduleRedraw(); }

  setLowQualityMode(v: boolean) { setLowQualityMode(v); }
  setVisibility(v: boolean) { setCanvasVisibility(v); }
  setGridEnabled(v: boolean) { setGridEnabled(v); }
  getGridEnabled() { return getGridEnabled(); }

  getDimensions() { return getCanvasDimensions(); }
  static computeGeometry(width: number, height: number, cols: number, rows: number) { return computeGeometry(width, height, cols, rows); }
}

export function getCanvasDimensions() {
  if (lastGeometry) return { width: lastGeometry.width, height: lastGeometry.height };
  const rect = canvas.getBoundingClientRect();
  return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
}

function getResponsiveColumns(canvasWidth: number) {
  if (canvasWidth < 600) return 4; if (canvasWidth < 1024) return 8; return 12;
}

function getResponsiveRows(canvasWidth: number, canvasHeight: number, cols: number) {
  const maxRowsByHeight = Math.max(1, Math.floor(canvasHeight / 130));
  return Math.max(1, Math.min(Math.round(cols), maxRowsByHeight));
}

function getTargetDpr() { const natural = Math.min(2, window.devicePixelRatio || 1); if (lowQualityMode) return 1; if (interactionState.isMovingSelected || interactionState.isResizingSelected) return 1; return natural; }

export function computeGeometry(width: number, height: number, cols: number, rws: number) {
  const columnWidth = width / cols; const rowHeight = height / rws;
  const verticals: number[] = []; const horizontals: number[] = [];
  for (let i = 1; i < cols; i += 1) verticals.push(i * columnWidth);
  for (let j = 1; j < rws; j += 1) horizontals.push(j * rowHeight);
  return { width, height, cols, rows: rws, colWidth: columnWidth, rowHeight, verticals, horizontals };
}

function updateGridCache(geom: any) {
  const { width, height, cols, rows: rws, verticals, horizontals } = geom;
  const signature = `${Math.round(width)}x${Math.round(height)}-${cols}x${rws}`;
  if (signature === lastCacheSignature && gridCacheCanvas) return;
  lastCacheSignature = signature;
  if (!gridCacheCanvas) { gridCacheCanvas = document.createElement('canvas'); gridCacheCtx = gridCacheCanvas.getContext('2d', { alpha: true }); }
  gridCacheCanvas.width = Math.max(1, Math.round(width));
  gridCacheCanvas.height = Math.max(1, Math.round(height));
  const ctx = gridCacheCtx!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  for (let i = 0; i < verticals.length; i += 1) { const x = verticals[i]; ctx.moveTo(x, 0); ctx.lineTo(x, height); }
  for (let j = 0; j < horizontals.length; j += 1) { const y = horizontals[j]; ctx.moveTo(0, y); ctx.lineTo(width, y); }
  ctx.stroke();
  if ((window as any).createImageBitmap) {
    if (gridCacheBitmap && (gridCacheBitmap as any).close) { try { (gridCacheBitmap as any).close(); } catch {} gridCacheBitmap = null; }
    createImageBitmap(gridCacheCanvas).then((bmp) => { gridCacheBitmap = bmp; scheduleRedraw(); }).catch(() => { gridCacheBitmap = null; });
  }
}

export function resizeCanvasAndDraw() {
  const dpr = getTargetDpr();
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = !lowQualityMode;
  context.imageSmoothingQuality = lowQualityMode ? 'low' : 'high';
  const candidateColumns = getResponsiveColumns(cssWidth);
  const maxByHeight = Math.max(1, Math.floor(cssHeight / 130));
  const finalColumns = Math.min(candidateColumns, maxByHeight);
  const finalRows = getResponsiveRows(cssWidth, cssHeight, finalColumns);
  lastGeometry = computeGeometry(cssWidth, cssHeight, finalColumns, finalRows);
  updateGridCache(lastGeometry);
  backgroundCacheDirty = true;
  draw(currentCtx());
}

export function scheduleRedraw() {
  if (redrawScheduled) return;
  redrawScheduled = true;
  requestAnimationFrame(() => { redrawScheduled = false; draw(currentCtx()); });
}

function currentCtx() { return canvas.getContext('2d'); }

function getMouseCanvasXY(e: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) };
}

function parseFontPx(fontString: string) { if (!fontString) return null; const m = String(fontString).match(/(\d+(?:\.\d+)?)px/); return m ? parseFloat(m[1]) : null; }
function setFontPx(fontString: string | null | undefined, newPx: number) {
  const base = String(fontString || 'bold 48px Arial');
  if (/(\d+(?:\.\d+)?)px/.test(base)) return base.replace(/(\d+(?:\.\d+)?)px/, `${Math.max(1, Math.round(newPx))}px`);
  return `${Math.max(1, Math.round(newPx))}px ${base}`;
}

function measureWrappedText(ctx: CanvasRenderingContext2D, text: string, maxWidth?: number) {
  const { width: cw } = getCanvasDimensions();
  const limit = Math.max(120, Math.min(maxWidth || cw - 16, cw - 16));
  const words = String(text || '').split(/\s+/);
  const lineHeight = Math.round((parseFontPx(ctx.font) || 16) * 1.2);
  let line = '';
  let maxLineWidth = 0;
  let totalHeight = 0;
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const test = line ? line + ' ' + words[i] : words[i];
    const w = ctx.measureText(test).width;
    if (w > limit && line) {
      lines.push(line);
      maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);
      totalHeight += lineHeight;
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) {
    lines.push(line);
    maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);
    totalHeight += lineHeight;
  }
  return { width: Math.round(maxLineWidth), height: Math.round(totalHeight), lineHeight, lines, limit };
}

function drawBackgroundInto(ctx: CanvasRenderingContext2D, geom: any) {
  if (!backgroundLayer || !geom) return;
  const { width: cw, height: ch } = geom;
  if (backgroundLayer.type === 'image') {
    const img = backgroundLayer.element || backgroundLayer.bitmap; if (!img) return;
    const iw = img.width || img.videoWidth || (img.naturalWidth || 0);
    const ih = img.height || img.videoHeight || (img.naturalHeight || 0);
    if (!iw || !ih) return;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = Math.round(iw * scale); const dh = Math.round(ih * scale);
    const dx = Math.round((cw - dw) / 2); const dy = Math.round((ch - dh) / 2);
    try { ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low'; ctx.drawImage(img, dx, dy, dw, dh); ctx.restore(); } catch {}
  } else if (backgroundLayer.type === 'video') {
    const v = backgroundLayer.element; if (!v || !backgroundLayer.ready) return;
    const iw = v.videoWidth; const ih = v.videoHeight; if (!iw || !ih) return;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = Math.round(iw * scale); const dh = Math.round(ih * scale);
    const dx = Math.round((cw - dw) / 2); const dy = Math.round((ch - dh) / 2);
    try {
      ctx.save();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(v, dx, dy, dw, dh);
      // Draw play/pause overlay centered on the drawn video area
      const cx = Math.round(dx + dw / 2);
      const cy = Math.round(dy + dh / 2);
      const isPlaying = !v.paused && !v.ended;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(17,24,39,0.65)';
      ctx.beginPath();
      ctx.arc(cx, cy, VIDEO_ICON_RADIUS + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'white';
      if (isPlaying) {
        const bw = Math.max(4, Math.floor(VIDEO_ICON_RADIUS * 0.35));
        const bh = Math.max(10, Math.floor(VIDEO_ICON_RADIUS * 0.95));
        const gap = Math.max(4, Math.floor(VIDEO_ICON_RADIUS * 0.30));
        ctx.fillRect(cx - gap - bw, cy - Math.floor(bh / 2), bw, bh);
        ctx.fillRect(cx + gap, cy - Math.floor(bh / 2), bw, bh);
      } else {
        ctx.beginPath();
        const r = Math.max(10, Math.floor(VIDEO_ICON_RADIUS * 0.85));
        ctx.moveTo(cx - Math.floor(r * 0.45), cy - r);
        ctx.lineTo(cx + Math.floor(r * 0.95), cy);
        ctx.lineTo(cx - Math.floor(r * 0.45), cy + r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } catch {}
  } else if (backgroundLayer.type === 'text') {
    ctx.save(); ctx.fillStyle = backgroundLayer.color || '#111827'; ctx.font = backgroundLayer.font || 'bold 48px Arial'; const topMargin = 24; drawWrappedText(ctx, backgroundLayer.text || '', 16, topMargin, cw - 32); ctx.restore();
  }
}

function updateBackgroundCache(ctx: CanvasRenderingContext2D, geom: any) {
  if (!backgroundLayer || !geom) { backgroundCacheBitmap = null; return; }
  if (!backgroundCacheCanvas) { backgroundCacheCanvas = document.createElement('canvas'); backgroundCacheCtx = backgroundCacheCanvas.getContext('2d'); }
  backgroundCacheCanvas.width = Math.max(1, Math.round(geom.width));
  backgroundCacheCanvas.height = Math.max(1, Math.round(geom.height));
  const bctx = backgroundCacheCtx!;
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, backgroundCacheCanvas.width, backgroundCacheCanvas.height);
  drawBackgroundInto(bctx as any, geom);
  if ((window as any).createImageBitmap && backgroundLayer.type !== 'video') {
    if (backgroundCacheBitmap && (backgroundCacheBitmap as any).close) { try { (backgroundCacheBitmap as any).close(); } catch {} }
    createImageBitmap(backgroundCacheCanvas).then((bmp) => { backgroundCacheBitmap = bmp; scheduleRedraw(); }).catch(() => { backgroundCacheBitmap = null; });
  } else { backgroundCacheBitmap = null; }
  backgroundCacheDirty = false;
}

export function draw(ctx: CanvasRenderingContext2D) {
  if (!lastGeometry) return;
  const { width, height } = lastGeometry;
  ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.fillStyle = CANVAS_BG_COLOR; ctx.fillRect(0, 0, width, height); ctx.restore();
  if (backgroundLayer) {
    if (backgroundLayer.type === 'video') { drawBackgroundInto(ctx, lastGeometry); }
    else { if (backgroundCacheDirty) updateBackgroundCache(ctx, lastGeometry); if (backgroundCacheBitmap) ctx.drawImage(backgroundCacheBitmap, 0, 0, width, height); else if (backgroundCacheCanvas) ctx.drawImage(backgroundCacheCanvas, 0, 0, width, height); else drawBackgroundInto(ctx, lastGeometry); }
  }
  if (gridEnabled) {
    if (gridCacheBitmap) ctx.drawImage(gridCacheBitmap, 0, 0, width, height);
    else if (gridCacheCanvas) ctx.drawImage(gridCacheCanvas, 0, 0, width, height);
  }
  renderAssets(ctx);
  drawHoverAndSelection(ctx);
  drawMarquee(ctx);
  ctx.strokeStyle = OUTLINE_STROKE; ctx.lineWidth = 1.25; ctx.strokeRect(0, 0, width, height);
}

function renderAssets(ctx: CanvasRenderingContext2D) {
  for (let i = 0; i < assets.length; i += 1) {
    const item = assets[i];
    if (item.type === 'image' && item.loaded) {
      try { if (item.bitmap) ctx.drawImage(item.bitmap, item.x, item.y, item.width, item.height); else if (item.element) ctx.drawImage(item.element, item.x, item.y, item.width, item.height); } catch {}
    } else if (item.type === 'video' && item.element && item.ready) {
      try {
        ensureVideoFrameCallback(item.element);
        const surf = getVideoSurface(item.element, item.width, item.height);
        // Draw video frame into offscreen surface at target size once
        surf.ctx.imageSmoothingEnabled = true; surf.ctx.imageSmoothingQuality = 'low';
        surf.ctx.clearRect(0, 0, surf.canvas.width, surf.canvas.height);
        surf.ctx.drawImage(item.element, 0, 0, surf.canvas.width, surf.canvas.height);
        ctx.drawImage(surf.canvas as any, item.x, item.y, item.width, item.height);
      } catch {}
      // Draw per-video overlay play/pause control
      const cx = Math.round(item.x + item.width / 2);
      const cy = Math.round(item.y + item.height / 2);
      const isPlaying = !item.element.paused && !item.element.ended;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(17,24,39,0.65)';
      ctx.beginPath();
      ctx.arc(cx, cy, VIDEO_ICON_RADIUS + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'white';
      if (isPlaying) {
        const bw = Math.max(4, Math.floor(VIDEO_ICON_RADIUS * 0.35));
        const gap = Math.max(4, Math.floor(VIDEO_ICON_RADIUS * 0.25));
        const bh = Math.floor(VIDEO_ICON_RADIUS * 1.2);
        ctx.fillRect(cx - gap - bw, cy - Math.floor(bh / 2), bw, bh);
        ctx.fillRect(cx + gap, cy - Math.floor(bh / 2), bw, bh);
      } else {
        const triR = Math.floor(VIDEO_ICON_RADIUS * 1.2);
        ctx.beginPath();
        ctx.moveTo(cx - Math.floor(triR * 0.45), cy - Math.floor(triR * 0.65));
        ctx.lineTo(cx - Math.floor(triR * 0.45), cy + Math.floor(triR * 0.65));
        ctx.lineTo(cx + Math.floor(triR * 0.85), cy);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (item.type === 'text') {
      ctx.save();
      ctx.fillStyle = item.color || '#ffffff';
      ctx.font = item.font || '16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
      const align = item.textAlign || 'left';
      ctx.textAlign = align as CanvasTextAlign;
      ctx.textBaseline = 'top';
      drawWrappedText(ctx, item.text || '', item.x, item.y, item.maxWidth, align);
      ctx.restore();
    }
  }
  if (isCanvasVisible) {
    // Keep rAF loop alive when any video is playing (as a fallback to rVFC)
    if (anyVideoPlaying()) requestAnimationFrame(() => draw(currentCtx()));
  }
}

function drawMarquee(ctx: CanvasRenderingContext2D) {
  if (!interactionState.isMarqueeSelecting) return;
  const x1 = interactionState.marqueeStartCX; const y1 = interactionState.marqueeStartCY; const x2 = interactionState.marqueeEndCX; const y2 = interactionState.marqueeEndCY;
  const x = Math.min(x1, x2); const y = Math.min(y1, y2); const w = Math.abs(x2 - x1); const h = Math.abs(y2 - y1);
  ctx.save(); ctx.fillStyle = 'rgba(99, 102, 241, 0.15)'; ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.restore();
}

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number, align: 'left' | 'center' | 'right' = 'left') {
  const { width: cw } = getCanvasDimensions();
  const limit = Math.max(120, Math.min(maxWidth || cw - 16, cw - 16));
  const words = String(text || '').split(/\s+/);
  const lineHeight = Math.round((parseFontPx(ctx.font) || 16) * 1.2);
  let line = ''; let cursorY = y;
  const drawLine = (s: string, yy: number) => {
    if (align === 'center') {
      // For centered text, x is the center point; drawText with textAlign=center does the rest
      ctx.fillText(s, x, yy);
    } else {
      ctx.fillText(s, x, yy);
    }
  };
  for (let i = 0; i < words.length; i += 1) { const test = line ? line + ' ' + words[i] : words[i]; const w = ctx.measureText(test).width; if (w > limit && line) { drawLine(line, cursorY); line = words[i]; cursorY += lineHeight; } else { line = test; } }
  if (line) drawLine(line, cursorY);
}

function getAssetBounds(ctx: CanvasRenderingContext2D, item: any) {
  if (item.type === 'image' || item.type === 'video') {
    return { x: item.x, y: item.y, w: item.width, h: item.height };
  }
  if (item.type === 'text') {
    // Measure with item font and use top-baseline box starting at y
    const prevFont = ctx.font;
    if (item.font) ctx.font = item.font;
    const m = measureWrappedText(ctx, item.text || '', item.maxWidth);
    ctx.font = prevFont;
    const align = item.textAlign || 'left';
    const w = m.width;
    const h = m.height;
    if (align === 'center') {
      return { x: Math.round(item.x - w / 2), y: item.y, w: w, h: h };
    }
    return { x: item.x, y: item.y, w: w, h: h };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function drawHoverAndSelection(ctx: CanvasRenderingContext2D) {
  // Hover highlight (dotted, dark indigo)
  if (!interactionState.isMarqueeSelecting && interactionState.hoveredAssetIndex >= 0 && !interactionState.selectedAssetIndices.has(interactionState.hoveredAssetIndex)) {
    const b = getAssetBounds(ctx, assets[interactionState.hoveredAssetIndex]);
    ctx.save();
    ctx.setLineDash([4, 10]);
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = 'rgba(67,56,202,0.95)'; // indigo-700
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  // Selected highlights (solid indigo)
  if (interactionState.selectedAssetIndices.size > 0) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 2.0;
    ctx.strokeStyle = 'rgba(79,70,229,0.95)'; // indigo-600
    if (interactionState.selectedAssetIndices.size === 1) {
      // Single selection: decorate the asset bounds and show handles
      const idx = Array.from(interactionState.selectedAssetIndices)[0];
      const sel = assets[idx];
      const b = getAssetBounds(ctx, sel);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      const hs = getHandleRects(b);
      ctx.fillStyle = 'rgba(79,70,229,0.95)';
      const r = Math.floor(HANDLE_SIZE / 2);
      const circle = (cx: number, cy: number) => {
        // white stroke for contrast
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = 'white'; ctx.stroke(); ctx.restore();
        ctx.fill();
      };
      const roundedRect = (x: number, y: number, w: number, h: number, radius: number) => {
        const rr = Math.min(radius, Math.min(w, h) / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
        ctx.fill();
      };
      // Corner circles
      circle(hs.tl.x + r, hs.tl.y + r);
      circle(hs.tr.x + r, hs.tr.y + r);
      circle(hs.bl.x + r, hs.bl.y + r);
      circle(hs.br.x + r, hs.br.y + r);
      if (sel.type === 'text') {
        // Vertical rounded rectangles for left/right
        const pillRadius = Math.floor(Math.min(hs.ml.w, hs.ml.h) / 2);
        // Left pill
        ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = 'white';
        roundedRect(hs.ml.x, hs.ml.y, hs.ml.w, hs.ml.h, pillRadius);
        ctx.stroke(); ctx.restore();
        // Right pill
        ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = 'white';
        roundedRect(hs.mr.x, hs.mr.y, hs.mr.w, hs.mr.h, pillRadius);
        ctx.stroke(); ctx.restore();
      }
    } else {
      // Multi-selection: draw a single combined bounding box without handles
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const idx of interactionState.selectedAssetIndices) {
        const b = getAssetBounds(ctx, assets[idx]);
        if (!b || b.w <= 0 || b.h <= 0) continue;
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      }
    }
    ctx.restore();
  }
}

function getHandleRects(b: { x: number; y: number; w: number; h: number }) {
  const s = HANDLE_SIZE;
  const r = Math.floor(s / 2);
  const centerY = b.y + Math.round(b.h / 2);
  return {
    // Center circles exactly on the asset corners
    tl: { x: b.x - r, y: b.y - r, w: s, h: s },
    tr: { x: b.x + b.w - r, y: b.y - r, w: s, h: s },
    bl: { x: b.x - r, y: b.y + b.h - r, w: s, h: s },
    br: { x: b.x + b.w - r, y: b.y + b.h - r, w: s, h: s },
    // Side handles centered on midpoints
    ml: { x: b.x - r, y: centerY - s, w: s, h: s * 2 },
    mr: { x: b.x + b.w - r, y: centerY - s, w: s, h: s * 2 },
  } as const;
}

function cursorForHandle(id: string): string {
  switch (id) {
    case 'tl':
    case 'br':
      return 'nwse-resize';
    case 'tr':
    case 'bl':
      return 'nesw-resize';
    case 'ml':
    case 'mr':
      return 'ew-resize';
    default:
      return 'default';
  }
}

