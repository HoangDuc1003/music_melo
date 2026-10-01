import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ getBrowseSession: vi.fn() }));
vi.mock('./http', () => ({ appFetch: vi.fn() }));

import { trustedInterpreterUrl } from './potoken';

describe('trustedInterpreterUrl', () => {
  it('chỉ nhận mã BotGuard từ https://www.google.com/js/…', () => {
    expect(trustedInterpreterUrl('//www.google.com/js/th/abc.js')).toBe('https://www.google.com/js/th/abc.js');
    expect(trustedInterpreterUrl('https://google.com/js/th/x.js')).toBe('https://google.com/js/th/x.js');
    for (const bad of [
      undefined,
      '//evil.com/js/th/abc.js',
      '//www.google.com.evil.com/js/x.js',
      'http://www.google.com/js/x.js',
      '//www.google.com@evil.com/js/x.js',
      '//www.google.com/other/x.js',
      'javascript:alert(1)'
    ]) {
      expect(() => trustedInterpreterUrl(bad)).toThrow();
    }
  });
});
