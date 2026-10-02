import { pause, play, playTracks } from '@/player/controller';
import type { PlayContext } from '@/player/queue';
import { usePlayer } from '@/player/store';
import type { Track } from '@/youtube/types';
import { PlayPauseIcon } from './PlayPauseIcon';

function sameContext(a: PlayContext | undefined, b: PlayContext): boolean {
  return Boolean(a && a.type === b.type && a.id === b.id && a.title === b.title);
}

/** Nút Phát lớn của album/playlist/nghệ sĩ: đang phát đúng danh sách này thì tạm dừng/tiếp tục, không thì phát từ bài đầu. */
export function PlayContextButton({ tracks, context }: { tracks: Track[]; context: PlayContext }) {
  const isThis = usePlayer((s) => sameContext(s.context, context));
  const playing = usePlayer((s) => s.playing) && isThis;
  const onClick = () => {
    if (isThis) void (playing ? pause() : play());
    else void playTracks(tracks, 0, { context, shuffle: false });
  };
  return (
    <button
      className="flex size-14 items-center justify-center rounded-full bg-accent text-black shadow-lg active:scale-95"
      aria-label={playing ? 'Tạm dừng' : 'Phát'}
      onClick={onClick}
    >
      <PlayPauseIcon playing={playing} size={26} dark />
    </button>
  );
}
