import { useState } from 'react';
import { ChevronRight, Download, Heart, History, Plus, Settings } from 'lucide-react';
import { Artwork } from '@/components/Artwork';
import { ImportMusicRow } from '@/components/ImportMusicRow';
import { Page, RootTitle } from '@/components/Page';
import { PlaylistNameForm } from '@/components/PlaylistNameForm';
import { Sheet } from '@/components/Sheet';
import type { PlaylistRow } from '@/lib/db';
import { createPlaylist, useLikedCount, usePlaylists } from '@/lib/library';
import { navigate, type Route } from '@/ui/nav';
import { runAction } from '@/ui/overlays';

const SOURCE_LABEL: Record<PlaylistRow['source'], string> = { local: 'Playlist', spotify: 'Từ Spotify', youtube: 'Từ YouTube' };

function Row({ icon, title, subtitle, route }: { icon: React.ReactNode; title: string; subtitle: string; route: Route }) {
  return (
    <button className="flex w-full items-center gap-3 px-4 py-2 text-left active:bg-white/5" onClick={() => navigate(route)}>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px]">{title}</div>
        <div className="truncate text-[13px] text-subdued">{subtitle}</div>
      </div>
      <ChevronRight size={18} className="text-subdued" />
    </button>
  );
}

function CreatePlaylistSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = (name: string) =>
    runAction(async () => {
      const id = await createPlaylist(name);
      onClose();
      navigate({ name: 'localPlaylist', id });
    }, 'Đã tạo playlist');
  return (
    <Sheet open={open} onClose={onClose} label="Tạo playlist">
      <div className="px-5 pb-6">
        <PlaylistNameForm title="Đặt tên cho playlist" submitLabel="Tạo" onSubmit={(name) => void create(name)} />
      </div>
    </Sheet>
  );
}

export function LibraryPage() {
  const playlists = usePlaylists();
  const likedCount = useLikedCount();
  const [creating, setCreating] = useState(false);

  return (
    <Page>
      <RootTitle
        right={
          <div className="flex gap-3">
            <button className="p-1 active:scale-90" aria-label="Tạo playlist" onClick={() => setCreating(true)}>
              <Plus size={26} />
            </button>
            <button className="p-1 active:scale-90" aria-label="Cài đặt" onClick={() => navigate({ name: 'settings' })}>
              <Settings size={24} />
            </button>
          </div>
        }
      >
        Thư viện
      </RootTitle>

      <Row
        route={{ name: 'liked' }}
        title="Bài hát đã thích"
        subtitle={`${likedCount} bài`}
        icon={
          <div className="flex size-14 shrink-0 items-center justify-center rounded bg-gradient-to-br from-indigo-700 to-sky-300">
            <Heart size={24} fill="white" />
          </div>
        }
      />
      <Row
        route={{ name: 'downloads' }}
        title="Đã tải"
        subtitle="Nghe khi không có mạng"
        icon={
          <div className="flex size-14 shrink-0 items-center justify-center rounded bg-gradient-to-br from-emerald-800 to-emerald-400">
            <Download size={24} />
          </div>
        }
      />
      {__WEB_APP__ && <ImportMusicRow />}
      <Row
        route={{ name: 'history' }}
        title="Đã nghe gần đây"
        subtitle="Lịch sử nghe"
        icon={
          <div className="flex size-14 shrink-0 items-center justify-center rounded bg-highlight">
            <History size={24} />
          </div>
        }
      />

      <h2 className="px-4 pt-6 pb-1 text-[17px] font-bold">Playlist của tôi</h2>
      {playlists?.map((p) => (
        <Row
          key={p.id}
          route={{ name: 'localPlaylist', id: p.id! }}
          title={p.name}
          subtitle={`${SOURCE_LABEL[p.source]} • ${p.trackIds.length} bài`}
          icon={<Artwork src={p.cover} size={56} className="size-14 shrink-0" />}
        />
      ))}
      {playlists && playlists.length === 0 && (
        <button className="mx-4 mt-2 flex items-center gap-3 rounded-md py-2 text-left text-subdued active:opacity-70" onClick={() => setCreating(true)}>
          <div className="flex size-14 items-center justify-center rounded bg-highlight">
            <Plus size={24} />
          </div>
          Tạo playlist đầu tiên
        </button>
      )}
      <CreatePlaylistSheet open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
