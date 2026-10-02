// Bản web, trang Đã tải: các bài YouTube đã mở trang chuyển đổi, đang chờ người dùng chọn file MP3 vừa tải.
import { useLiveQuery } from 'dexie-react-hooks';
import { FolderUp, X } from 'lucide-react';
import { joinArtists } from '@/lib/format';
import { runAction } from '@/ui/overlays';
import { chooseFileFor } from '@/ui/youtube-files';
import { getPendingTracks, removePending } from '@/web/youtube-files';
import { TrackArtwork } from './TrackArtwork';

export function PendingVideos() {
  const pending = useLiveQuery(getPendingTracks, []);
  if (!pending?.length) return null;
  return (
    <section className="pb-4">
      <h2 className="px-4 pt-2 text-[17px] font-bold">Chờ file từ trang chuyển đổi ({pending.length})</h2>
      <p className="px-4 pb-1 text-[12px] text-subdued">
        Tải MP3 xong thì bấm “Chọn file” (file nằm trong app Tệp → Tải về), hoặc chọn nhiều file một lúc ở Thư viện → Thêm nhạc từ máy: Melo tự
        gắn file vào đúng bài.
      </p>
      {pending.map((track) => (
        <div key={track.id} className="flex items-center gap-3 px-4 py-2">
          <TrackArtwork track={track} size={48} className="size-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px]">{track.title}</div>
            <div className="truncate text-[12px] text-subdued">{joinArtists(track.artists)}</div>
          </div>
          <button className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[13px] active:bg-white/20" onClick={() => chooseFileFor(track)}>
            <FolderUp size={16} /> Chọn file
          </button>
          <button className="p-2 text-subdued" aria-label={`Thôi chờ file ${track.title}`} onClick={() => void runAction(() => removePending(track.id))}>
            <X size={18} />
          </button>
        </div>
      ))}
    </section>
  );
}
