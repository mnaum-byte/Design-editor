/* eslint-disable */
// @ts-nocheck
import { HISTORY_LIMIT } from '@/constants';
import { assets, backgroundLayer, interactionState, setBackgroundLayer } from '@/state/store';
import type { Asset, BackgroundLayer, Snapshot, VideoAsset } from '@/types';

function cloneAssetForHistory(a: Asset) {
  if (!a) return null;
  if (a.type === 'image') return { type: 'image', x: a.x, y: a.y, width: a.width, height: a.height, sourceUrl: a.sourceUrl || '' };
  if (a.type === 'video') return { type: 'video', x: a.x, y: a.y, width: a.width, height: a.height, sourceUrl: a.sourceUrl || '' };
  if (a.type === 'text') return { type: 'text', x: a.x, y: a.y, text: a.text, color: a.color, font: a.font, maxWidth: a.maxWidth };
  return null;
}

function cloneBackgroundForHistory(bg: BackgroundLayer) {
  if (!bg) return null;
  if (bg.type === 'image') return { type: 'image', element: bg.element || null, bitmap: bg.bitmap || null };
  if (bg.type === 'video') return { type: 'video', element: bg.element || null, ready: !!bg.ready };
  if (bg.type === 'text') return { type: 'text', text: bg.text || '', font: bg.font, color: bg.color };
  return null;
}

export function snapshotState(): Snapshot {
  return { assets: assets.map(cloneAssetForHistory), background: cloneBackgroundForHistory(backgroundLayer) } as Snapshot;
}

export function applySnapshot(snap: Snapshot) {
  if (!snap) return;
  assets.splice(0, assets.length);
  // Restore background
  setBackgroundLayer(cloneBackgroundForHistory(snap.background) as BackgroundLayer);
  for (const s of snap.assets) {
    if (s.type === 'image') {
      assets.push({ type: 'image', x: s.x, y: s.y, width: s.width, height: s.height, element: null, bitmap: null, loaded: false, sourceUrl: s.sourceUrl });
    } else if (s.type === 'video') {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.playsInline = true;
      v.muted = true;
      v.loop = true;
      v.preload = 'metadata';
      const a: VideoAsset = { type: 'video', x: s.x, y: s.y, width: s.width, height: s.height, element: v, ready: false, sourceUrl: s.sourceUrl };
      if (s.sourceUrl) v.src = s.sourceUrl;
      v.addEventListener('loadeddata', () => { a.ready = true; });
      assets.push(a);
    } else if (s.type === 'text') {
      assets.push({ type: 'text', x: s.x, y: s.y, text: s.text, color: s.color, font: s.font, maxWidth: s.maxWidth });
    }
  }
  interactionState.selectedAssetIndices.clear();
  interactionState.hoveredAssetIndex = -1;
}

const historyStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];

export function pushHistory() {
  historyStack.push(snapshotState());
  redoStack.length = 0;
  if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
}

export function undo(): boolean {
  if (historyStack.length === 0) return false;
  const current = snapshotState();
  const prev = historyStack.pop()!;
  redoStack.push(current);
  applySnapshot(prev);
  return true;
}

export function redo(): boolean {
  if (redoStack.length === 0) return false;
  const current = snapshotState();
  const next = redoStack.pop()!;
  historyStack.push(current);
  applySnapshot(next);
  return true;
}


