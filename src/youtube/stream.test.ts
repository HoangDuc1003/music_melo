import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phiên YouTube giả: mỗi lần lấy link trả về link mới (v=1, 2, …); `gate` giữ lượt lấy link lại để giả lập mạng chậm.
const yt = vi.hoisted(() => {
  const state = { calls: 0, gate: undefined as Promise<void> | undefined };
  const expire = Math.floor(Date.now() / 1000) + 6 * 3600;
  const session = {
    session: { player: {} },
    getBasicInfo: vi.fn(async () => {
      const n = ++state.calls;
      await state.gate;
      return {
        playability_status: { status: 'OK' },
        chooseFormat: () => ({
          decipher: async () => `https://rr1.googlevideo.com/videoplayback?v=${n}&expire=${expire}`,
          content_length: '5000000',
          mime_type: 'audio/mp4',
          bitrate: 128000
        })
      };
    })
  };
  return { state, session };
});
vi.mock('./client', () => ({ getStreamSession: async () => yt.session, getPoStreamSession: async () => yt.session }));
vi.mock('./http', () => ({ appFetch: async () => new Response(null, { status: 206 }) }));

import { clearAudioCache, getCachedAudio, resolveAudio } from './stream';

beforeEach(() => {
  clearAudioCache();
  localStorage.clear();
  yt.state.calls = 0;
  yt.state.gate = undefined;
});

describe('lấy link nhạc', () => {
  it('gọi cùng lúc chỉ lấy một lần, lần sau dùng link đã nhớ', async () => {
    const [a, b] = await Promise.all([resolveAudio('abcdefghijk'), resolveAudio('abcdefghijk')]);
    expect(a.url).toBe(b.url);
    expect(yt.state.calls).toBe(1);
    expect(getCachedAudio('abcdefghijk')?.url).toBe(a.url);
    expect((await resolveAudio('abcdefghijk', { refresh: true })).url).toMatch(/v=2/);
  });

  it('đổi mạng trong lúc đang lấy link: không nhớ link gắn IP cũ, lấy lại theo mạng mới', async () => {
    let release = () => undefined as void;
    yt.state.gate = new Promise<void>((resolve) => (release = resolve));
    const pending = resolveAudio('abcdefghijk');
    await vi.waitFor(() => expect(yt.state.calls).toBe(1));
    clearAudioCache();
    yt.state.gate = undefined;
    release();
    const audio = await pending;
    expect(audio.url).toMatch(/v=2/);
    expect(getCachedAudio('abcdefghijk')?.url).toBe(audio.url);
  });
});
