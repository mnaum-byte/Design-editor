/* eslint-disable */
// @ts-nocheck
import { assets, backgroundLayer } from '@/state/store';
import { scheduleRedraw } from '@/canvas/renderer';

function anyVideoPlaying() {
  const anyAsset = assets.some(a => a.type === 'video' && a.element && !a.element.paused && !a.element.ended);
  const bg = backgroundLayer && backgroundLayer.type === 'video' && backgroundLayer.element && !backgroundLayer.element.paused && !backgroundLayer.element.ended;
  return anyAsset || bg;
}
function anyVideosPresent() {
  const anyAsset = assets.some(a => a.type === 'video');
  const anyBg = !!(backgroundLayer && backgroundLayer.type === 'video');
  return anyAsset || anyBg;
}
function playAllVideos() {
  let any = false;
  for (const a of assets) {
    if (a.type === 'video' && a.element) {
      try { a.element.currentTime = 0; } catch {}
      try { a.element.play().catch(()=>{}); any = true; } catch {}
    }
  }
  if (backgroundLayer && backgroundLayer.type === 'video' && backgroundLayer.element) {
    try { backgroundLayer.element.currentTime = 0; } catch {}
    try { backgroundLayer.element.play().catch(()=>{}); any = true; } catch {}
  }
  if (any) scheduleRedraw();
}
function pauseAllVideos() {
  let any = false;
  for (const a of assets) {
    if (a.type === 'video' && a.element) { try { a.element.pause(); any = true; } catch {} }
  }
  if (backgroundLayer && backgroundLayer.type === 'video' && backgroundLayer.element) { try { backgroundLayer.element.pause(); any = true; } catch {} }
  if (any) scheduleRedraw();
}

function refreshVideosToggleIcon(button: HTMLButtonElement | null) {
  if (!button) return;
  const hasAny = anyVideosPresent();
  const playingSome = hasAny && anyVideoPlaying();
  const iconPause = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  const iconPlay = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  button.innerHTML = playingSome ? iconPause : iconPlay;
  button.setAttribute('aria-label', playingSome ? 'Pause all videos' : 'Play all videos');
  button.classList.toggle('active', playingSome);
  button.setAttribute('aria-pressed', String(playingSome));
  button.disabled = !hasAny; button.setAttribute('aria-disabled', String(!hasAny));
}

export function bindVideoToggle(button: HTMLButtonElement | null) {
  if (!button) return;
  // Click toggles play/pause across all videos (foreground + background)
  button.addEventListener('click', () => {
    if (anyVideoPlaying()) pauseAllVideos(); else playAllVideos();
    refreshVideosToggleIcon(button);
  });
  // Keep icon in sync when background changes or videos start/stop by other actions
  document.addEventListener('assets:changed', () => refreshVideosToggleIcon(button));
  ['play', 'pause', 'ended', 'ratechange'].forEach((ev) => {
    document.addEventListener(ev, () => refreshVideosToggleIcon(button) as any, true);
  });
  refreshVideosToggleIcon(button);
}

