import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  EllipsisVertical,
  Heart,
  ListMusic,
  MicVocal,
  MoonStar,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward
} from 'lucide-react';
import { joinArtists } from '@/lib/format';
import { useIsLiked } from '@/lib/library';
import { cycleRepeat, next, previous, togglePlay, toggleShuffle } from '@/player/controller';
import type { RepeatMode } from 'capacitor-melo-player';
import type { PlayContext } from '@/player/queue';
import { currentEntry, usePlayer } from '@/player/store';
import { useArtworkColor, useSlideIn } from '@/ui/hooks';
import { navigate } from '@/ui/nav';
import { closePlayer, openSleepTimer, openTrackMenu, setPanel, toggleLikeWithToast, useOverlays } from '@/ui/overlays';
import { TrackArtwork } from './TrackArtwork';
import { LyricsPanel } from './LyricsPanel';
import { PlayPauseIcon } from './PlayPauseIcon';
import { QueueSheet } from './QueueSheet';
import { SeekBar } from './SeekBar';

const CONTEXT_LABEL: Record<PlayContext['type'], string> = {
  album: 'Đang phát từ album',
  playlist: 'Đang phát từ playlist',
  artist: 'Đang phát từ nghệ sĩ',
  search: 'Đang phát từ tìm kiếm',
  library: 'Đang phát từ thư viện',
  radio: 'Đang phát radio',
  other: 'Đang phát'
};

const REPEAT_LABEL: Record<RepeatMode, string> = { off: 'Không lặp', all: 'Lặp tất cả', one: 'Lặp một bài' };

