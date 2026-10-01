import { useEffect, useState, useSyncExternalStore } from 'react';
import { livePosition, usePlayer } from '@/player/store';

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Vị trí phát cập nhật mượt theo từng khung hình (native chỉ báo mỗi giây).
 * `active = false` thì dừng vòng lặp (ví dụ khi trình phát toàn màn hình đang đóng).
 */
export function useLivePosition(active = true): number {
  const [now, setNow] = useState(() => Date.now());
  const playing = usePlayer((s) => s.playing && !s.buffering);
  useEffect(() => {
    if (!active || !playing) return;
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      // ~15 lần/giây là đủ mượt cho thanh tua và lời bài hát, đỡ tốn pin.
      if (time - last > 66) {
        last = time;
        setNow(Date.now());
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, playing]);
  const state = usePlayer();
  return livePosition(state, Math.max(now, state.positionAt));
}

// ---------- Màu nền theo ảnh bìa ----------

const PALETTE = ['#4a2c6b', '#1f4f6b', '#6b2c3c', '#2c6b4a', '#6b5a2c', '#3c2c6b', '#6b3c2c', '#2c5a6b', '#5a6b2c', '#6b2c5a'];
const colorCache = new Map<string, string>();
const listeners = new Set<() => void>();

function hashColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Màu chủ đạo của ảnh, làm tối và tăng độ đậm để chữ trắng luôn đọc rõ. */
export function toneColor(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  const scale = l > 0.35 ? 0.35 / l : 1;
  const mid = (max + min) / 2;
  const boost = (c: number) => Math.round(Math.min(255, Math.max(0, (mid + (c - mid) * 1.3) * scale)));
  return `rgb(${boost(r)}, ${boost(g)}, ${boost(b)})`;
}

function extract(url: string) {
  if (colorCache.has(url)) return;
  colorCache.set(url, hashColor(url));
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 12;
      canvas.height = 12;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 12, 12);
      const data = ctx.getImageData(0, 0, 12, 12).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Ưu tiên điểm ảnh có màu (bỏ bớt trắng/đen/xám).
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        const w = 1 + (max - min) / 32;
        r += data[i] * w;
        g += data[i + 1] * w;
        b += data[i + 2] * w;
        weight += w;
      }
      colorCache.set(url, toneColor(r / weight, g / weight, b / weight));
      listeners.forEach((fn) => fn());
    } catch {
      // Ảnh không cho đọc điểm ảnh (CORS): giữ màu dự phòng.
    }
  };
  img.src = url;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useArtworkColor(url: string | undefined, fallbackKey = ''): string {
  useEffect(() => {
    if (url) extract(url);
  }, [url]);
  return useSyncExternalStore(subscribe, () => (url ? (colorCache.get(url) ?? hashColor(url)) : hashColor(fallbackKey || 'melo')));
}

/** Cuộn của một phần tử (để hiện tiêu đề ở thanh trên cùng khi đã cuộn qua phần đầu trang). */
export function useScrollTop(ref: React.RefObject<HTMLElement | null>): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTop(el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ref]);
  return top;
}
