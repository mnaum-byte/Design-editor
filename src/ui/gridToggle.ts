/* eslint-disable */
// @ts-nocheck
import { getGridEnabled, setGridEnabled } from '@/canvas/renderer';

export function bindGridToggle(button: HTMLButtonElement | null) {
  if (!button) return;
  // Sync initial UI state
  const initial = getGridEnabled();
  button.classList.toggle('active', initial);
  button.setAttribute('aria-pressed', String(initial));
  button.addEventListener('click', () => {
    const next = !getGridEnabled();
    setGridEnabled(next);
    button.classList.toggle('active', next);
    button.setAttribute('aria-pressed', String(next));
  });
}

