import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { addToPlaylist, createPlaylist, usePlaylists } from '@/lib/library';
import { closePlaylistPicker, runAction, toast, useOverlays } from '@/ui/overlays';
import type { Track } from '@/youtube/types';
import { Artwork } from './Artwork';
import { PlaylistNameForm } from './PlaylistNameForm';
import { Sheet } from './Sheet';

/** Chọn playlist để thêm bài (hoặc tạo playlist mới ngay tại đây). */
export function PlaylistPicker() {
  const tracks = useOverlays((s) => s.picker);
  // Giữ danh sách bài cũ trong lúc bảng trượt xuống đóng.
  const last = useRef<Track[]>([]);
  if (tracks) last.current = tracks;
  return (
    <Sheet open={Boolean(tracks)} onClose={closePlaylistPicker} label="Thêm vào playlist">
      {/* Sheet chỉ gắn nội dung khi đang mở → chỉ đọc danh sách playlist lúc cần. */}
      <PickerContent tracks={last.current} />
    </Sheet>
  );
}

function PickerContent({ tracks }: { tracks: Track[] }) {
  const playlists = usePlaylists();
  const [creating, setCreating] = useState(false);

  const add = (id: number, playlistName: string) =>
    runAction(async () => {
      const added = await addToPlaylist(id, tracks);
      toast(added ? `Đã thêm vào ${playlistName}` : `Đã có trong ${playlistName}`);
    }).finally(closePlaylistPicker);

  const create = (name: string) => runAction(() => createPlaylist(name, tracks), 'Đã tạo playlist').finally(closePlaylistPicker);

  return (
    <div className="px-5 pb-4">
      <h2 className="pb-3 text-center text-[17px] font-bold">Thêm vào playlist</h2>
      {creating ? (
        <PlaylistNameForm submitLabel="Tạo" onSubmit={(name) => void create(name)} />
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
  );
}
