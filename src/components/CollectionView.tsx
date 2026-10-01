import type { ReactNode } from 'react';
import { Pause, Play, Shuffle } from 'lucide-react';
import { formatTotalDuration } from '@/lib/format';
import { pause, play, playTracks } from '@/player/controller';
import type { PlayContext } from '@/player/queue';
import { usePlayer } from '@/player/store';
import { useArtworkColor } from '@/ui/hooks';
import type { TrackMenuTarget } from '@/ui/overlays';
import type { Track } from '@/youtube/types';
import { Artwork } from './Artwork';
import { Page } from './Page';
import { TrackRow } from './TrackRow';

interface Props {
  title: string;
  subtitle?: ReactNode;
  description?: string;
  artwork?: string;
  /** ô màu thay cho ảnh (Bài hát đã thích) */
  cover?: ReactNode;
  tracks: Track[];
  context: PlayContext;
  /** đánh số thay cho ảnh nhỏ (album) */
  numbered?: boolean;
  /** nút thêm ở hàng hành động (lưu, tải…) */
  actions?: ReactNode;
  headerRight?: ReactNode;
  menuFor?: (index: number) => Omit<TrackMenuTarget, 'track'>;
  empty?: ReactNode;
}

function sameContext(a: PlayContext | undefined, b: PlayContext): boolean {
  return Boolean(a && a.type === b.type && a.id === b.id && a.title === b.title);
}

/** Trang danh sách bài: album, playlist, bài đã thích… (phần đầu lớn, nút Phát/Trộn bài, danh sách). */
export function CollectionView({ title, subtitle, description, artwork, cover, tracks, context, numbered, actions, headerRight, menuFor, empty }: Props) {
  const color = useArtworkColor(artwork, title);
  const isThis = usePlayer((s) => sameContext(s.context, context));
  const playing = usePlayer((s) => s.playing);
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

  const onPlay = () => {
    if (isThis) return void (playing ? pause() : play());
    void playTracks(tracks, 0, { context, shuffle: false });
  };
  const onShuffle = () => void playTracks(tracks, Math.floor(Math.random() * tracks.length), { context, shuffle: true });

  return (
    <Page title={title} color={color} right={headerRight}>
      <div className="flex flex-col items-center px-4 pt-2">
        {cover ?? <Artwork src={artwork} eager className="aspect-square w-[62%] max-w-72 shadow-[0_8px_40px_rgba(0,0,0,0.5)]" />}
      </div>
      <div className="px-4 pt-5">
        <h1 className="text-[24px] font-bold leading-tight">{title}</h1>
        {subtitle && <div className="mt-1.5 text-[13px] text-subdued">{subtitle}</div>}
        {description && <p className="mt-2 line-clamp-3 text-[13px] text-subdued">{description}</p>}
        {tracks.length > 0 && (
          <div className="mt-1 text-[13px] text-subdued">
            {tracks.length} bài{total > 0 ? ` • ${formatTotalDuration(total)}` : ''}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="flex flex-1 items-center gap-1">{actions}</div>
        {tracks.length > 0 && (
          <>
            <button className="p-2 text-subdued active:scale-90" aria-label="Phát ngẫu nhiên" onClick={onShuffle}>
              <Shuffle size={26} />
            </button>
            <button
              className="flex size-14 items-center justify-center rounded-full bg-accent text-black shadow-lg active:scale-95"
              aria-label={isThis && playing ? 'Tạm dừng' : 'Phát'}
              onClick={onPlay}
            >
              {isThis && playing ? <Pause size={26} fill="black" strokeWidth={0} /> : <Play size={26} fill="black" strokeWidth={0} className="ml-0.5" />}
            </button>
          </>
        )}
      </div>
      {tracks.length === 0 && empty}
      <div>
        {tracks.map((track, i) => (
          <TrackRow
            key={`${track.id}-${i}`}
            track={track}
            number={numbered ? i + 1 : undefined}
            showDuration={numbered}
            menu={menuFor?.(i)}
            onPlay={() => void playTracks(tracks, i, { context })}
          />
        ))}
      </div>
    </Page>
  );
}
