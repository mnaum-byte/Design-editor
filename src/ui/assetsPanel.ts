/* eslint-disable */
// @ts-nocheck
import { loadImageFromUrl, createVideoFromUrl, bindSidebarDragSources, bindCanvasDropTarget } from '@/services';
import { log } from '@/debug/logger';
import { addAsset } from '@/state/store';
import { TEXT_DEFAULT_COLOR, TEXT_DEFAULT_FONT } from '@/constants';
import { scheduleRedraw } from '@/canvas/renderer';
import { scaleToCanvas } from '@/services/layout';

export function bindAssetsPanel(root: HTMLElement | null, canvas: HTMLCanvasElement) {
  if (!root) { log('bindAssetsPanel: no sidebar root'); return; }

  // Drag sources in the sidebar content grid
  // Enable drag-drop only if there are draggable elements and stage exists
  bindSidebarDragSources(root, canvas);
  bindCanvasDropTarget(canvas);
  // Ensure img/video elements have draggable=true for native preview
  root.querySelectorAll('img,video')?.forEach((n: any) => { n.setAttribute('draggable', 'true'); });

  // Click-to-add from sidebar tiles (mobile-friendly)
  root.addEventListener('click', async (e: MouseEvent) => {
    const target = (e.target as HTMLElement) || null;
    const tile = target && (target.closest('[data-asset-type]') as HTMLElement | null);
    if (!tile) return;
    const type = tile.getAttribute('data-asset-type');
    const rect = canvas.getBoundingClientRect();
    const centerX = Math.round(rect.width / 2);
    const centerY = Math.round(rect.height / 2);
    try {
      if (type === 'image') {
        const imgEl = (tile.tagName === 'IMG' ? tile : tile.querySelector('img')) as HTMLImageElement | null;
        const url = (imgEl && (imgEl.currentSrc || imgEl.src)) || '';
        if (!url) return;
        const img = await loadImageFromUrl(url);
        const fit = scaleToCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height, canvas, 0.35);
        img.width = fit.width; img.height = fit.height;
        img.x = centerX - Math.floor(img.width / 2);
        img.y = centerY - Math.floor(img.height / 2);
        addAsset(img);
        scheduleRedraw();
        log('click-add image', { url });
      } else if (type === 'video') {
        const url = tile.getAttribute('data-src') || (tile.querySelector('video') as HTMLVideoElement | null)?.src || '';
        if (!url) return;
        const vid = createVideoFromUrl(url);
        const place = () => {
          const vw = (vid.element as HTMLVideoElement).videoWidth || vid.width;
          const vh = (vid.element as HTMLVideoElement).videoHeight || vid.height;
          const fit = scaleToCanvas(vw, vh, canvas, 0.35);
          vid.width = fit.width; vid.height = fit.height;
          vid.x = centerX - Math.floor(vid.width / 2);
          vid.y = centerY - Math.floor(vid.height / 2);
          scheduleRedraw();
        };
        (vid.element as HTMLVideoElement).addEventListener('loadedmetadata', place, { once: true });
        addAsset(vid);
        scheduleRedraw();
        log('click-add video', { url });
      } else if (type === 'text') {
        const text = (tile.textContent || '').trim();
        if (!text) return;
        const maxWidth = Math.max(240, Math.floor(rect.width * 0.6));
        const x = Math.round(rect.width / 2);
        const y = Math.max(48, Math.round(rect.height * 0.2));
        addAsset({ type: 'text', x, y, text, color: TEXT_DEFAULT_COLOR, font: TEXT_DEFAULT_FONT, maxWidth, textAlign: 'center' } as any);
        scheduleRedraw();
        log('click-add text');
      }
    } catch (err) {
      log('click-add failed', String(err));
    }
  });

  const uploadBtn = document.getElementById('upload-asset') as HTMLButtonElement | null;
  const uploadInput = document.getElementById('upload-asset-input') as HTMLInputElement | null;
  if (uploadBtn && uploadInput) {
    log('assetsPanel: upload bindings ready');
    uploadBtn.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', async () => {
      const files = Array.from(uploadInput.files || []);
      log('upload: files selected', files.map(f => ({ name: f.name, type: f.type, size: f.size })));
      for (const file of files) {
        try {
          const blobUrl = URL.createObjectURL(file);
          if (file.type.startsWith('image/')) {
            const img = await loadImageFromUrl(blobUrl);
            img.x = 24; img.y = 24;
            addAsset(img);
            log('added image asset', { w: img.width, h: img.height });
          } else if (file.type.startsWith('video/')) {
            const vid = createVideoFromUrl(blobUrl);
            vid.x = 24; vid.y = 24;
            addAsset(vid);
            log('added video asset', { w: vid.width, h: vid.height });
          }
        } catch {}
      }
      scheduleRedraw();
      uploadInput.value = '';
    });
  }

  const textInput = document.getElementById('inline-add-text-input') as HTMLInputElement | null;
  const textBtn = document.getElementById('inline-add-text-btn') as HTMLButtonElement | null;
  if (textInput && textBtn) {
    const refresh = () => { textBtn.disabled = !(textInput.value && textInput.value.trim().length > 0); };
    textInput.addEventListener('input', refresh);
    // Allow Enter to confirm add (without Shift for newline)
    textInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!textBtn.disabled) textBtn.click();
      }
    });
    refresh();
    textBtn.addEventListener('click', () => {
      const value = (textInput.value || '').trim();
      if (!value) return;
      const rect = canvas.getBoundingClientRect();
      const centerX = Math.round(rect.width / 2);
      const centerY = Math.round(rect.height / 2);
      const maxWidth = Math.max(240, Math.floor(rect.width * 0.6));
      const x = centerX;
      const y = Math.max(48, Math.round(rect.height * 0.2));
      addAsset({ type: 'text', x, y, text: value, color: TEXT_DEFAULT_COLOR, font: TEXT_DEFAULT_FONT, maxWidth, textAlign: 'center' } as any);
      log('added text asset', value);
      textInput.value = '';
      refresh();
      scheduleRedraw();
    });
  }
}


