import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownToLine, CircleX, Disc3, FolderUp, Heart, HeartOff, ListEnd, ListMinus, ListPlus, ListStart, Radio, UserRound } from 'lucide-react';
import { enqueueDownloads, removeDownload, retryDownload, useDownloads } from '@/downloads/manager';
import { joinArtists } from '@/lib/format';
import { removeFromPlaylist, useIsLiked } from '@/lib/library';
import { addToQueue, playNext, playRadio, removeAt } from '@/player/controller';
import { usePlayer } from '@/player/store';
import { navigate } from '@/ui/nav';
import { chooseFileFor, downloadViaConverter } from '@/ui/youtube-files';
import { getConverterUrl, isYouTubeVideo } from '@/web/youtube-files';
import { canDownload } from '@/youtube/stream';
import { closePlayer, closeTrackMenu, openPlaylistPicker, runAction, toggleLikeWithToast, useOverlays } from '@/ui/overlays';
import { TrackArtwork } from './TrackArtwork';
import { Sheet, SheetItem } from './Sheet';

function run(action: () => unknown, done?: string) {
  closeTrackMenu();
  void runAction(action, done);
}

/** Menu của một bài: Phát tiếp · Thêm vào hàng chờ · Thích · Thêm vào playlist · Radio · Album · Nghệ sĩ. */
export function TrackMenu() {
  const target = useOverlays((s) => s.menu);
  const liked = useIsLiked(target?.track.id);
  const currentIndex = usePlayer((s) => s.index);
  const track = target?.track;
  const download = useDownloads((s) => (track ? s.rows.get(track.id) : undefined));
  // Bản web: trang chuyển đổi để tải MP3 của video YouTube (đọc trước, vì phải mở trang ngay lúc bấm).
  const converter = useLiveQuery(() => (__WEB_APP__ ? getConverterUrl() : undefined), []);

  const goTo = (route: Parameters<typeof navigate>[0]) =>
    run(() => {
      closePlayer();
      navigate(route);
    });

  return (
    <Sheet open={Boolean(target)} onClose={closeTrackMenu} label="Tuỳ chọn bài hát">
      {track && (
        <div className="pb-2">
          <div className="flex items-center gap-3 border-b border-white/10 px-5 pb-4">
            <TrackArtwork track={track} size={48} className="size-12" />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">{track.title}</div>
              <div className="truncate text-[13px] text-subdued">{joinArtists(track.artists)}</div>
            </div>
          </div>
          <SheetItem icon={<ListStart size={22} />} label="Phát tiếp" onClick={() => run(() => playNext([track]), 'Sẽ phát tiếp')} />
          <SheetItem icon={<ListEnd size={22} />} label="Thêm vào hàng chờ" onClick={() => run(() => addToQueue([track]), 'Đã thêm vào hàng chờ')} />
          <SheetItem
            icon={liked ? <HeartOff size={22} /> : <Heart size={22} />}
            label={liked ? 'Bỏ thích' : 'Thích'}
            onClick={() => {
              closeTrackMenu();
              void toggleLikeWithToast(track);
            }}
          />
          <SheetItem icon={<ListPlus size={22} />} label="Thêm vào playlist" onClick={() => openPlaylistPicker([track])} />
          {!download && canDownload(track.id) && (
            <SheetItem icon={<ArrowDownToLine size={22} />} label="Tải về" onClick={() => run(() => enqueueDownloads([track]), 'Đang tải về máy')} />
          )}
          {__WEB_APP__ && !download && isYouTubeVideo(track.id) && (
            <>
              <SheetItem
                icon={<ArrowDownToLine size={22} />}
                label="Tải MP3 qua trang chuyển đổi"
                onClick={() => {
                  closeTrackMenu();
                  downloadViaConverter(track, converter);
                }}
              />
              <SheetItem
                icon={<FolderUp size={22} />}
                label="Chọn file đã tải cho bài này"
                onClick={() => {
                  closeTrackMenu();
                  chooseFileFor(track);
                }}
              />
            </>
          )}
          {download?.status === 'error' && (
            <SheetItem icon={<ArrowDownToLine size={22} />} label="Tải lại (lần trước lỗi)" onClick={() => run(() => retryDownload(track.id), 'Đang tải lại')} />
          )}
          {download && download.status !== 'error' && (
            <SheetItem
              icon={<CircleX size={22} />}
              label={download.status === 'done' ? 'Xoá bản đã tải' : 'Huỷ tải'}
              onClick={() => run(() => removeDownload(track.id), download.status === 'done' ? 'Đã xoá bản tải' : 'Đã huỷ tải')}
            />
          )}
          <SheetItem icon={<Radio size={22} />} label="Phát radio từ bài này" onClick={() => run(() => playRadio(track))} />
          {target.queueIndex !== undefined && target.queueIndex !== currentIndex && (
            <SheetItem icon={<ListMinus size={22} />} label="Xoá khỏi hàng chờ" onClick={() => run(() => removeAt(target.queueIndex!, target.queueUid))} />
          )}
          {target.playlist && (
            <SheetItem
              icon={<ListMinus size={22} />}
              label="Xoá khỏi playlist này"
              onClick={() => run(() => removeFromPlaylist(target.playlist!.id, target.playlist!.index), 'Đã xoá khỏi playlist')}
            />
          )}
          {track.album?.id && (
            <SheetItem icon={<Disc3 size={22} />} label="Đi tới album" onClick={() => goTo({ name: 'album', id: track.album!.id! })} />
          )}
          {track.artists
            .filter((a) => a.id)
            .slice(0, 3)
            .map((artist) => (
              <SheetItem
                key={artist.id}
                icon={<UserRound size={22} />}
                label={`Đi tới nghệ sĩ: ${artist.name}`}
                onClick={() => goTo({ name: 'artist', id: artist.id! })}
              />
            ))}
        </div>
      )}
    </Sheet>
  );
}
