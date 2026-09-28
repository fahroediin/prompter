import type { PromptSettings } from '../../main/settings';

declare global {
  interface Window {
    control: {
      onSettings(cb: (s: PromptSettings) => void): void;
      onScript(cb: (t: string) => void): void;
      applySettings(s: PromptSettings): void;
      setScript(text: string): void;
      openListener(): void;
      loadScriptFile(): Promise<string>;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scriptEl = $('script') as HTMLTextAreaElement;
let current: PromptSettings;

const sliders: (keyof PromptSettings)[] = [
  'bgOpacity',
  'fontWeight',
  'fontSize',
  'margin',
  'autoScrollSpeed',
];
const valIds: Record<string, string> = {
  bgOpacity: 'bgVal',
  fontWeight: 'fwVal',
  fontSize: 'fsVal',
  margin: 'mVal',
  autoScrollSpeed: 'asVal',
};

function reflect(s: PromptSettings) {
  current = s;
  for (const k of sliders) {
    ($(k) as HTMLInputElement).value = String(s[k]);
    $(valIds[k]).textContent = String(s[k]);
  }
  ($('alwaysOnTop') as HTMLInputElement).checked = s.alwaysOnTop;
  ($('clickThrough') as HTMLInputElement).checked = s.clickThrough;
}

function push() {
  const next: PromptSettings = { ...current };
  for (const k of sliders) {
    (next[k] as number) = Number(($(k) as HTMLInputElement).value);
    $(valIds[k]).textContent = ($(k) as HTMLInputElement).value;
  }
  next.alwaysOnTop = ($('alwaysOnTop') as HTMLInputElement).checked;
  next.clickThrough = ($('clickThrough') as HTMLInputElement).checked;
  current = next;
  window.control.applySettings(next);
}

window.control.onSettings(reflect);
window.control.onScript((t) => (scriptEl.value = t));

[...sliders, 'alwaysOnTop', 'clickThrough'].forEach((id) =>
  $(id).addEventListener('input', push)
);

scriptEl.addEventListener('input', () => window.control.setScript(scriptEl.value));
$('openListener').addEventListener('click', () => window.control.openListener());
$('loadFile').addEventListener('click', async () => {
  const text = await window.control.loadScriptFile();
  if (text) {
    scriptEl.value = text;
    window.control.setScript(text);
  }
});
