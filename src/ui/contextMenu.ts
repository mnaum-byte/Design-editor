/* eslint-disable */
// @ts-nocheck
import { interactionState, assets, backgroundLayer, setBackgroundLayer, deleteSelectedAssets, duplicateSelected, bringSelectedToFront, bringSelectedForward, sendSelectedBackward, sendSelectedToBack, setSelectedAsBackground } from '@/state/store';
import { scheduleRedraw } from '@/canvas/renderer';
import { pushHistory } from '@/state/history';

export function bindContextMenu() {
  const menu = document.getElementById('context-menu') as HTMLDivElement | null;
  const btnDelete = document.getElementById('ctx-delete') as HTMLButtonElement | null;
  const btnDuplicate = document.getElementById('ctx-duplicate') as HTMLButtonElement | null;
  const btnCut = document.getElementById('ctx-cut') as HTMLButtonElement | null;
  const btnPaste = document.getElementById('ctx-paste') as HTMLButtonElement | null;
  const btnBringFront = document.getElementById('ctx-bring-front') as HTMLButtonElement | null;
  const btnBringForward = document.getElementById('ctx-bring-forward') as HTMLButtonElement | null;
  const btnSendBackward = document.getElementById('ctx-send-backward') as HTMLButtonElement | null;
  const btnSendBack = document.getElementById('ctx-send-back') as HTMLButtonElement | null;
  const btnSetBg = document.getElementById('ctx-set-bg') as HTMLButtonElement | null;
  const btnBgDetach = document.getElementById('ctx-bgd-detach') as HTMLButtonElement | null;
  const btnBgDelete = document.getElementById('ctx-bgd-delete') as HTMLButtonElement | null;
  if (!menu) return;

  const hide = () => { menu.setAttribute('aria-hidden', 'true'); menu.classList.remove('show'); };

  function setEnabled(el: HTMLButtonElement | null, enabled: boolean) {
    if (!el) return;
    el.classList.toggle('disabled', !enabled);
    el.setAttribute('aria-disabled', String(!enabled));
  }

  function refreshStates() {
    const anySelected = interactionState.selectedAssetIndices.size > 0;
    const hasBackground = !!backgroundLayer;
    const isBackgroundMode = hasBackground && !anySelected && interactionState.hoveredAssetIndex === -1;
    const isEmptyArea = !anySelected && interactionState.hoveredAssetIndex === -1; // click not on an asset

    // Toggle visibility of groups based on mode
    const assetButtons: (HTMLButtonElement | null)[] = [btnSetBg, btnDuplicate, btnDelete, btnBringFront, btnBringForward, btnSendBack, btnSendBackward, btnCut];
    const bgButtons: (HTMLButtonElement | null)[] = [btnBgDetach, btnBgDelete];
    // Default visibility for asset vs background modes
    for (const b of assetButtons) if (b) (b as any).style.display = isBackgroundMode ? 'none' : '';
    for (const b of bgButtons) if (b) (b as any).style.display = isBackgroundMode ? '' : 'none';

    // Empty-area mode: show only Paste
    if (isEmptyArea) {
      for (const b of assetButtons) if (b) (b as any).style.display = 'none';
      for (const b of bgButtons) if (b) (b as any).style.display = 'none';
    }

    // Asset mode enable/disable
    let canSetBg = false;
    if (anySelected && interactionState.selectedAssetIndices.size === 1) {
      const only = Array.from(interactionState.selectedAssetIndices)[0];
      const sel = assets[only];
      canSetBg = !!sel && sel.type !== 'text';
    }
    // Hide the Set as background option for text assets
    if (btnSetBg) (btnSetBg as any).style.display = isBackgroundMode ? 'none' : (canSetBg ? '' : 'none');
    setEnabled(btnSetBg, canSetBg);
    setEnabled(btnDuplicate, anySelected);
    setEnabled(btnCut, anySelected);
    const hasClipboard = Array.isArray((window as any).__clipboard) && (window as any).__clipboard.length > 0;
    // Paste is available in all modes; disable if empty
    if (btnPaste) (btnPaste as any).style.display = isEmptyArea ? '' : '';
    setEnabled(btnPaste, hasClipboard);
    setEnabled(btnDelete, anySelected);
    setEnabled(btnBringFront, anySelected);
    setEnabled(btnBringForward, anySelected);
    setEnabled(btnSendBack, anySelected);
    setEnabled(btnSendBackward, anySelected);

    if (!anySelected) return;
    const sel = Array.from(interactionState.selectedAssetIndices).sort((a, b) => a - b);
    const minIndex = sel[0] ?? 0;
    const maxIndex = sel[sel.length - 1] ?? 0;
    const last = assets.length ? assets.length - 1 : undefined;
    setEnabled(btnBringForward, last !== undefined ? maxIndex < last : true);
    setEnabled(btnBringFront, last !== undefined ? maxIndex < last : true);
    setEnabled(btnSendBackward, minIndex > 0);
    setEnabled(btnSendBack, minIndex > 0);
  }

  const showAt = (x: number, y: number) => {
    refreshStates();
    // Clamp to viewport
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = menu.getBoundingClientRect();
    const clampedLeft = Math.max(8, Math.min(vw - rect.width - 8, x));
    const clampedTop = Math.max(8, Math.min(vh - rect.height - 8, y));
    menu.style.left = `${clampedLeft}px`;
    menu.style.top = `${clampedTop}px`;
    menu.style.bottom = 'auto';
    menu.style.transform = 'none';
    menu.classList.add('show');
    menu.setAttribute('aria-hidden', 'false');
  };

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showAt(e.clientX, e.clientY);
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target as Node)) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

  btnDelete?.addEventListener('click', () => {
    hide();
    if (interactionState.selectedAssetIndices.size === 0) return;
    pushHistory();
    const removed = deleteSelectedAssets();
    if (removed) scheduleRedraw();
  });

  btnDuplicate?.addEventListener('click', () => { hide(); if (interactionState.selectedAssetIndices.size === 0) return; pushHistory(); duplicateSelected(); scheduleRedraw(); });
  btnCut?.addEventListener('click', () => {
    hide();
    if (interactionState.selectedAssetIndices.size === 0) return;
    pushHistory();
    // Copy to a simple in-memory clipboard
    const indices = Array.from(interactionState.selectedAssetIndices).sort((a, b) => a - b);
    (window as any).__clipboard = indices.map((idx) => assets[idx] && { ...assets[idx] });
    // Delete originals
    const removed = deleteSelectedAssets();
    if (removed) scheduleRedraw();
  });
  btnPaste?.addEventListener('click', () => {
    hide();
    const clip = (window as any).__clipboard as any[];
    if (!Array.isArray(clip) || clip.length === 0) return;
    const startIndex = assets.length;
    for (const a of clip) {
      if (!a) continue;
      const copy: any = { ...a };
      // Offset pasted assets slightly so they are visible
      if (typeof copy.x === 'number') copy.x += 12;
      if (typeof copy.y === 'number') copy.y += 12;
      // Rehydrate lightweight objects
      if (copy.type === 'image') {
        if (copy.sourceUrl) {
          const img = new Image(); img.crossOrigin = 'anonymous'; (img as any).decoding = 'async'; img.src = copy.sourceUrl; copy.element = img; copy.loaded = true; copy.bitmap = null;
        }
      } else if (copy.type === 'video') {
        const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.playsInline = true; v.muted = true; v.loop = true; v.preload = 'metadata'; if (copy.sourceUrl) v.src = copy.sourceUrl; copy.element = v; copy.ready = false; v.addEventListener('loadeddata', () => { copy.ready = true; try { v.pause(); } catch {} });
      }
      assets.push(copy);
    }
    interactionState.selectedAssetIndices.clear();
    for (let i = startIndex; i < assets.length; i += 1) interactionState.selectedAssetIndices.add(i);
    scheduleRedraw();
  });
  if (btnBringFront) btnBringFront.classList.add('group-start');
  btnBringFront?.addEventListener('click', () => { hide(); if (interactionState.selectedAssetIndices.size === 0) return; pushHistory(); bringSelectedToFront(); scheduleRedraw(); });
  btnBringForward?.addEventListener('click', () => { hide(); if (interactionState.selectedAssetIndices.size === 0) return; pushHistory(); bringSelectedForward(); scheduleRedraw(); });
  btnSendBackward?.addEventListener('click', () => { hide(); if (interactionState.selectedAssetIndices.size === 0) return; pushHistory(); sendSelectedBackward(); scheduleRedraw(); });
  btnSendBack?.addEventListener('click', () => { hide(); if (interactionState.selectedAssetIndices.size === 0) return; pushHistory(); sendSelectedToBack(); scheduleRedraw(); });

  // Background-only actions
  btnBgDelete?.addEventListener('click', () => {
    hide();
    if (!backgroundLayer) return;
    pushHistory();
    setBackgroundLayer(null);
    scheduleRedraw();
  });
  btnBgDetach?.addEventListener('click', () => {
    hide();
    if (!backgroundLayer) return;
    pushHistory();
    const canvas = document.getElementById('main-canvas') as HTMLCanvasElement | null;
    const rect = canvas?.getBoundingClientRect?.();
    const cx = rect ? Math.round(rect.width / 2) : 400;
    const cy = rect ? Math.round(rect.height / 2) : 300;
    if (backgroundLayer.type === 'image') {
      const img = backgroundLayer.element || (backgroundLayer as any).bitmap || null;
      const w = (img as any)?.naturalWidth || (img as any)?.width || 400;
      const h = (img as any)?.naturalHeight || (img as any)?.height || 300;
      const a: any = { type: 'image', x: cx - Math.round(w / 2), y: cy - Math.round(h / 2), width: w, height: h, element: backgroundLayer.element || null, bitmap: (backgroundLayer as any).bitmap || null, loaded: true, sourceUrl: '' };
      assets.push(a);
    } else if (backgroundLayer.type === 'video') {
      const v = backgroundLayer.element; if (!v) { setBackgroundLayer(null); scheduleRedraw(); return; }
      const w = v.videoWidth || 480; const h = v.videoHeight || 270;
      const a: any = { type: 'video', x: cx - Math.round(w / 2), y: cy - Math.round(h / 2), width: w, height: h, element: v, ready: true, sourceUrl: v.currentSrc || '' };
      assets.push(a);
    } else if (backgroundLayer.type === 'text') {
      const a: any = { type: 'text', x: cx - 120, y: cy, text: backgroundLayer.text || '', color: (backgroundLayer as any).color, font: (backgroundLayer as any).font, maxWidth: rect ? Math.floor(rect.width * 0.6) : 480 };
      assets.push(a);
    }
    setBackgroundLayer(null);
    scheduleRedraw();
  });
  btnSetBg?.addEventListener('click', () => { hide(); if (interactionState.selectedAssetIndices.size === 0) return; pushHistory(); if (setSelectedAsBackground()) scheduleRedraw(); });
}


