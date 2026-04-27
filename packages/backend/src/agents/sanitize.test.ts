import { describe, test, expect } from 'bun:test';
import { sanitizeLine } from './cli-adapter.js';

describe('sanitizeLine', () => {
  test('strips ANSI escape sequences', () => {
    const input = '\x1b[31mError:\x1b[0m something failed';
    expect(sanitizeLine(input)).toBe('Error: something failed');
  });

  test('handles multiple ANSI sequences', () => {
    const input = '\x1b[1m\x1b[32mSuccess\x1b[0m - all \x1b[33mpassed\x1b[0m';
    expect(sanitizeLine(input)).toBe('Success - all passed');
  });

  test('returns plain text unchanged', () => {
    expect(sanitizeLine('Hello, world!')).toBe('Hello, world!');
  });

  test('handles empty string', () => {
    expect(sanitizeLine('')).toBe('');
  });

  test('replaces binary data', () => {
    const input = 'some\x00binary\x01data';
    const result = sanitizeLine(input);
    expect(result).toMatch(/^\[binary data, \d+ bytes\]$/);
  });

  test('truncates long lines', () => {
    const longLine = 'x'.repeat(20000);
    const result = sanitizeLine(longLine);
    expect(result.length).toBeLessThan(20000);
    expect(result).toContain('... [truncated]');
  });

  test('does not truncate lines at limit', () => {
    const line = 'x'.repeat(10240);
    expect(sanitizeLine(line)).toBe(line);
  });

  test('handles control characters with ANSI combined', () => {
    const input = '\x1b[31m\x02\x03\x1b[0m';
    const result = sanitizeLine(input);
    expect(result).toMatch(/^\[binary data, \d+ bytes\]$/);
  });
});
