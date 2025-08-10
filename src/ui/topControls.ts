/* eslint-disable */
// @ts-nocheck
import { computeGeometry, resizeCanvasAndDraw } from '@/canvas/renderer';

export function updateCanvasAspectFromUI(canvas: HTMLCanvasElement, sizeGroup: HTMLElement | null) {
  if (!sizeGroup) return;
  const selectedButton = sizeGroup.querySelector('[data-selected="true"]') || sizeGroup.querySelector('.btn.btn-primary');
  const value = selectedButton ? selectedButton.getAttribute('value') : 'landscape';
  const stage = canvas.parentElement as HTMLElement;
  const stageRect = stage.getBoundingClientRect();
  const topControls = document.getElementById('top-controls');
  const toolbarRect: any = topControls ? topControls.getBoundingClientRect() : { bottom: 48 };
  const spacer = 32;
  const availableStageHeight = Math.max(0, window.innerHeight - (toolbarRect.bottom || 48) - spacer);
  const eightyVh = window.innerHeight * 0.8;
  const maxHeight = Math.min(eightyVh, availableStageHeight || eightyVh);
  const maxWidth = stageRect.width * 0.98;
  let targetWidth = maxWidth; let targetHeight = maxHeight;
  if (value === 'square') { const size = Math.min(maxWidth, maxHeight); targetWidth = size; targetHeight = size; }
  else if (value === 'portrait') {
    const portraitW = 9; const portraitH = 19.5;
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
  canvas.style.width = `${Math.floor(targetWidth)}px`;
  canvas.style.height = `${Math.floor(targetHeight)}px`;
  const topControlsEl = document.getElementById('top-controls') as HTMLElement | null;
  if (topControlsEl) { topControlsEl.style.width = `${Math.floor(targetWidth)}px`; }
  canvas.style.marginTop = `${spacer}px`;
  requestAnimationFrame(() => { resizeCanvasAndDraw(); positionTopControlsToCanvas(canvas); });
}

export function positionTopControlsToCanvas(canvas: HTMLCanvasElement) {
  const topControls = document.getElementById('top-controls');
  const floating = document.getElementById('grid-toggle-floating');
  if (!topControls) return;
  const rect = canvas.getBoundingClientRect();
  topControls.style.left = `${rect.left + rect.width / 2}px`;
  topControls.style.transform = 'translateX(-50%)';
  topControls.style.width = `${Math.floor(rect.width)}px`;
  if (floating) {
    const bottomOffset = 12; const leftOffset = 12;
    floating.style.left = `${rect.left + leftOffset}px`;
    floating.style.top = `${rect.bottom + bottomOffset}px`;
    floating.style.width = 'auto';
  }
}

export function bindTopControls(canvas: HTMLCanvasElement, sizeGroup: HTMLElement | null) {
  if (!sizeGroup) return;
  sizeGroup.addEventListener('click', (e: any) => {
    const path = e.composedPath && e.composedPath();
    const btn = (path || []).find((n: any) => n && n.tagName && n.tagName.toLowerCase && n.tagName.toLowerCase() === 'button');
    if (btn && btn.closest('#canvas-size-group')) {
      sizeGroup.querySelectorAll('button').forEach((b: any) => { b.classList.remove('btn-primary'); (b as any).dataset.selected = 'false'; b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('btn-primary'); btn.dataset.selected = 'true'; btn.setAttribute('aria-pressed', 'true');
      updateCanvasAspectFromUI(canvas, sizeGroup);
    }
  });
  updateCanvasAspectFromUI(canvas, sizeGroup);
  positionTopControlsToCanvas(canvas);
  window.addEventListener('resize', () => { updateCanvasAspectFromUI(canvas, sizeGroup); positionTopControlsToCanvas(canvas); });
  window.addEventListener('scroll', () => { positionTopControlsToCanvas(canvas); }, { passive: true as any });
}

