import { describe, expect, test } from 'vitest';
import { queueForShortcutCode, sidebarCollapsedForContext, shouldAutoCollapseSidebar, shouldCollapseSidebarOnResize, shouldExpandSidebarOnResize } from './App.js';

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

describe('shouldAutoCollapseSidebar', () => {
  test('collapses the rail when the working area becomes narrow', () => {
    expect(shouldAutoCollapseSidebar(1159)).toBe(true);
    expect(shouldAutoCollapseSidebar(1160)).toBe(false);
  });
});

describe('shouldCollapseSidebarOnResize', () => {
  test('collapses only when the window crosses into the narrow layout', () => {
    expect(shouldCollapseSidebarOnResize(1200, 1159)).toBe(true);
    expect(shouldCollapseSidebarOnResize(1159, 900)).toBe(false);
    expect(shouldCollapseSidebarOnResize(1200, 1200)).toBe(false);
  });
});

describe('shouldExpandSidebarOnResize', () => {
  test('expands the rail when the window grows past the narrow breakpoint', () => {
    expect(shouldExpandSidebarOnResize(1159, 1160)).toBe(true);
    expect(shouldExpandSidebarOnResize(900, 1159)).toBe(false);
    expect(shouldExpandSidebarOnResize(1160, 1200)).toBe(false);
  });
});

describe('sidebarCollapsedForContext', () => {
  test('keeps the sidebar compact while a flow editor is open', () => {
    expect(sidebarCollapsedForContext(true, 1440)).toBe(true);
    expect(sidebarCollapsedForContext(false, 900)).toBe(true);
    expect(sidebarCollapsedForContext(false, 1440)).toBe(false);
  });
});
