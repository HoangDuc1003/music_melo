// Bản web: các thao tác người dùng bấm trong luồng "tải MP3 YouTube qua trang chuyển đổi" (xem web/youtube-files.ts).
import { attachFileToTrack, AUDIO_ACCEPT } from '@/web/local-files';
import { converterLink, markPending, watchUrl } from '@/web/youtube-files';
import type { Track } from '@/youtube/types';
import { copyText, runAction } from './overlays';
import { pickFiles } from './pick-files';

/**
 * Mở trang chuyển đổi (đã nhập trong Cài đặt) với link video, copy sẵn link để dán, đánh dấu bài đang chờ file.
 * `template` phải có sẵn lúc bấm: Safari chặn cửa sổ mở sau khi chờ đọc dữ liệu.
 */
export function downloadViaConverter(track: Track, template: string | undefined) {
  if (template) window.open(converterLink(template, track.id), '_blank', 'noopener');
  copyText(
    watchUrl(track.id),
    template
      ? 'Đã copy link video. Tải MP3 xong, quay lại Melo chọn file (Đã tải → Chờ file)'
      : 'Đã copy link video. Chưa có trang tải MP3: vào Cài đặt → Nguồn nhạc để nhập',
    'Không copy được link video'
  );
  void runAction(() => markPending(track));
}

/** Chọn file đã tải cho đúng bài này. */
export function chooseFileFor(track: Track) {
  void pickFiles({ accept: AUDIO_ACCEPT }).then(([file]) => {
    if (file) return runAction(() => attachFileToTrack(track, file), 'Đã lưu file: bài này nghe offline được');
  });
}
