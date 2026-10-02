// Bản giả của src/youtube/stream.ts cho `npm run dev:mock`: "nhạc" là tiếng chuông tạo ngay trong trình duyệt.
import type { ResolvedAudio } from '../types';

export type StreamErrorReason = 'age' | 'unavailable' | 'network' | 'blocked';

export class StreamError extends Error {
  constructor(
    message: string,
    readonly reason: StreamErrorReason
  ) {
    super(message);
    this.name = 'StreamError';
  }
}

const cache = new Map<string, ResolvedAudio>();
const SECONDS = 30;

/** WAV mono 16-bit: vài nốt nhạc lặp lại, cao độ theo id bài. */
function toneWav(seed: string): string {
  const rate = 16000;
  const samples = rate * SECONDS;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples * 2, true);
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const base = 220 + (Math.abs(hash) % 12) * 20;
  const notes = [1, 5 / 4, 3 / 2, 2, 3 / 2, 5 / 4];
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const note = notes[Math.floor(t * 2) % notes.length];
    const env = Math.exp(-((t * 2) % 1) * 4) * 0.25;
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * base * note * t) * env * 32767, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function isFresh(audio: ResolvedAudio | undefined): audio is ResolvedAudio {
  return Boolean(audio && audio.expiresAt > Date.now());
}

export function getCachedAudio(videoId: string): ResolvedAudio | undefined {
  const audio = cache.get(videoId);
  return isFresh(audio) ? audio : undefined;
}

export function clearAudioCache() {
  cache.clear();
}

export async function resolveAudio(videoId: string, options: { refresh?: boolean } = {}): Promise<ResolvedAudio> {
  if (options.refresh) cache.delete(videoId);
  const cached = getCachedAudio(videoId);
  if (cached) return cached;
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (videoId.startsWith('broken')) throw new StreamError('Video không còn khả dụng', 'unavailable');
  const audio: ResolvedAudio = { url: toneWav(videoId), expiresAt: Date.now() + 3600_000, mimeType: 'audio/wav', client: 'MOCK' };
  cache.set(videoId, audio);
  return audio;
}
