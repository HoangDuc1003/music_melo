// Các trang danh sách: album, playlist YouTube, playlist của tôi, bài đã thích, lịch sử.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookmarkPlus, EllipsisVertical, Heart, Pencil, Trash2 } from 'lucide-react';
import { CollectionView } from '@/components/CollectionView';
import { Centered, Page, PageError, PageLoading } from '@/components/Page';
import { MixCover } from '@/components/MixCard';
import { PlaylistNameForm } from '@/components/PlaylistNameForm';
import { Sheet, SheetItem } from '@/components/Sheet';
import { TrackRow } from '@/components/TrackRow';
import { clearHistory, createPlaylist, deletePlaylist, renamePlaylist, useLikedTracks, usePlaylist, useRecentTracks } from '@/lib/library';
import { getTracks } from '@/lib/db';
import { getMix } from '@/lib/recommend';
import { playTracks } from '@/player/controller';
import { back, navigate } from '@/ui/nav';
import { confirmAction, runAction } from '@/ui/overlays';
import { getAlbum, getPlaylist } from '@/youtube/music';

export function AlbumPage({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['album', id], queryFn: () => getAlbum(id) });
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError onRetry={() => void query.refetch()} />;
  const album = query.data;
  const artist = album.artists.find((a) => a.id);
  return (
    <CollectionView
      title={album.title}
      artwork={album.thumbnail}
      numbered
      tracks={album.tracks}
      context={{ type: 'album', id: album.id, title: album.title }}
      subtitle={
        artist ? (
          <button className="font-semibold text-white active:opacity-70" onClick={() => navigate({ name: 'artist', id: artist.id! })}>
            {album.subtitle}
          </button>
        ) : (
          album.subtitle
        )
      }
    />
  );
}

export function PlaylistPage({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['playlist', id], queryFn: () => getPlaylist(id) });
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError onRetry={() => void query.refetch()} />;
  const playlist = query.data;
  const save = () =>
    runAction(async () => {
      const localId = await createPlaylist(playlist.title, playlist.tracks);
      navigate({ name: 'localPlaylist', id: localId });
    }, 'Đã lưu vào Thư viện');
  return (
    <CollectionView
      title={playlist.title}
      artwork={playlist.thumbnail}
      subtitle={playlist.subtitle}
      description={playlist.description}
      tracks={playlist.tracks}
      context={{ type: 'playlist', id: playlist.id, title: playlist.title }}
      actions={
        <button className="p-2 text-subdued active:scale-90" aria-label="Lưu vào thư viện" onClick={() => void save()}>
          <BookmarkPlus size={26} />
        </button>
      }
    />
  );
}

export function LocalPlaylistPage({ id }: { id: number }) {
  const data = usePlaylist(id);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const closeMenu = () => {
    setMenu(false);
    setRenaming(false);
  };
  if (data === undefined) return <PageLoading />;
  if (data === null) {
    return (
      <Page solidHeader>
        <Centered>Playlist này đã bị xoá.</Centered>
      </Page>
    );
  }
  const { playlist, tracks } = data;
  return (
    <>
      <CollectionView
        title={playlist.name}
        artwork={playlist.cover ?? tracks[0]?.thumbnail}
        subtitle={
          playlist.source === 'spotify'
            ? `Đồng bộ từ Spotify${playlist.unmatched ? ` • ${playlist.unmatched} bài chưa có trên YouTube Music` : ''}`
            : playlist.source === 'youtube'
              ? 'Đồng bộ từ YouTube'
              : 'Playlist của tôi'
        }
        tracks={tracks}
        context={{ type: 'playlist', id: `local-${id}`, title: playlist.name }}
        menuFor={(index) => ({ playlist: { id, index } })}
        actions={
          <button className="p-2 text-subdued active:scale-90" aria-label="Tuỳ chọn playlist" onClick={() => setMenu(true)}>
            <EllipsisVertical size={24} />
          </button>
        }
        empty={<Centered>Playlist trống. Thêm bài bằng nút ⋮ ở mỗi bài hát.</Centered>}
      />
      <Sheet open={menu} onClose={closeMenu} label="Tuỳ chọn playlist">
        {renaming ? (
          <div className="px-5 pb-6">
            <PlaylistNameForm initial={playlist.name} submitLabel="Lưu" onSubmit={(name) => void runAction(() => renamePlaylist(id, name)).finally(closeMenu)} />
          </div>
        ) : (
          <div className="pb-2">
            <SheetItem icon={<Pencil size={22} />} label="Đổi tên" onClick={() => setRenaming(true)} />
            <SheetItem
              danger
              icon={<Trash2 size={22} />}
              label="Xoá playlist"
              onClick={() =>
                confirmAction(
                  `Xoá playlist “${playlist.name}”?`,
                  () => {
                    setMenu(false);
                    back();
                    return deletePlaylist(id);
                  },
                  'Đã xoá playlist'
                )
              }
            />
          </div>
        )}
      </Sheet>
    </>
  );
}

/** Mix "Dành cho bạn" (Daily Mix, Khám phá hằng tuần…). */
export function MixPage({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const mix = await getMix(id);
    return mix ? { mix, tracks: await getTracks(mix.trackIds) } : null;
  }, [id]);
  if (data === undefined) return <PageLoading />;
  if (data === null) {
    return (
      <Page solidHeader>
        <Centered>Mix này đã được làm mới. Về Trang chủ để xem mix hôm nay.</Centered>
      </Page>
    );
  }
  const { mix, tracks } = data;
  return (
    <CollectionView
      title={mix.title}
      subtitle={mix.subtitle}
      artwork={mix.cover}
      cover={<MixCover mix={mix} className="w-[62%] max-w-72 shadow-2xl" />}
      tracks={tracks}
      context={{ type: 'playlist', id: `mix-${mix.id}`, title: mix.title }}
    />
  );
}

export function LikedPage() {
  const tracks = useLikedTracks();
  if (!tracks) return <PageLoading />;
  return (
    <CollectionView
      title="Bài hát đã thích"
      tracks={tracks}
      context={{ type: 'library', id: 'liked', title: 'Bài hát đã thích' }}
      cover={
        <div className="flex aspect-square w-[62%] max-w-72 items-center justify-center rounded bg-gradient-to-br from-indigo-700 to-sky-300 shadow-2xl">
          <Heart size={72} fill="white" />
        </div>
      }
      empty={<Centered>Bấm ♡ ở trình phát hoặc menu ⋮ của bài hát để thêm vào đây.</Centered>}
    />
  );
}

export function HistoryPage() {
  const tracks = useRecentTracks(200);
  return (
    <Page title="Đã nghe gần đây" solidHeader>
      <div className="flex items-center justify-between px-4 pt-2 pb-2">
        <h1 className="text-[24px] font-bold">Đã nghe gần đây</h1>
        {tracks && tracks.length > 0 && (
          <button
            className="text-[13px] text-subdued"
            onClick={() => confirmAction('Xoá toàn bộ lịch sử nghe?', clearHistory, 'Đã xoá lịch sử nghe')}
          >
            Xoá
          </button>
        )}
      </div>
      {tracks?.length === 0 && <Centered>Chưa nghe bài nào.</Centered>}
      {tracks?.map((track, i) => (
        <TrackRow key={track.id} track={track} onPlay={() => void playTracks(tracks, i, { context: { type: 'library', id: 'history', title: 'Đã nghe gần đây' } })} />
      ))}
    </Page>
  );
}
