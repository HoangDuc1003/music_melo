import { useState } from 'react';
import { Plus } from 'lucide-react';
import { addToPlaylist, createPlaylist, usePlaylists } from '@/lib/library';
import { log } from '@/lib/log';
import { closePlaylistPicker, toast, useOverlays } from '@/ui/overlays';
import { Artwork } from './Artwork';
import { Sheet } from './Sheet';

/** Chọn playlist để thêm bài (hoặc tạo playlist mới ngay tại đây). */
export function PlaylistPicker() {
  const tracks = useOverlays((s) => s.picker);
  const playlists = usePlaylists();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const close = () => {
    setCreating(false);
    setName('');
    closePlaylistPicker();
  };

  const add = async (id: number, playlistName: string) => {
    if (!tracks) return;
    try {
      const added = await addToPlaylist(id, tracks);
      toast(added ? `Đã thêm vào ${playlistName}` : `Đã có trong ${playlistName}`);
    } catch (err) {
      log.error('playlist', err);
      toast('Không thêm được vào playlist');
    }
    close();
  };

  const create = async () => {
    if (!tracks) return;
    const playlistName = name.trim() || 'Playlist của tôi';
    await createPlaylist(playlistName, tracks);
    toast(`Đã tạo ${playlistName}`);
    close();
  };

  return (
    <Sheet open={Boolean(tracks)} onClose={close} label="Thêm vào playlist">
      <div className="px-5 pb-4">
        <h2 className="pb-3 text-center text-[17px] font-bold">Thêm vào playlist</h2>
        {creating ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              autoFocus
              maxLength={100}
              className="rounded-md bg-white/10 px-4 py-3 text-[16px] outline-none focus:bg-white/15"
              placeholder="Tên playlist"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="self-center rounded-full bg-accent px-8 py-3 font-bold text-black active:scale-95" type="submit">
              Tạo
            </button>
          </form>
        ) : (
          <>
            <button className="mx-auto mb-3 block rounded-full bg-white px-6 py-2.5 text-[14px] font-bold text-black active:scale-95" onClick={() => setCreating(true)}>
              <Plus size={16} className="mr-1 inline" /> Playlist mới
            </button>
            {(playlists ?? []).map((p) => (
              <button key={p.id} className="flex w-full items-center gap-3 py-2 text-left active:opacity-70" onClick={() => void add(p.id!, p.name)}>
                <Artwork src={p.cover} size={48} className="size-12" />
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{p.name}</div>
                  <div className="text-[13px] text-subdued">{p.trackIds.length} bài</div>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </Sheet>
  );
}
