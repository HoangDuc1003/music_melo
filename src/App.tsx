// Màn hình KHUNG tạm thời: tìm kiếm + phát thử để kiểm tra toàn bộ chuỗi
// (proxy dev → youtubei.js → lấy link → plugin phát nhạc). Giao diện Spotify đầy đủ làm ở GĐ3 (docs/PLAN.md).
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, Search } from 'lucide-react';
import { MeloPlayer, type PlayerState } from 'capacitor-melo-player';
import { formatDuration, joinArtists } from '@/lib/format';
import { log } from '@/lib/log';
import { search } from '@/youtube/music';
import { resolveAudio } from '@/youtube/stream';
import type { Track } from '@/youtube/types';

export default function App() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<Track>();
  const [state, setState] = useState<PlayerState>();
  const [error, setError] = useState<string>();

  const results = useQuery({
    queryKey: ['search', 'song', query],
    queryFn: () => search(query, 'song'),
    enabled: query.length > 0
  });

  useEffect(() => {
    // Hàm riêng cho mỗi lần gắn: Capacitor gỡ listener theo tham chiếu hàm, nếu dùng chung setState
    // thì lần gỡ (bất đồng bộ) của StrictMode sẽ xoá luôn listener vừa gắn lại.
    const handle = MeloPlayer.addListener('state', (s) => setState(s));
    return () => void handle.then((h) => h.remove());
  }, []);

  async function play(track: Track) {
    setError(undefined);
    setCurrent(track);
    try {
      const audio = await resolveAudio(track.id);
      await MeloPlayer.setQueue({
        items: [
          {
            id: track.id,
            url: audio.url,
            title: track.title,
            artist: joinArtists(track.artists),
            album: track.album?.name,
            artwork: track.thumbnail,
            duration: track.duration
          }
        ],
        startIndex: 0
      });
    } catch (err) {
      log.error('app', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const tracks = (results.data ?? []).flatMap((item) => (item.type === 'track' ? [item.track] : []));

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top bg-gradient-to-b from-emerald-900/60 to-base px-4 pb-3">
        <h1 className="pt-4 text-2xl font-bold">Melo</h1>
        <form
          className="mt-3 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-black"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(input.trim());
          }}
        >
          <Search size={20} />
          <input
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-neutral-500"
            placeholder="Bạn muốn nghe gì?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </form>
      </header>

      <main className="no-scrollbar flex-1 overflow-y-auto px-2 pb-28">
        {results.isFetching && <p className="p-4 text-subdued">Đang tìm…</p>}
        {results.error && <p className="p-4 text-red-400">Lỗi: {String(results.error)}</p>}
        {error && <p className="p-4 text-red-400">{error}</p>}
        {tracks.map((track) => (
          <button
            key={track.id}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left active:bg-highlight"
            onClick={() => void play(track)}
          >
            <img src={track.thumbnail} alt="" className="size-12 shrink-0 rounded object-cover" loading="lazy" />
            <div className="min-w-0 flex-1">
              <div className={`truncate text-[15px] ${current?.id === track.id ? 'text-accent' : ''}`}>{track.title}</div>
              <div className="truncate text-[13px] text-subdued">{joinArtists(track.artists)}</div>
            </div>
            <span className="text-[13px] text-subdued">{formatDuration(track.duration)}</span>
          </button>
        ))}
      </main>

      {current && (
        <footer className="safe-bottom fixed inset-x-2 bottom-2 rounded-lg bg-[#2a2a2a] p-2 shadow-xl">
          <div className="flex items-center gap-3">
            <img src={current.thumbnail} alt="" className="size-10 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{current.title}</div>
              <div className="truncate text-xs text-subdued">{joinArtists(current.artists)}</div>
            </div>
            <button
              className="p-2"
              aria-label={state?.playing ? 'Tạm dừng' : 'Phát'}
              onClick={() => void (state?.playing ? MeloPlayer.pause() : MeloPlayer.play())}
            >
              {state?.playing ? <Pause fill="white" /> : <Play fill="white" />}
            </button>
          </div>
          <div className="mt-2 h-0.5 rounded bg-white/20">
            <div
              className="h-full rounded bg-white"
              style={{ width: `${state?.duration ? (state.position / state.duration) * 100 : 0}%` }}
            />
          </div>
        </footer>
      )}
    </div>
  );
}
