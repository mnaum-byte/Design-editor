/* eslint-disable */
// @ts-nocheck
import '@/styles/variables.css';
import '@/styles/base.css';
import '@/styles/layout.css';

import { CanvasRenderer } from '@/canvas/renderer';
import { bindTopControls } from '@/ui/topControls';
import { bindGridToggle } from '@/ui/gridToggle';
import { bindVideoToggle } from '@/ui/videoControl';
import { bindGenerateText } from '@/ui/generateText';
import { bindContextMenu } from '@/ui/contextMenu';
import { bindAssetsPanel } from '@/ui/assetsPanel';
import { interactionState } from '@/state/store';
import { deleteSelectedAssets } from '@/state/store';
import { pushHistory } from '@/state/history';
import { scheduleRedraw } from '@/canvas/renderer';

const canvas = document.getElementById('main-canvas') as HTMLCanvasElement;
const sizeGroup = document.getElementById('canvas-size-group') as HTMLElement | null;
const gridToggleBtn = document.getElementById('toggle-grid-btn') as HTMLButtonElement | null;
const videosToggleBtn = document.getElementById('toggle-videos-btn') as HTMLButtonElement | null;
const sidebar = document.querySelector('.sidebar') as HTMLElement | null;

const renderer = new CanvasRenderer(canvas);
bindTopControls(canvas, sizeGroup);
bindGridToggle(gridToggleBtn);
bindVideoToggle(videosToggleBtn);
bindAssetsPanel(sidebar, canvas);
bindGenerateText(canvas);
bindContextMenu();

renderer.resize();
document.addEventListener('visibilitychange', () => renderer.setVisibility(document.visibilityState === 'visible'));
window.addEventListener('keydown', (e) => {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? (e as any).metaKey : (e as any).ctrlKey;
  if (mod && (e.key === 'l' || e.key === 'L')) {
    renderer.setLowQualityMode(true);
    renderer.resize();
    e.preventDefault();
  }
  // Delete/Backspace handling when not editing text
  const key = e.key;
  const isDelete = key === 'Delete' || key === 'Backspace';
  if (isDelete) {
    const active = document.activeElement as HTMLElement | null;
    const isTyping = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    const isEditingText = false; // Text inline edit not implemented via contentEditable on canvas
    if (!isTyping && !isEditingText && interactionState.selectedAssetIndices.size > 0) {
      e.preventDefault();
      pushHistory();
      const removed = deleteSelectedAssets();
      if (removed) scheduleRedraw();
    }
  }
  // Cut (Cmd/Ctrl+X)
  const isMac2 = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const mod2 = isMac2 ? (e as any).metaKey : (e as any).ctrlKey;
  if (mod2 && (e.key === 'x' || e.key === 'X')) {
    if (interactionState.selectedAssetIndices.size > 0) {
      e.preventDefault();
      const indices = Array.from(interactionState.selectedAssetIndices).sort((a, b) => a - b);
      (window as any).__clipboard = indices.map((idx) => (assets[idx] ? { ...assets[idx] } : null)).filter(Boolean);
      pushHistory();
      const removed = deleteSelectedAssets();
      if (removed) scheduleRedraw();
    }
  }
});


