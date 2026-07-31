import { describe, expect, test } from 'vitest';
import { BLOCK_ICON_NAMES } from './Icon.js';

type SourceGlob = (pattern: string, options: { query: string; import: string; eager: boolean }) => Record<string, string>;
const applicationSources = (import.meta as ImportMeta & { glob: SourceGlob }).glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true });
const styleSources = (import.meta as ImportMeta & { glob: SourceGlob }).glob('../**/*.css', { query: '?raw', import: 'default', eager: true });

describe('shared icon registry', () => {
  test('uses a plain question mark for Decision blocks', () => {
    expect(BLOCK_ICON_NAMES.decision).toBe('question');
  });

  test('keeps application pictograms out of feature components', () => {
    for (const [path, source] of Object.entries(applicationSources)) {
      if (path.endsWith('.test.tsx') || path.endsWith('/Icon.tsx')) continue;
      expect(source, `${path} contains an inline SVG`).not.toContain('<svg');
      expect(source, `${path} contains a legacy visual glyph`).not.toMatch(/[>][←▶✓■≡][<]/u);
      expect(source, `${path} contains a legacy alert glyph`).not.toMatch(/<span[^>]*>!<\/span>/u);
    }
    for (const [path, source] of Object.entries(styleSources)) {
      expect(source, `${path} rotates the shared Decision icon frame`).not.toMatch(/decision[^{}]*\{[^}]*rotate\(45deg\)/u);
    }
  });
});
