import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { activeLineIndex, getLyrics } from '@/lib/lyrics';
import { seekTo } from '@/player/controller';
import type { Track } from '@/youtube/types';
import { Spinner } from './Page';

/** Lời bài hát: dòng đang hát sáng lên và tự cuộn vào giữa; chạm một dòng để tua tới đó. */
export function LyricsPanel({ track, position }: { track: Track; position: number }) {
  const query = useQuery({
    queryKey: ['lyrics', track.id],
    queryFn: async () => (await getLyrics(track)) ?? null,
    staleTime: Infinity
  });
  const lines = query.data?.synced;
  const active = useMemo(() => (lines ? activeLineIndex(lines, position) : -1), [lines, position]);
  const container = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);

  useEffect(() => {
    if (active < 0 || Date.now() - userScrolledAt.current < 3000) return;
    const el = container.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  if (query.isPending) return <Spinner className="mt-24" />;
  if (query.isError) return <p className="mt-24 text-center text-white/70">Không tải được lời bài hát.</p>;
  if (!query.data) return <p className="mt-24 text-center text-white/70">Chưa có lời cho bài này.</p>;

  return (
    <div
      ref={container}
      className="no-scrollbar h-full overflow-y-auto px-6 py-[30%] [mask-image:linear-gradient(transparent,black_15%,black_85%,transparent)]"
      onTouchMove={() => (userScrolledAt.current = Date.now())}
      onWheel={() => (userScrolledAt.current = Date.now())}
    >
      {lines ? (
        lines.map((line, i) => (
          <button
            key={i}
            data-line={i}
            className={`block w-full py-1.5 text-left text-[22px] font-bold leading-snug transition-colors duration-300 ${
              i === active ? 'text-white' : i < active ? 'text-white/45' : 'text-black/45'
            }`}
            onClick={() => void seekTo(line.time)}
          >
            {line.text || '♪'}
          </button>
        ))
      ) : (
        <p className="whitespace-pre-line text-[19px] font-bold leading-relaxed">{query.data.plain}</p>
      )}
      {query.data.source && <p className="mt-8 text-[12px] text-white/60">{query.data.source}</p>}
    </div>
  );
}
