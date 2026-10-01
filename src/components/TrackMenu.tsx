import { Disc3, Heart, HeartOff, ListEnd, ListMinus, ListPlus, ListStart, Radio, UserRound } from 'lucide-react';
import { joinArtists } from '@/lib/format';
import { removeFromPlaylist, toggleLike, useIsLiked } from '@/lib/library';
import { log } from '@/lib/log';
import { addToQueue, playNext, playRadio, removeAt } from '@/player/controller';
import { usePlayer } from '@/player/store';
import { navigate } from '@/ui/nav';
import { closePlayer, closeTrackMenu, openPlaylistPicker, toast, useOverlays } from '@/ui/overlays';
import { Artwork } from './Artwork';
import { Sheet, SheetItem } from './Sheet';

function run(action: () => Promise<unknown> | unknown, done?: string) {
  closeTrackMenu();
  Promise.resolve()
    .then(action)
    .then(() => done && toast(done))
    .catch((err) => {
      log.error('menu', err);
      toast(err instanceof Error ? err.message : 'Có lỗi xảy ra');
    });
}

/** Menu của một bài: Phát tiếp · Thêm vào hàng chờ · Thích · Thêm vào playlist · Radio · Album · Nghệ sĩ. */
export function TrackMenu() {
  const target = useOverlays((s) => s.menu);
  const liked = useIsLiked(target?.track.id);
  const currentIndex = usePlayer((s) => s.index);
  const track = target?.track;

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
            <Artwork src={track.thumbnail} className="size-12" />
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
            onClick={() => run(async () => toast((await toggleLike(track)) ? 'Đã thêm vào Bài hát đã thích' : 'Đã bỏ thích'))}
          />
          <SheetItem icon={<ListPlus size={22} />} label="Thêm vào playlist" onClick={() => openPlaylistPicker([track])} />
          <SheetItem icon={<Radio size={22} />} label="Phát radio từ bài này" onClick={() => run(() => playRadio(track))} />
          {target.queueIndex !== undefined && target.queueIndex !== currentIndex && (
            <SheetItem icon={<ListMinus size={22} />} label="Xoá khỏi hàng chờ" onClick={() => run(() => removeAt(target.queueIndex!))} />
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