/** Trình phát toàn màn hình: vuốt xuống để đóng, nền theo màu ảnh bìa. */
export function FullPlayer() {
  const open = useOverlays((s) => s.playerOpen);
  const panel = useOverlays((s) => s.panel);
  const entry = usePlayer((s) => currentEntry(s));
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const duration = usePlayer((s) => s.duration || currentEntry(s)?.track.duration || 0);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const context = usePlayer((s) => s.context);
  const sleepActive = usePlayer((s) => Boolean(s.sleepTimerEndsAt || s.sleepAtEndOfItem));
  const liked = useIsLiked(entry?.track.id);
  const color = useArtworkColor(entry?.track.thumbnail, entry?.track.id);

  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; x: number; t: number } | null>(null);
  const { mounted, shown } = useSlideIn(open, 320, () => setDrag(0));

  // Hết hàng chờ (xoá hết bài) thì đóng.
  useEffect(() => {
    if (open && !entry) closePlayer();
  }, [open, entry]);

  if (!mounted || !entry) return null;
  const { track } = entry;

  // Chỉ coi là kéo khi ngón tay đã đi xuống một đoạn: chạm thường vẫn bấm được các nút trong vùng này.
  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { y: e.clientY, x: e.clientX, t: performance.now() };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dy = e.clientY - s.y;
    if (!dragging) {
      if (dy < 10 || Math.abs(dy) < Math.abs(e.clientX - s.x)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    setDrag(Math.max(0, dy));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || !dragging) return;
    const dy = e.clientY - s.y;
    const velocity = dy / Math.max(1, performance.now() - s.t);
    setDragging(false);
    if (dy > 140 || (dy > 40 && velocity > 0.7)) closePlayer();
    else setDrag(0);
  };
  const dragHandlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };

  const goToArtist = () => {
    const artist = track.artists.find((a) => a.id);
    if (!artist?.id) return;
    closePlayer();
    navigate({ name: 'artist', id: artist.id });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col overflow-hidden"
      role="dialog"
      aria-modal
      aria-label="Trình phát"
      style={{
        background: `linear-gradient(to bottom, ${color}, color-mix(in srgb, ${color} 35%, #121212) 70%, #121212)`,
        transform: `translateY(${shown ? drag : window.innerHeight}px)`,
        transition: dragging ? 'none' : 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1), background 600ms'
      }}
    >
      <div className="safe-top shrink-0 touch-none" {...dragHandlers}>
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          <button className="p-2 active:scale-90" aria-label="Thu nhỏ" onClick={closePlayer}>
            <ChevronDown size={28} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-[11px] uppercase tracking-wider text-white/70">{CONTEXT_LABEL[context?.type ?? 'other']}</div>
            <div className="truncate text-[13px] font-bold">{context?.title ?? ''}</div>
          </div>
          <button className="p-2 active:scale-90" aria-label="Tuỳ chọn" onClick={() => openTrackMenu({ track })}>
            <EllipsisVertical size={24} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-6">
        {panel === 'lyrics' ? (
          <LyricsPanel track={track} />
        ) : (
          <div className="flex h-full touch-none items-center justify-center" {...dragHandlers}>
            <TrackArtwork
              track={track}
              eager
              className={`aspect-square w-full max-w-[min(100%,52vh)] shadow-2xl transition-transform duration-500 ${playing ? 'scale-100' : 'scale-[0.88]'}`}
            />
          </div>
        )}
      </div>

      <div className="safe-bottom shrink-0 px-6 pb-4">
        <div className="mt-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[22px] font-bold leading-tight">{track.title}</div>
            <button className="block max-w-full truncate text-[16px] text-white/70 active:text-white" onClick={goToArtist}>
              {joinArtists(track.artists) || 'Không rõ nghệ sĩ'}
            </button>
          </div>
          <button
            className="p-2 active:scale-90"
            aria-label={liked ? 'Bỏ thích' : 'Thích'}
            onClick={() => void toggleLikeWithToast(track)}
          >
            <Heart size={26} className={liked ? 'fill-accent text-accent' : ''} />
          </button>
        </div>

        <div className="mt-3">
          <SeekBar duration={duration} />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button className={`p-2 active:scale-90 ${shuffle ? 'text-accent' : ''}`} aria-label="Trộn bài" aria-pressed={shuffle} onClick={() => void toggleShuffle()}>
            <Shuffle size={24} />
          </button>
          <button className="p-2 active:scale-90" aria-label="Bài trước" onClick={() => void previous()}>
            <SkipBack size={34} fill="white" />
          </button>
          <button
            className="flex size-[68px] items-center justify-center rounded-full bg-white text-black active:scale-95"
            aria-label={playing ? 'Tạm dừng' : 'Phát'}
            onClick={() => void togglePlay()}
          >
            <PlayPauseIcon playing={playing} buffering={buffering} size={32} dark />
          </button>
          <button className="p-2 active:scale-90" aria-label="Bài sau" onClick={() => void next()}>
            <SkipForward size={34} fill="white" />
          </button>
          <button
            className={`p-2 active:scale-90 ${repeat !== 'off' ? 'text-accent' : ''}`}
            aria-label={REPEAT_LABEL[repeat]}
            onClick={() => void cycleRepeat()}
          >
            {repeat === 'one' ? <Repeat1 size={24} /> : <Repeat size={24} />}
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button className={`p-2 active:scale-90 ${sleepActive ? 'text-accent' : 'text-white/80'}`} aria-label="Hẹn giờ tắt" onClick={openSleepTimer}>
            <MoonStar size={22} />
          </button>
          <div className="flex gap-2">
            <button
              className={`p-2 active:scale-90 ${panel === 'lyrics' ? 'text-accent' : 'text-white/80'}`}
              aria-label="Lời bài hát"
              aria-pressed={panel === 'lyrics'}
              onClick={() => setPanel(panel === 'lyrics' ? 'none' : 'lyrics')}
            >
              <MicVocal size={22} />
            </button>
            <button className="p-2 text-white/80 active:scale-90" aria-label="Hàng chờ" onClick={() => setPanel('queue')}>
              <ListMusic size={22} />
            </button>
          </div>
        </div>
      </div>

      <QueueSheet open={panel === 'queue'} onClose={() => setPanel('none')} />
    </div>
  );
}
