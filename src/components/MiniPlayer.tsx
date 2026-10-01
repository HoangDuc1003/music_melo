import { useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { joinArtists } from '@/lib/format';
import { next, previous, togglePlay } from '@/player/controller';
import { currentEntry, usePlayer } from '@/player/store';
import { useArtworkColor, useLivePosition } from '@/ui/hooks';
import { openPlayer } from '@/ui/overlays';
import { Artwork } from './Artwork';

/** Trình phát thu nhỏ trên thanh tab: chạm để mở to, vuốt ngang để chuyển bài. */
export function MiniPlayer() {
  const entry = usePlayer((s) => currentEntry(s));
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const duration = usePlayer((s) => s.duration);
  const position = useLivePosition(Boolean(entry));
  const color = useArtworkColor(entry?.track.thumbnail, entry?.track.id);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  if (!entry) return null;
  const { track } = entry;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const moveX = e.clientX - s.x;
    if (!s.moved && Math.abs(moveX) > 8 && Math.abs(moveX) > Math.abs(e.clientY - s.y)) {
      s.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (s.moved) setDx(moveX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s) return;
    const moveX = e.clientX - s.x;
    setDx(0);
    if (!s.moved) return openPlayer();
    if (moveX < -70) void next();
    else if (moveX > 70) void previous();
  };

  return (
    <div
      className="relative mx-2 overflow-hidden rounded-lg shadow-lg transition-colors duration-500"
      style={{ backgroundColor: color, touchAction: 'pan-y' }}
    >
      <div className="flex items-center gap-2.5 p-2 pr-1">
        <div
          className="flex min-w-0 flex-1 items-center gap-2.5"
          style={{ transform: `translateX(${dx}px)`, opacity: 1 - Math.min(0.6, Math.abs(dx) / 200), transition: dragging ? 'none' : 'transform 200ms ease, opacity 200ms' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            start.current = null;
            setDragging(false);
            setDx(0);
          }}
        >
          <Artwork src={track.thumbnail} size={40} className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold leading-tight">{track.title}</div>
            <div className="truncate text-[13px] leading-tight text-white/70">{joinArtists(track.artists)}</div>
          </div>
        </div>
        <button
          className="flex size-10 shrink-0 items-center justify-center active:scale-90"
          aria-label={playing ? 'Tạm dừng' : 'Phát'}
          onClick={() => void togglePlay()}
        >
          {buffering && playing ? (
            <span className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : playing ? (
            <Pause size={24} fill="white" strokeWidth={0} />
          ) : (
            <Play size={24} fill="white" strokeWidth={0} />
          )}
        </button>
      </div>
      <div className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-white/25">
        <div className="h-full origin-left rounded-full bg-white" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  );
}
