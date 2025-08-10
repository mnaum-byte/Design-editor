/* eslint-disable */
// @ts-nocheck

// Lightweight image loading/cache with concurrency control and createImageBitmap

type CachedImage = {
  bitmap: ImageBitmap | null;
  element: HTMLImageElement | null;
  width: number;
  height: number;
};

const urlToPromise = new Map<string, Promise<CachedImage>>();
const lru = new Map<string, CachedImage>();
// Cap cache by total pixels to control memory footprint (approx)
const LRU_ITEM_CAP = 64; // safety bound by count
let totalCachedPixels = 0;
const TOTAL_PIXEL_CAP = 200 * 1024 * 1024; // ~200 MPixels

let active = 0;
const queue: Array<() => void> = [];
const MAX_CONCURRENT = 6; // improve initial throughput on desktop

function runOrQueue(fn: () => Promise<void>) {
  const tryRun = () => {
    if (active < MAX_CONCURRENT) {
      active += 1;
      fn().finally(() => {
        active -= 1;
        const next = queue.shift();
        if (next) next();
      });
    } else {
      queue.push(tryRun);
    }
  };
  tryRun();
}

function touchLru(key: string, value: CachedImage) {
  lru.delete(key);
  lru.set(key, value);
  // maintain counters
  totalCachedPixels += Math.max(1, (value.width || 1) * (value.height || 1));
  // Evict by count or total pixels
  const evictOldest = () => {
    const oldest = lru.keys().next().value;
    const evicted = lru.get(oldest);
    lru.delete(oldest);
    if (evicted) {
      totalCachedPixels -= Math.max(1, (evicted.width || 1) * (evicted.height || 1));
      try { evicted.bitmap && (evicted.bitmap as any).close?.(); } catch {}
    }
  };
  while (lru.size > LRU_ITEM_CAP || totalCachedPixels > TOTAL_PIXEL_CAP) evictOldest();
}

async function loadViaFetch(url: string, resize?: { resizeWidth?: number; resizeHeight?: number }): Promise<CachedImage> {
  const controller = new AbortController();
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-cache', signal: controller.signal as any });
  const blob = await res.blob();
  try {
    const bmp = await (resize && (window as any).createImageBitmap
      ? createImageBitmap(blob as any, { resizeWidth: resize.resizeWidth, resizeHeight: resize.resizeHeight, resizeQuality: 'high' as any })
      : createImageBitmap(blob as any));
    return { bitmap: bmp, element: null, width: (bmp as any).width || 0, height: (bmp as any).height || 0 };
  } catch {
    // Fallback to HTMLImageElement
    const img = new Image();
    img.crossOrigin = 'anonymous';
    (img as any).decoding = 'async';
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      const objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
      // Revoke after image loads to avoid leaks while preserving ability to refetch later
      img.onload = () => { try { URL.revokeObjectURL(objectUrl); } catch {} };
    });
    return { bitmap: null, element: loaded, width: loaded.naturalWidth || loaded.width || 0, height: loaded.naturalHeight || loaded.height || 0 };
  }
}

export function loadImageCached(url: string, opts?: { resizeWidth?: number; resizeHeight?: number }): Promise<CachedImage> {
  const keySuffix = opts && (opts.resizeWidth || opts.resizeHeight) ? `@${opts.resizeWidth || ''}x${opts.resizeHeight || ''}` : '';
  const key = `${url}${keySuffix}`;
  if (lru.has(key)) return Promise.resolve(lru.get(key)!);
  if (urlToPromise.has(key)) return urlToPromise.get(key)!;

  let resolveOuter: (v: CachedImage) => void;
  let rejectOuter: (e: any) => void;
  const p = new Promise<CachedImage>((resolve, reject) => { resolveOuter = resolve; rejectOuter = reject; });
  urlToPromise.set(key, p);

  runOrQueue(async () => {
    try {
      const asset = await loadViaFetch(url, opts);
      touchLru(key, asset);
      resolveOuter(asset);
    } catch (e) {
      urlToPromise.delete(key);
      rejectOuter(e);
    }
  });

  return p;
}

export function clearImageCache() {
  for (const [k, v] of lru) { try { v?.bitmap && (v.bitmap as any).close?.(); } catch {}; lru.delete(k); }
  urlToPromise.clear();
  totalCachedPixels = 0;
}


