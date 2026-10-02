// Tạo PO token (Proof of Origin) bằng BotGuard — chỉ dùng khi client không cần token bị YouTube chặn.
// Trong app iPhone, WebView là trình duyệt thật nên BotGuard chạy trực tiếp (không cần jsdom).
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { GOOG_API_KEY, buildURL } from 'bgutils-js/utils';
import { log } from '@/lib/log';
import { getBrowseSession } from './client';
import { appFetch } from './http';

// Hằng số công khai có trong mã JS của YouTube web (không phải bí mật), xem .gitleaks.toml.
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

/**
 * URL mã BotGuard lấy từ phản hồi của YouTube; trước khi chạy (new Function) phải chắc chắn
 * nó nằm trên máy chủ Google qua HTTPS, không phải một địa chỉ bất kỳ.
 */
export function trustedInterpreterUrl(raw: string | undefined): string {
  if (!raw) throw new Error('Thiếu URL BotGuard');
  const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  if (url.protocol !== 'https:' || !/^(www\.)?google\.com$/.test(url.hostname) || !url.pathname.startsWith('/js/')) {
    throw new Error(`URL BotGuard lạ: ${url.hostname}`);
  }
  return url.toString();
}

interface MinterState {
  minter: WebPoMinter;
  visitorData: string;
  sessionToken: string;
  expiresAt: number;
}

let state: Promise<MinterState> | undefined;

async function createMinter(): Promise<MinterState> {
  const started = performance.now();
  const yt = await getBrowseSession();
  const visitorData = yt.session.context.client.visitorData;
  if (!visitorData) throw new Error('Thiếu visitorData');

  const challenge = await yt.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND');
  const bg = challenge.bg_challenge;
  if (!bg) throw new Error('Không lấy được BotGuard challenge');
  const interpreterUrl = trustedInterpreterUrl(bg.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value);
  const interpreterJs = await (await appFetch(interpreterUrl)).text();
  // Mã BotGuard của Google (giống FreeTube): chỉ chạy khi tải từ đúng máy chủ Google ở trên.
  new Function(interpreterJs)();

  const botguard = await BotGuardClient.create({ program: bg.program, globalName: bg.global_name, globalObject: globalThis });
  const webPoSignalOutput: unknown[] = [];
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput: webPoSignalOutput as never });

  const res = await appFetch(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1'
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse])
  });
  const json = (await res.json()) as unknown[];
  const integrityToken = json[0];
  if (typeof integrityToken !== 'string') throw new Error('Không lấy được integrity token');
  const ttlSeconds = typeof json[1] === 'number' ? json[1] : 3600;

  const minter = await WebPoMinter.create({ integrityToken }, webPoSignalOutput as never);
  const sessionToken = await minter.mintAsWebsafeString(visitorData);
  log.info('potoken', `minter ready in ${Math.round(performance.now() - started)}ms, ttl ${ttlSeconds}s`);
  return { minter, visitorData, sessionToken, expiresAt: Date.now() + ttlSeconds * 1000 - 5 * 60_000 };
}

export async function getPoTokens(videoId: string) {
  if (state) {
    const current = await state.catch(() => undefined);
    if (!current || current.expiresAt < Date.now()) state = undefined;
  }
  state ??= createMinter().catch((err) => {
    state = undefined;
    throw err;
  });
  const s = await state;
  const contentToken = await s.minter.mintAsWebsafeString(videoId);
  return { visitorData: s.visitorData, sessionToken: s.sessionToken, contentToken };
}

