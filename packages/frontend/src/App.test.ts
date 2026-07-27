import { describe, expect, test } from 'vitest';
import { queueForShortcutCode } from './App.js';

describe('queueForShortcutCode', () => {
  test('uses physical digit keys so Option shortcuts work with macOS keyboard layouts', () => {
    expect(queueForShortcutCode('Digit1')).toBe('backlog');
    expect(queueForShortcutCode('Digit4')).toBe('attention');
    expect(queueForShortcutCode('Digit5')).toBe('finished');
  });
  test('ignores unrelated keys', () => {
    expect(queueForShortcutCode('KeyN')).toBeNull();
    expect(queueForShortcutCode('Digit8')).toBeNull();
  });
});
