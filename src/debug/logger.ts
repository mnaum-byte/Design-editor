/* eslint-disable */
// @ts-nocheck

let overlay: HTMLDivElement | null = null;

export function isDebugEnabled(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('debug') === '1') return true;
    return localStorage.getItem('debug') === '1';
  } catch {
    return false;
  }
}

function ensureOverlay(): HTMLDivElement | null {
  if (!isDebugEnabled()) return null;
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.setAttribute('id', 'debug-overlay');
  Object.assign(overlay.style, {
    position: 'fixed', right: '8px', bottom: '8px', maxWidth: '38vw',
    background: 'rgba(17,24,39,0.85)', color: '#e5e7eb',
    border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px',
    padding: '8px', font: '12px/1.35 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
    zIndex: '1000', pointerEvents: 'none', whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: '40vh'
  });
  document.body.appendChild(overlay);
  return overlay;
}

export function log(message: string, data?: any) {
  try { console.log('[DEBUG]', message, data ?? ''); } catch {}
  const el = ensureOverlay();
  if (!el) return;
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.textContent = `${time} ${message}${data !== undefined ? ' ' + safeToString(data) : ''}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function safeToString(d: any) {
  try {
    if (typeof d === 'string') return d;
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}


