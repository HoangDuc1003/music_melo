import type { ReactNode } from 'react';
import { ArrowDown, ArrowDownToLine, Shuffle } from 'lucide-react';
import { enqueueDownloads, removeDownloads, useDownloads } from '@/downloads/manager';
import { formatTotalDuration } from '@/lib/format';
import { playTracks } from '@/player/controller';
import type { PlayContext } from '@/player/queue';
import { useArtworkColor } from '@/ui/hooks';
import { confirmAction, runAction, toast, type TrackMenuTarget } from '@/ui/overlays';
import { canDownload } from '@/youtube/stream';
import type { Track } from '@/youtube/types';
import { Artwork } from './Artwork';
import { Page } from './Page';
import { PlayContextButton } from './PlayContextButton';
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
  menuFor?: (index: number) => Omit<TrackMenuTarget, 'track'>;
  empty?: ReactNode;
  /** ẩn nút "Tải tất cả" (trang Đã tải) */
  hideDownload?: boolean;
  /** nội dung thêm giữa hàng nút và danh sách bài */
  children?: ReactNode;
}

/** Trang danh sách bài: album, playlist, bài đã thích… (phần đầu lớn, nút Phát/Trộn bài, danh sách). */
export function CollectionView({
  title,
  subtitle,
  description,
  artwork,
  cover,
  tracks,
  context,
  numbered,
  actions,
  menuFor,
  empty,
  hideDownload = false,
  children
}: Props) {
  const color = useArtworkColor(artwork, title);
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  // Video YouTube ở bản web không tải được: nút "Tải tất cả" chỉ tính các bài tải được.
  const downloadable = tracks.filter((t) => canDownload(t.id));
  const downloaded = useDownloads((s) => downloadable.filter((t) => s.rows.get(t.id)?.status === 'done').length);
  const pending = useDownloads((s) => downloadable.filter((t) => ['queued', 'downloading'].includes(s.rows.get(t.id)?.status ?? '')).length);
  const allDownloaded = downloadable.length > 0 && downloaded === downloadable.length;

  const onDownload = () => {
    if (allDownloaded) {
      confirmAction('Xoá các bài đã tải của danh sách này khỏi máy?', () => removeDownloads(downloadable.map((t) => t.id)), 'Đã xoá bản tải');
    } else {
      void runAction(async () => {
        const n = await enqueueDownloads(downloadable);
        toast(n ? `Đang tải ${n} bài về máy` : 'Các bài đang được tải');
      });
    }
  };
  const onShuffle = () => void playTracks(tracks, Math.floor(Math.random() * tracks.length), { context, shuffle: true });

  return (
    <Page title={title} color={color}>
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
        <div className="flex flex-1 items-center gap-1">
          {downloadable.length > 0 && !hideDownload && (
            <button
              className={`relative p-2 active:scale-90 ${allDownloaded ? 'text-accent' : 'text-subdued'}`}
              aria-label={allDownloaded ? 'Đã tải tất cả (bấm để xoá)' : 'Tải tất cả'}
              onClick={onDownload}
            >
              {allDownloaded ? (
                <span className="flex size-[26px] items-center justify-center rounded-full bg-accent">
                  <ArrowDown size={18} strokeWidth={3} className="text-black" />
                </span>
              ) : (
                <ArrowDownToLine size={26} />
              )}
              {pending > 0 && (
                <span className="absolute -top-0.5 -right-0.5 rounded-full bg-accent px-1 text-[10px] font-bold text-black">{pending}</span>
              )}
            </button>
          )}
          {actions}
        </div>
        {tracks.length > 0 && (
          <>
            <button className="p-2 text-subdued active:scale-90" aria-label="Phát ngẫu nhiên" onClick={onShuffle}>
              <Shuffle size={26} />
            </button>
            <PlayContextButton tracks={tracks} context={context} />
          </>
        )}
      </div>
      {children}
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
