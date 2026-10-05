import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phiên YouTube giả: mỗi lần lấy link trả về link mới (v=1, 2, …); `gate` giữ lượt lấy link lại để giả lập mạng chậm.
const yt = vi.hoisted(() => {
  const state = { calls: 0, gate: undefined as Promise<void> | undefined };
  const expire = Math.floor(Date.now() / 1000) + 6 * 3600;
  const session = {
    session: { player: {} },
    getBasicInfo: vi.fn(async (_id: string, _options: { client: string; po_token?: string }) => {
      const n = ++state.calls;
      await state.gate;
      const url = `https://rr1.googlevideo.com/videoplayback?v=${n}&expire=${expire}`;
      return {
        playability_status: { status: 'OK' } as { status: string; reason?: string },
        chooseFormat: () => ({
          itag: 140,
          url,
          decipher: async () => url,
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
const po = vi.hoisted(() => ({ getPoTokens: vi.fn(async () => ({ visitorData: 'v', sessionToken: 's', contentToken: 'c' })) }));
vi.mock('./potoken', () => po);

import { __resetPlayerRequestsForTests, recordPlayerRequests } from './player-requests';
import { __resetClientCooldownsForTests, clearAudioCache, getCachedAudio, resolveAudio } from './stream';

/** Giả lập youtubei.js gửi yêu cầu /player qua fetch đã bọc. */
async function sendPlayerRequest(videoId: string, clientName: string) {
  const fetch = recordPlayerRequests(async () => new Response('{}'));
  await fetch(new Request('https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false'), {
    method: 'POST',
    body: JSON.stringify({ videoId, context: { client: { clientName } } }),
    headers: new Headers({ 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '5', Cookie: 'SID=secret' })
  });
}

beforeEach(() => {
  clearAudioCache();
  __resetClientCooldownsForTests();
  __resetPlayerRequestsForTests();
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

describe('chọn client', () => {
  it('client bị đòi "không phải robot" và PO token lỗi thì tạm bỏ qua; link bị giới hạn 1 MiB không được nhớ làm client chính', async () => {
    const tried: string[] = [];
    const ok = yt.session.getBasicInfo.getMockImplementation()!;
    yt.session.getBasicInfo.mockImplementation(async (id, options) => {
      tried.push(options.client);
      if (options.client === 'VISIONOS') return { playability_status: { status: 'LOGIN_REQUIRED', reason: 'Đăng nhập để xác nhận bạn không phải là robot' } } as never;
      return ok(id, options);
    });
    po.getPoTokens.mockRejectedValueOnce(new Error('Không lấy được BotGuard challenge'));
    try {
      expect((await resolveAudio('abcdefghijk')).client).toBe('IOS');
      expect(tried).toEqual(['VISIONOS', 'IOS']);
      expect(po.getPoTokens).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('melo.preferredClient')).toBeNull();

      // Lần sau: VISIONOS và các client cần PO token xếp cuối → IOS được thử ngay. Link IOS kèm yêu cầu /player
      // để iPhone tự xin link mới khi hết ~1 MiB (bỏ cookie).
      tried.length = 0;
      await sendPlayerRequest('bbbbbbbbbbb', 'IOS');
      const ios = await resolveAudio('bbbbbbbbbbb');
      expect(ios.client).toBe('IOS');
      expect(tried).toEqual(['IOS']);
      expect(ios.refresh).toEqual({
        url: 'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false',
        headers: { 'content-type': 'application/json', 'x-youtube-client-name': '5' },
        body: JSON.stringify({ videoId: 'bbbbbbbbbbb', context: { client: { clientName: 'IOS' } } }),
        itag: 140
      });

      // Hết thời gian tạm bỏ qua: client tải trọn (TV_SIMPLY + PO token) được thử trước IOS và được nhớ.
      __resetClientCooldownsForTests();
      tried.length = 0;
      await sendPlayerRequest('ccccccccccc', 'TV_SIMPLY');
      const full = await resolveAudio('ccccccccccc');
      expect(full.client).toBe('TV_SIMPLY');
      expect(full.refresh).toBeUndefined();
      expect(tried).toEqual(['VISIONOS', 'TV_SIMPLY']);
      expect(localStorage.getItem('melo.preferredClient')).toBe('TV_SIMPLY');
    } finally {
      yt.session.getBasicInfo.mockImplementation(ok);
    }
  });
});
