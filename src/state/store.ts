import { Asset, BackgroundLayer, InteractionState } from '@/types';
import { scheduleRedraw } from '@/canvas/renderer';

export const assets: Asset[] = [];
export let backgroundLayer: BackgroundLayer = null;
export function setBackgroundLayer(layer: BackgroundLayer) { backgroundLayer = layer; try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {} }
export const interactionState: InteractionState = {
  hoveredAssetIndex: -1,
  selectedAssetIndices: new Set<number>(),
  isMovingSelected: false,
  lastMoveClientX: 0,
  lastMoveClientY: 0,
  isMarqueeSelecting: false,
  marqueePending: false,
  marqueePendingAdditive: false,
  marqueePendingStartCX: 0,
  marqueePendingStartCY: 0,
  marqueeStartCX: 0,
  marqueeStartCY: 0,
  marqueeEndCX: 0,
  marqueeEndCY: 0,
  marqueeAdditive: false,
  hoveredHandle: null,
  isResizingSelected: false,
  activeHandle: null,
  resizeStartClientX: 0,
  resizeStartClientY: 0,
  initialSelectionBounds: null,
  initialSelectedSnapshot: null,
  historyPushedInGesture: false,
  hoveringBackground: false,
};

export function addAsset(asset: Asset) {
  assets.push(asset);
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
}

export function addAssets(newAssets: Asset[]) {
  for (const a of newAssets) assets.push(a);
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
}

export function setBackground(layer: BackgroundLayer) {
  // eslint-disable-next-line no-param-reassign
  backgroundLayer = layer;
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
}
// History lives in `src/state/history.ts`.

export function deleteSelectedAssets(): number {
  const indices = Array.from(interactionState.selectedAssetIndices).sort((a, b) => b - a);
  let removed = 0;
  for (const idx of indices) {
    if (idx >= 0 && idx < assets.length) {
      const a = assets[idx];
      // Best-effort resource cleanup to reduce memory
      try {
        if (a?.type === 'image') {
          // Do NOT mutate or revoke shared resources; other assets may reuse them via cache.
          // Allow GC + cache eviction to free memory later.
        } else if (a?.type === 'video') {
          const v = (a as any).element as HTMLVideoElement | null;
          try { if (v) { try { v.pause(); } catch {}; /* keep src untouched */ } } catch {}
        }
      } catch {}
      assets.splice(idx, 1); removed += 1;
    }
  }
  interactionState.selectedAssetIndices.clear();
  interactionState.hoveredAssetIndex = -1;
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
  return removed;
}

// Helpers for context menu actions
export function duplicateSelected(): number {
  const selected = Array.from(interactionState.selectedAssetIndices).sort((a, b) => a - b);
  const newIndices: number[] = [];
  let insertedSoFar = 0;
  for (const idx of selected) {
    const a = assets[idx];
    if (!a) continue;
    const insertAt = idx + 1 + insertedSoFar;
    if (a.type === 'image') {
      const url = (a as any).sourceUrl || ((a as any).element?.currentSrc) || ((a as any).element?.src) || '';
      const img = new Image();
      img.crossOrigin = 'anonymous';
      (img as any).decoding = 'async';
      if (url) img.src = url;
      const copy: any = { type: 'image', x: a.x + 12, y: a.y + 12, width: a.width, height: a.height, element: img, bitmap: null, loaded: false, sourceUrl: url };
      img.addEventListener('load', () => { copy.loaded = true; try { scheduleRedraw(); } catch {} });
      assets.splice(insertAt, 0, copy as Asset);
    } else if (a.type === 'video') {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous'; v.playsInline = true; v.muted = true; v.loop = true; v.preload = 'metadata';
      if ((a as any).sourceUrl) v.src = (a as any).sourceUrl;
      const copy: any = { type: 'video', x: a.x + 12, y: a.y + 12, width: a.width, height: a.height, element: v, ready: false, sourceUrl: (a as any).sourceUrl };
      v.addEventListener('loadeddata', () => { copy.ready = true; try { scheduleRedraw(); } catch {} });
      assets.splice(insertAt, 0, copy as Asset);
    } else if (a.type === 'text') {
      const copy: any = { type: 'text', x: a.x + 12, y: a.y + 12, text: (a as any).text, color: (a as any).color, font: (a as any).font, maxWidth: (a as any).maxWidth };
      assets.splice(insertAt, 0, copy as Asset);
    }
    newIndices.push(insertAt);
    insertedSoFar += 1;
  }
  interactionState.selectedAssetIndices.clear();
  for (const ni of newIndices) interactionState.selectedAssetIndices.add(ni);
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
  return newIndices.length;
}

export function bringSelectedToFront() {
  const sel = Array.from(interactionState.selectedAssetIndices).sort((a, b) => a - b);
  const moved: Asset[] = [];
  for (let i = sel.length - 1; i >= 0; i -= 1) {
    const idx = sel[i]!;
    const removed = assets.splice(idx, 1 as number);
    if (removed[0]) moved.unshift(removed[0] as Asset);
  }
  for (const m of moved) assets.push(m);
  // Reselect moved items at new indices
  interactionState.selectedAssetIndices.clear();
  for (let i = assets.length - moved.length; i < assets.length; i += 1) interactionState.selectedAssetIndices.add(i);
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
}

