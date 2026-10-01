import { memo } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { formatDuration, joinArtists } from '@/lib/format';
import { currentEntry, usePlayer } from '@/player/store';
import { openTrackMenu, type TrackMenuTarget } from '@/ui/overlays';
import type { Track } from '@/youtube/types';
import { Artwork } from './Artwork';
import { Equalizer } from './Equalizer';

interface Props {
  track: Track;
  onPlay: () => void;
  /** số thứ tự thay cho ảnh (trang album) */
  number?: number;
  showDuration?: boolean;
  menu?: Omit<TrackMenuTarget, 'track'>;
}

/** Một dòng bài hát. `content-visibility` giúp danh sách dài cuộn mượt mà không cần ảo hoá. */
export const TrackRow = memo(function TrackRow({ track, onPlay, number, showDuration = false, menu }: Props) {
  const isCurrent = usePlayer((s) => currentEntry(s)?.track.id === track.id);
  const playing = usePlayer((s) => s.playing);
  return (
    <div className="track-row flex items-center gap-3 px-4 py-2 active:bg-white/5">
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onPlay}>
        {number !== undefined ? (
          <span className="w-6 shrink-0 text-center text-sm text-subdued tabular-nums">
            {isCurrent ? <Equalizer playing={playing} /> : number}
          </span>
        ) : (
          <div className="relative size-12 shrink-0">
            <Artwork src={track.thumbnail} className="size-12" />
            {isCurrent && (
              <div className="absolute inset-0 flex items-center justify-center rounded bg-black/50">
                <Equalizer playing={playing} />
              </div>
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[15px] leading-tight ${isCurrent ? 'text-accent' : ''}`}>{track.title}</div>
          <div className="mt-0.5 truncate text-[13px] text-subdued">
            {track.isVideo && <span className="mr-1 rounded-sm bg-subdued/30 px-1 text-[10px] text-white/80">VIDEO</span>}
            {joinArtists(track.artists) || 'Không rõ nghệ sĩ'}
          </div>
        </div>
      </button>
      {showDuration && track.duration > 0 && (
        <span className="text-[13px] text-subdued tabular-nums">{formatDuration(track.duration)}</span>
      )}
      <button
        className="-mr-2 p-2 text-subdued active:text-white"
        aria-label={`Tuỳ chọn cho ${track.title}`}
        onClick={() => openTrackMenu({ track, ...menu })}
      >
        <EllipsisVertical size={20} />
      </button>
    </div>
  );
});
