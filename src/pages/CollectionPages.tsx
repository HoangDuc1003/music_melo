// Các trang danh sách: album, playlist YouTube, playlist của tôi, bài đã thích, lịch sử.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookmarkPlus, EllipsisVertical, Heart, Pencil, Trash2 } from 'lucide-react';
import { CollectionView } from '@/components/CollectionView';
import { Centered, ErrorState, Page, Spinner } from '@/components/Page';
import { Sheet, SheetItem } from '@/components/Sheet';
import { TrackRow } from '@/components/TrackRow';
import { clearHistory, createPlaylist, deletePlaylist, renamePlaylist, useLikedTracks, usePlaylist, useRecentTracks } from '@/lib/library';
import { playTracks } from '@/player/controller';
import { back, navigate } from '@/ui/nav';
import { toast } from '@/ui/overlays';
import { getAlbum, getPlaylist } from '@/youtube/music';

function Loading() {
  return (
    <Page>
      <Spinner className="mt-40" />
    </Page>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <Page solidHeader>
      <ErrorState error={new Error('Không tải được. Kiểm tra kết nối mạng.')} onRetry={onRetry} />
    </Page>
  );
}

export function AlbumPage({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['album', id], queryFn: () => getAlbum(id) });
  if (query.isPending) return <Loading />;
  if (query.isError) return <Failed onRetry={() => void query.refetch()} />;
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
  if (query.isPending) return <Loading />;
  if (query.isError) return <Failed onRetry={() => void query.refetch()} />;
  const playlist = query.data;
  const save = async () => {
    const localId = await createPlaylist(playlist.title, playlist.tracks);
    toast('Đã lưu vào Thư viện');
    navigate({ name: 'localPlaylist', id: localId });
  };
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
  const [name, setName] = useState('');
  if (data === undefined) return <Loading />;
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
        subtitle="Playlist của tôi"
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
      <Sheet open={menu} onClose={() => (setMenu(false), setRenaming(false))} label="Tuỳ chọn playlist">
        {renaming ? (
          <form
            className="flex flex-col gap-4 px-5 pb-6"
            onSubmit={(e) => {
              e.preventDefault();
              void renamePlaylist(id, name).then(() => (setMenu(false), setRenaming(false)));
            }}
          >
            <input
              autoFocus
              maxLength={100}
              className="rounded-md bg-white/10 px-4 py-3 text-[16px] outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="self-center rounded-full bg-accent px-8 py-3 font-bold text-black">
              Lưu
            </button>
          </form>
        ) : (
          <div className="pb-2">
            <SheetItem icon={<Pencil size={22} />} label="Đổi tên" onClick={() => (setName(playlist.name), setRenaming(true))} />
            <SheetItem
              danger
              icon={<Trash2 size={22} />}
              label="Xoá playlist"
              onClick={() => {
                if (!window.confirm(`Xoá playlist “${playlist.name}”?`)) return;
                setMenu(false);
                back();
                void deletePlaylist(id).then(() => toast('Đã xoá playlist'));
              }}
            />
          </div>
        )}
      </Sheet>
    </>
  );
}

export function LikedPage() {
  const tracks = useLikedTracks();
  if (!tracks) return <Loading />;
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
            onClick={() => window.confirm('Xoá toàn bộ lịch sử nghe?') && void clearHistory().then(() => toast('Đã xoá lịch sử'))}
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