export function bringSelectedForward() {
  const sel = Array.from(interactionState.selectedAssetIndices).sort((a, b) => b - a);
  for (const idx of sel) {
    if (idx < assets.length - 1) {
      const removed = assets.splice(idx!, 1 as number);
      if (removed[0]) {
        assets.splice(idx + 1, 0, removed[0] as Asset);
        interactionState.selectedAssetIndices.delete(idx);
        interactionState.selectedAssetIndices.add(idx + 1);
      }
    }
  }
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
}

export function sendSelectedBackward() {
  const sel = Array.from(interactionState.selectedAssetIndices).sort((a, b) => a - b);
  for (const idx of sel) {
    if (idx > 0) {
      const removed = assets.splice(idx!, 1 as number);
      if (removed[0]) {
        assets.splice(idx - 1, 0, removed[0] as Asset);
        interactionState.selectedAssetIndices.delete(idx);
        interactionState.selectedAssetIndices.add(idx - 1);
      }
    }
  }
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
}

export function sendSelectedToBack() {
  const sel = Array.from(interactionState.selectedAssetIndices).sort((a, b) => a - b);
  const moved: Asset[] = [];
  for (let i = 0; i < sel.length; i += 1) {
    const idx = sel[i]!;
    const removed = assets.splice((idx as number) - i, 1 as number);
    if (removed[0]) moved.push(removed[0] as Asset);
  }
  assets.splice(0, 0, ...moved);
  interactionState.selectedAssetIndices.clear();
  for (let i = 0; i < moved.length; i += 1) interactionState.selectedAssetIndices.add(i);
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
}

export function setSelectedAsBackground() {
  const idx = Array.from(interactionState.selectedAssetIndices)[0];
  if (idx === undefined) return false;
  const a = assets[idx];
  if (!a) return false;
  // If we already have a background, detach it onto the canvas before replacing
  if (backgroundLayer) {
    try {
      const canvas = document.getElementById('main-canvas') as HTMLCanvasElement | null;
      const rect = canvas?.getBoundingClientRect?.();
      const cw = rect ? Math.round(rect.width) : 800;
      const ch = rect ? Math.round(rect.height) : 600;
      const cx = Math.round(cw / 2);
      const cy = Math.round(ch / 2);
      if (backgroundLayer.type === 'image') {
        const img: any = backgroundLayer.element || (backgroundLayer as any).bitmap || null;
        const iw = img?.naturalWidth || img?.width || 400;
        const ih = img?.naturalHeight || img?.height || 300;
        // scale so longest side is <= 40% of canvas shorter side
        const limit = Math.max(40, Math.round(Math.min(cw, ch) * 0.4));
        const longest = Math.max(iw || 1, ih || 1);
        const scale = Math.min(1, limit / longest);
        const placeW = Math.max(40, Math.round((iw || 1) * scale));
        const ratio = ih && iw ? ih / iw : (9 / 16);
        const placeH = Math.max(40, Math.round(placeW * ratio));
        const x = cx - Math.round(placeW / 2);
        const y = cy - Math.round(placeH / 2);
        assets.push({ type: 'image', x, y, width: placeW, height: placeH, element: backgroundLayer.element || null, bitmap: (backgroundLayer as any).bitmap || null, loaded: true, sourceUrl: '' } as any);
      } else if (backgroundLayer.type === 'video') {
        const v = backgroundLayer.element; if (v) {
          const vw = v.videoWidth || 480; const vh = v.videoHeight || 270;
          const placeW = Math.max(60, Math.round(Math.min(cw * 0.6, 520)));
          const ratio = vh && vw ? vh / vw : (9 / 16);
          const placeH = Math.max(60, Math.round(placeW * ratio));
          const x = cx - Math.round(placeW / 2);
          const y = cy - Math.round(placeH / 2);
          try { v.pause(); } catch {}
          assets.push({ type: 'video', x, y, width: placeW, height: placeH, element: v, ready: true, sourceUrl: v.currentSrc || '' } as any);
        }
      } else if (backgroundLayer.type === 'text') {
        const mw = Math.max(120, Math.floor(cw * 0.6));
        assets.push({ type: 'text', x: cx - Math.round(mw / 2), y: Math.round(ch * 0.25), text: (backgroundLayer as any).text || '', color: (backgroundLayer as any).color, font: (backgroundLayer as any).font, maxWidth: mw } as any);
      }
    } catch {}
  }
  if (a.type === 'image') setBackgroundLayer({ type: 'image', element: (a as any).element || null, bitmap: (a as any).bitmap || null });
  else if (a.type === 'video') setBackgroundLayer({ type: 'video', element: (a as any).element || null, ready: (a as any).ready });
  else if (a.type === 'text') setBackgroundLayer({ type: 'text', text: (a as any).text, color: (a as any).color, font: (a as any).font });
  assets.splice(idx, 1);
  interactionState.selectedAssetIndices.clear();
  try { document.dispatchEvent(new CustomEvent('assets:changed')); } catch {}
  return true;
}

