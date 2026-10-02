// Bản web: khung video YouTube ở trên cùng màn hình. Điều khoản YouTube không cho ẩn hay che trình phát nhúng, nên khi
// bài hiện tại là video YouTube, khung này luôn hiện; các trang, trình phát to và bảng chọn được đẩy xuống dưới nó
// (biến CSS --video-h). "Ẩn video" dừng phát rồi mới thu khung lại; bấm phát lại thì khung hiện lại.
import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { VIDEO_SLOT_ID } from 'capacitor-melo-player';
import { pause } from '@/player/controller';
import { currentEntry, usePlayer } from '@/player/store';
import { YOUTUBE_PREFIX } from '@/web/youtube';

/** Khung video đang mở (trình phát to dùng để bỏ ảnh bìa trùng với video). */
export const useVideoStage = create<{ open: boolean }>(() => ({ open: false }));

export function VideoStage() {
  const trackId = usePlayer((s) => currentEntry(s)?.track.id);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const isVideo = Boolean(trackId?.startsWith(YOUTUBE_PREFIX));
  const [hidden, setHidden] = useState(false);
  const [stuck, setStuck] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const open = isVideo && !hidden;

  // Đổi bài, hoặc bấm phát lại sau khi ẩn → hiện khung.
  useEffect(() => setHidden(false), [trackId]);
  useEffect(() => {
    if (playing || buffering) setHidden(false);
  }, [playing, buffering]);

  // iOS chỉ cho phát có tiếng khi người dùng chạm vào chính video ở lần đầu: đợi lâu thì nhắc.
  useEffect(() => {
    setStuck(false);
    if (!open || playing || !buffering) return;
    const timer = setTimeout(() => setStuck(true), 2500);
    return () => clearTimeout(timer);
  }, [open, playing, buffering, trackId]);

  // --video-h = chiều cao khung, không tính vùng tai thỏ (các trang đã tự chừa vùng đó).
  useLayoutEffect(() => {
    const element = stage.current;
    const root = document.documentElement;
    useVideoStage.setState({ open });
    if (!element) return;
    const update = () => {
      const safeTop = parseFloat(getComputedStyle(element).paddingTop) || 0;
      root.style.setProperty('--video-h', open ? `${Math.max(0, element.offsetHeight - safeTop)}px` : '0px');
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [open]);

  const hide = () => {
    setHidden(true);
    void pause();
  };

  return (
    <div
      ref={stage}
      className="safe-top fixed inset-x-0 top-0 z-[45] bg-black"
      style={open ? undefined : { height: 0, paddingTop: 0, overflow: 'hidden' }}
      aria-hidden={!open}
    >
      <div className="mx-auto aspect-video w-full max-w-[calc(38vh*16/9)]">
        <div id={VIDEO_SLOT_ID} className="size-full" />
      </div>
      <div className="flex h-9 items-center gap-2 pr-1 pl-3 text-[12px] text-white/70">
        <span className={`min-w-0 flex-1 truncate ${stuck ? 'font-semibold text-accent' : ''}`}>
          {stuck ? 'Chạm vào video để bắt đầu phát' : 'Video YouTube • chỉ xem online'}
        </span>
        <button className="flex items-center gap-1 rounded-full px-2.5 py-1.5 active:bg-white/10" onClick={hide}>
          <X size={14} /> Ẩn video
        </button>
      </div>
    </div>
  );
}
