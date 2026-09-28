import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type PromptSettings = {
  alwaysOnTop: boolean;
  clickThrough: boolean;
  bgOpacity: number;
  fontWeight: number;
  fontSize: number;
  margin: number;
  autoScrollSpeed: number;
};

export const DEFAULT_SETTINGS: PromptSettings = {
  alwaysOnTop: true,
  clickThrough: false,
  bgOpacity: 40,
  fontWeight: 600,
  fontSize: 32,
  margin: 48,
  autoScrollSpeed: 40,
};

export class Store {
  private settingsPath: string;
  private scriptPath: string;

  constructor(dir: string) {
    this.settingsPath = join(dir, 'settings.json');
    this.scriptPath = join(dir, 'script.txt');
  }

  readSettings(): PromptSettings {
    try {
      if (!existsSync(this.settingsPath)) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(readFileSync(this.settingsPath, 'utf8'));
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  writeSettings(s: PromptSettings): void {
    writeFileSync(this.settingsPath, JSON.stringify(s, null, 2), 'utf8');
  }

  readScript(): string {
    try {
      return existsSync(this.scriptPath) ? readFileSync(this.scriptPath, 'utf8') : '';
    } catch {
      return '';
    }
  }

  writeScript(text: string): void {
    writeFileSync(this.scriptPath, text, 'utf8');
  }
}
