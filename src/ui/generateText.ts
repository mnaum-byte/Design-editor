/* eslint-disable */
// @ts-nocheck
import { addAsset } from '@/state/store';
import { scheduleRedraw } from '@/canvas/renderer';
import { TEXT_DEFAULT_COLOR, TEXT_DEFAULT_FONT } from '@/constants';
import { log } from '@/debug/logger';

export function bindGenerateText(canvas: HTMLCanvasElement) {
  const openBtn = document.getElementById('open-generate-text') as HTMLButtonElement | null;
  const overlay = document.getElementById('add-text-overlay') as HTMLDivElement | null;
  if (!openBtn || !overlay) return;

  const input = document.getElementById('generate-text-input') as HTMLInputElement | null;
  const preview = document.getElementById('generate-preview') as HTMLTextAreaElement | null;
  const btnCancel = document.getElementById('add-text-cancel') as HTMLButtonElement | null;
  const btnGenerate = document.getElementById('generate-text') as HTMLButtonElement | null;
  const btnAdd = document.getElementById('add-text-confirm') as HTMLButtonElement | null;
  const suggestions = document.getElementById('prompt-suggestions') as HTMLElement | null;
  const modal = overlay?.querySelector('.modal') as HTMLDivElement | null;

  const show = () => {
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    if (btnAdd) btnAdd.disabled = true;
    updatePreviewStyle();
  };
  const hide = () => { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); };
  const refresh = () => {
    if (!btnGenerate || !input) return;
    const hasTopic = !!(input.value && input.value.trim().length > 0);
    btnGenerate.disabled = !hasTopic;
  };

  openBtn.addEventListener('click', () => { show(); refresh(); input?.focus(); });
  btnCancel?.addEventListener('click', () => hide());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });
  document.addEventListener('keydown', (e) => { if (overlay.classList.contains('show') && e.key === 'Escape') hide(); });

  // Move the Add button below the preview textarea
  if (preview && btnAdd && preview.parentElement) {
    try { preview.insertAdjacentElement('afterend', btnAdd); } catch {}
    try { (btnAdd as HTMLButtonElement).style.marginTop = '10px'; (btnAdd as HTMLButtonElement).style.float = 'right'; } catch {}
  }

  // Hide prompt suggestions per request
  if (suggestions) suggestions.style.display = 'none';

  // Replace Cancel button with a top-right close "X" icon button
  if (btnCancel) { btnCancel.style.display = 'none'; }
  if (modal) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => hide());
    try { modal.insertAdjacentElement('afterbegin', closeBtn); } catch {}
  }

  input?.addEventListener('input', refresh);
  suggestions?.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('[data-topic]') as HTMLElement | null;
    if (!chip || !input) return;
    input.value = chip.getAttribute('data-topic') || '';
    refresh();
  });

  const updatePreviewStyle = () => {
    if (!preview) return;
    preview.style.width = '100%';
    preview.style.minHeight = '120px';
    preview.style.padding = '10px 12px';
    preview.style.borderRadius = '8px';
    preview.style.border = '1px solid rgba(255,255,255,0.18)';
    preview.style.background = 'rgba(255,255,255,0.06)';
    preview.style.color = 'var(--text)';
    preview.style.font = TEXT_DEFAULT_FONT;
  };

  async function generateShortText(topic: string): Promise<string> {
    const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY || localStorage.getItem('OPENAI_API_KEY') || '';
    const system = 'You generate concise marketing copy. Reply with under 12 words.';
    const user = `Generate a short line (under 12 words) about: ${topic}`;
    const stripQuotes = (s: string) => {
      const open = ['"', "'", '“', '‘'];
      const close = ['"', "'", '”', '’'];
      let t = (s || '').trim();
      if (t.length >= 2) {
        const first = t[0];
        const last = t[t.length - 1];
        if (open.includes(first) && close.includes(last)) t = t.slice(1, -1).trim();
      }
      return t;
    };
    if (!apiKey) {
      // Fallback local generation
      const base = topic ? `${topic} – limited-time offer. Join us today!` : 'Create something unforgettable. Join us today!';
      return base.split(/\s+/).slice(0, 12).join(' ');
    }
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
          temperature: 0.7,
          max_tokens: 40
        })
      });
      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content?.trim?.() || '';
      const noQuotes = stripQuotes(text);
      const trimmed = noQuotes.split(/\s+/).slice(0, 12).join(' ');
      return trimmed;
    } catch {
      const base = topic ? `${topic} – limited-time offer. Join us today!` : 'Create something unforgettable. Join us today!';
      return stripQuotes(base).split(/\s+/).slice(0, 12).join(' ');
    }
  }

  btnGenerate?.addEventListener('click', async () => {
    if (!input || !preview) return;
    const topic = (input.value || '').trim();
    preview.value = 'Generating…';
    if (btnAdd) btnAdd.disabled = true;
    const text = await generateShortText(topic);
    preview.value = text;
    if (btnAdd) btnAdd.disabled = !text.trim();
    updatePreviewStyle();
  });

  preview?.addEventListener('input', () => { if (btnAdd) btnAdd.disabled = !preview.value.trim(); });

  btnAdd?.addEventListener('click', () => {
    if (!preview) return;
    const content = (preview.value || '').trim();
    if (!content) return;
    const rect = canvas.getBoundingClientRect();
    const centerX = Math.round(rect.width / 2);
    const maxWidth = Math.max(240, Math.floor(rect.width * 0.7));
    const x = centerX; const y = Math.max(64, Math.round(rect.height * 0.22));
    addAsset({ type: 'text', x, y, text: content, color: TEXT_DEFAULT_COLOR, font: TEXT_DEFAULT_FONT, maxWidth, textAlign: 'center' } as any);
    scheduleRedraw();
    hide();
    log('generate overlay: added text');
  });
}


