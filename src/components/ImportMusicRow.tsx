// Bản web: thêm file nhạc của mình (app Tệp, iCloud Drive) vào Melo để nghe offline.
import { FolderUp } from 'lucide-react';
import { useRef } from 'react';
import { runAction, toast } from '@/ui/overlays';
import { importAudioFiles } from '@/web/local-files';

export function ImportMusicRow() {
  const input = useRef<HTMLInputElement>(null);
  const onFiles = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (input.current) input.current.value = '';
    if (!files.length) return;
    toast(`Đang thêm ${files.length} file…`);
    void runAction(async () => {
      const { added, skipped } = await importAudioFiles(files);
      if (!added) return toast('Không có bài mới (file đã thêm rồi hoặc không phải file nhạc)');
      toast(`Đã thêm ${added} bài vào Đã tải${skipped ? ` • bỏ qua ${skipped} file` : ''}`);
    });
  };
  return (
    <>
      <button className="flex w-full items-center gap-3 px-4 py-2 text-left active:bg-white/5" onClick={() => input.current?.click()}>
        <div className="flex size-14 shrink-0 items-center justify-center rounded bg-gradient-to-br from-amber-700 to-amber-400">
          <FolderUp size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px]">Thêm nhạc từ máy</div>
          <div className="truncate text-[13px] text-subdued">MP3, M4A… trong app Tệp hoặc iCloud Drive</div>
        </div>
      </button>
      <input ref={input} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus" multiple hidden onChange={(e) => onFiles(e.target.files)} />
    </>
  );
}
