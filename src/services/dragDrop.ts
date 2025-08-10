/* eslint-disable */
// @ts-nocheck
import { loadImageFromUrl, createVideoFromUrl } from '@/services';
import { addAsset } from '@/state/store';
import { scaleToCanvas } from '@/services/layout';
import { scheduleRedraw } from '@/canvas/renderer';
import { log } from '@/debug/logger';

export function bindSidebarDragSources(container: HTMLElement | null, stageCanvas: HTMLCanvasElement) {
  if (!container) return;
  container.querySelectorAll('[data-asset-type]')?.forEach((el: HTMLElement) => {
    const type = el.getAttribute('data-asset-type');
    const addHandlers = (node: HTMLElement) => {
      node.setAttribute('draggable', 'true');
      node.addEventListener('dragstart', (e: DragEvent) => {
        try { e.dataTransfer!.effectAllowed = 'copy'; } catch {}
        log('dragstart from sidebar', { type });
        document.body.classList.add('is-dragging-asset');
        stageCanvas.classList.add('drag-target');
        if (type === 'image') {
          const url = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).getAttribute('src') || '';
          // text/uri-list should be newline-terminated per spec; also set text/plain for broader support
          e.dataTransfer?.setData('text/uri-list', url ? url + '\n' : '');
          e.dataTransfer?.setData('text/plain', url);
        }
        else if (type === 'video') {
          const src = el.getAttribute('data-src') || (el.querySelector('video') as HTMLVideoElement | null)?.src || '';
          if (src) {
            e.dataTransfer?.setData('text/uri-list', src + '\n');
            e.dataTransfer?.setData('text/plain', src);
          }
        } else if (type === 'text') e.dataTransfer?.setData('text/plain', (el.textContent || '').trim());
      });
      node.addEventListener('dragend', () => {
        log('dragend');
        document.body.classList.remove('is-dragging-asset');
        stageCanvas.classList.remove('drag-target');
      });
    };

    addHandlers(el);
    if (type === 'video') {
      const v = el.querySelector('video') as HTMLElement | null;
      if (v) addHandlers(v);
    }
  });
}

export function bindCanvasDropTarget(canvas: HTMLCanvasElement) {
  canvas.addEventListener('dragover', (e) => { e.preventDefault(); try { e.dataTransfer!.dropEffect = 'copy'; } catch {} });
  canvas.addEventListener('dragenter', () => { canvas.classList.add('drag-target'); });
  canvas.addEventListener('dragleave', () => { canvas.classList.remove('drag-target'); });
  canvas.addEventListener('drop', async (e) => {
    e.preventDefault();
    log('drop on canvas');
    const rect = canvas.getBoundingClientRect();
    const dropX = Math.round(e.clientX - rect.left);
    const dropY = Math.round(e.clientY - rect.top);
    // Some browsers include newlines in uri-list; normalize
    const uriListRaw = e.dataTransfer?.getData('text/uri-list') || '';
    const uriList = uriListRaw.split(/\r?\n/).filter(Boolean)[0] || '';
    const plain = (e.dataTransfer?.getData('text/plain') || '').trim();
    try {
      // Prefer files if present
      const files = Array.from(e.dataTransfer?.files || []);
      for (const file of files) {
        const blobUrl = URL.createObjectURL(file);
        if (file.type.startsWith('video/')) {
          const vid = createVideoFromUrl(blobUrl);
          const place = () => {
            const vw = (vid.element as HTMLVideoElement).videoWidth || vid.width;
            const vh = (vid.element as HTMLVideoElement).videoHeight || vid.height;
            const fit = scaleToCanvas(vw, vh, canvas, 0.35);
            vid.width = fit.width; vid.height = fit.height;
            vid.x = dropX - Math.floor(vid.width / 2); vid.y = dropY - Math.floor(vid.height / 2);
            scheduleRedraw();
          };
          (vid.element as HTMLVideoElement).addEventListener('loadedmetadata', place, { once: true });
          addAsset(vid);
          scheduleRedraw();
          log('added dropped video (file)');
          return;
        } else if (file.type.startsWith('image/')) {
          const img = await loadImageFromUrl(blobUrl);
          const fit = scaleToCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height, canvas, 0.35);
          img.width = fit.width; img.height = fit.height;
          img.x = dropX - Math.floor(img.width / 2); img.y = dropY - Math.floor(img.height / 2);
          addAsset(img);
          scheduleRedraw();
          log('added dropped image (file)');
          return;
        }
      }
      const isUrl = (s?: string) => !!s && /^(https?:|blob:|data:)/i.test(s);
      if (uriList && /\.(mp4|webm|ogg)(\?.*)?$/i.test(uriList)) {
        const vid = createVideoFromUrl(uriList);
        const place = () => {
          const vw = (vid.element as HTMLVideoElement).videoWidth || vid.width;
          const vh = (vid.element as HTMLVideoElement).videoHeight || vid.height;
          const fit = scaleToCanvas(vw, vh, canvas, 0.35);
          vid.width = fit.width; vid.height = fit.height;
          vid.x = dropX - Math.floor(vid.width / 2); vid.y = dropY - Math.floor(vid.height / 2);
          scheduleRedraw();
        };
        (vid.element as HTMLVideoElement).addEventListener('loadedmetadata', place, { once: true });
        addAsset(vid);
        scheduleRedraw();
        log('added dropped video');
        return;
      }
      // If we have a URI (even without an image extension), attempt to load as image
      if (uriList) {
        try {
          const img = await loadImageFromUrl(uriList);
          const fit = scaleToCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height, canvas, 0.35);
          img.width = fit.width; img.height = fit.height;
          img.x = dropX - Math.floor(img.width / 2); img.y = dropY - Math.floor(img.height / 2);
          addAsset(img);
          scheduleRedraw();
          log('added dropped image');
          return;
        } catch {}
      }
      if (isUrl(plain)) {
        if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(plain!)) {
          const vid = createVideoFromUrl(plain!);
          const place = () => {
            const vw = (vid.element as HTMLVideoElement).videoWidth || vid.width;
            const vh = (vid.element as HTMLVideoElement).videoHeight || vid.height;
            const fit = scaleToCanvas(vw, vh, canvas, 0.35);
            vid.width = fit.width; vid.height = fit.height;
            vid.x = dropX - Math.floor(vid.width / 2); vid.y = dropY - Math.floor(vid.height / 2);
            scheduleRedraw();
          };
          (vid.element as HTMLVideoElement).addEventListener('loadedmetadata', place, { once: true });
          addAsset(vid);
          scheduleRedraw();
          log('added dropped video (plain)');
          return;
        }
        try {
          const img = await loadImageFromUrl(plain!);
          const fit = scaleToCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height, canvas, 0.35);
          img.width = fit.width; img.height = fit.height;
          img.x = dropX - Math.floor(img.width / 2); img.y = dropY - Math.floor(img.height / 2);
          addAsset(img);
          scheduleRedraw();
          log('added dropped image (plain)');
          return;
        } catch {}
      }
      if (plain && plain.trim()) {
        const textAsset = { type: 'text', x: dropX, y: dropY, text: plain.trim() } as const;
        addAsset(textAsset as any);
        scheduleRedraw();
        log('added dropped text');
      }
    } catch {}
  });
}


