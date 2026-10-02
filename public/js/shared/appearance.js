export const FONT_OPTIONS = {
  original: { label: 'Billdot original', body: '"Space Grotesk", system-ui, sans-serif', detail: '"Space Mono", ui-monospace, monospace', display: 'Doto, "Space Mono", monospace' },
  grotesk: { label: 'Space Grotesk', body: '"Space Grotesk", system-ui, sans-serif' },
  mono: { label: 'Space Mono', body: '"Space Mono", ui-monospace, monospace' },
  system: { label: 'System sans', body: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  arial: { label: 'Arial', body: 'Arial, Helvetica, sans-serif' },
  serif: { label: 'Classic serif', body: 'Georgia, "Times New Roman", serif' },
};
export const STYLE_OPTIONS = { billdot: 'Billdot', notion: 'Notion — minimal' };
export const appearanceStyle = (value) => Object.hasOwn(STYLE_OPTIONS, value) ? value : 'billdot';

export function fontTheme(choice = 'original') {
  const f = Object.hasOwn(FONT_OPTIONS, choice) ? FONT_OPTIONS[choice] : FONT_OPTIONS.original;
  return { body: f.body, detail: f.detail || f.body, display: f.display || f.body };
}

export function applyAppearance(settings = {}, root = document.documentElement) {
  const choice = settings.appearance?.font || 'original';
  const style = appearanceStyle(settings.appearance?.style);
  const f = fontTheme(style === 'notion' && choice === 'original' ? 'system' : choice);
  root.dataset.style = style;
  for (const [key, value] of [['--font', f.body], ['--mono', f.detail], ['--dot', f.display]]) root.style.setProperty(key, value);
  try { localStorage.setItem('bd-font', choice); localStorage.setItem('bd-style', style); } catch { /* Storage may be blocked. */ }
}
