import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpLeft, Clock, Link2, Search, X } from 'lucide-react';
import { Artwork } from '@/components/Artwork';
import { Centered, ErrorState, Page, RootTitle, Spinner } from '@/components/Page';
import { TrackRow } from '@/components/TrackRow';
import { clearSearches, recordSearch, removeSearch, useRecentSearches } from '@/lib/library';
import { log } from '@/lib/log';
import { playTracks } from '@/player/controller';
import { useDebounced } from '@/ui/hooks';
import { navigate, openCard } from '@/ui/nav';
import { toast } from '@/ui/overlays';
import { getSuggestions, getUpNext, parseYouTubeLink, search } from '@/youtube/music';
import type { Card, SearchType, ShelfItem, Track } from '@/youtube/types';

const TYPES: { type: SearchType; label: string }[] = [
  { type: 'song', label: 'Bài hát' },
  { type: 'video', label: 'Video' },
  { type: 'album', label: 'Album' },
  { type: 'artist', label: 'Nghệ sĩ' },
  { type: 'playlist', label: 'Playlist' }
];

function CardRow({ card }: { card: Card }) {
  return (
    <button className="flex w-full items-center gap-3 px-4 py-2 text-left active:bg-white/5" onClick={() => openCard(card)}>
      <Artwork src={card.thumbnail} round={card.kind === 'artist'} size={56} className="size-14 shrink-0" />
      <div className="min-w-0">
        <div className="truncate text-[15px]">{card.title}</div>
        <div className="truncate text-[13px] text-subdued">{card.subtitle}</div>
      </div>
    </button>
  );
}

function Results({ items, query }: { items: ShelfItem[]; query: string }) {
  const tracks: Track[] = items.flatMap((i) => (i.type === 'track' ? [i.track] : []));
  if (!items.length) return <Centered>Không tìm thấy kết quả cho “{query}”.</Centered>;
  return (
    <div className="pt-1">
      {items.map((item) =>
        item.type === 'track' ? (
          <TrackRow
            key={`t-${item.track.id}`}
            track={item.track}
            onPlay={() => void playTracks(tracks, tracks.indexOf(item.track), { context: { type: 'search', title: query } })}
          />
        ) : (
          <CardRow key={`c-${item.card.id}`} card={item.card} />
        )
      )}
    </div>
  );
}

async function openLink(link: { playlistId?: string; videoId?: string }) {
  try {
    if (link.playlistId) return navigate({ name: 'playlist', id: link.playlistId });
    if (link.videoId) {
      const tracks = await getUpNext(link.videoId);
      const start = Math.max(0, tracks.findIndex((t) => t.id === link.videoId));
      if (!tracks.length) throw new Error('Không mở được link này');
      await playTracks(tracks, start, { context: { type: 'radio', id: link.videoId, title: tracks[start].title } });
    }
  } catch (err) {
    log.error('search', err);
    toast(err instanceof Error ? err.message : 'Không mở được link này');
  }
}

export function SearchPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('song');
  const [focused, setFocused] = useState(false);
  const recent = useRecentSearches();
  const typed = useDebounced(input.trim(), 250);
  const link = parseYouTubeLink(input);

  const suggestions = useQuery({
    queryKey: ['suggest', typed],
    queryFn: () => getSuggestions(typed),
    enabled: focused && typed.length > 0 && !link,
    staleTime: 5 * 60_000
  });
  const results = useQuery({
    queryKey: ['search', type, query],
    queryFn: () => search(query, type),
    enabled: query.length > 0
  });

  const submit = (q: string) => {
    const value = q.trim();
    if (!value) return;
    setInput(value);
    setQuery(value);
    setFocused(false);
    (document.activeElement as HTMLElement | null)?.blur();
    void recordSearch(value);
  };

  const showSuggestions = focused && input.trim().length > 0;
  const showRecent = !showSuggestions && !query;

  return (
    <Page>
      {/* nền cho vùng thanh trạng thái khi ô tìm kiếm dính trên cùng */}
      <div className="fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-base" />
      <RootTitle>Tìm kiếm</RootTitle>
      <div className="sticky top-[env(safe-area-inset-top)] z-10 bg-base px-4 pt-1 pb-3">
        <form
          className="flex items-center gap-2 rounded-md bg-white px-3 py-2.5 text-black"
          onSubmit={(e) => {
            e.preventDefault();
            if (link) return void openLink(link);
            submit(input);
          }}
        >
          <Search size={20} className="shrink-0" />
          <input
            className="w-full bg-transparent text-[16px] outline-none placeholder:text-neutral-500"
            placeholder="Bạn muốn nghe gì? (hoặc dán link YouTube)"
            enterKeyHint="search"
            value={input}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onChange={(e) => setInput(e.target.value)}
          />
          {input && (
            <button type="button" aria-label="Xoá" className="shrink-0 p-0.5" onClick={() => (setInput(''), setQuery(''))}>
              <X size={18} />
            </button>
          )}
        </form>
        {query && !showSuggestions && (
          <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
            {TYPES.map((t) => (
              <button
                key={t.type}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] ${t.type === type ? 'bg-accent font-semibold text-black' : 'bg-white/10'}`}
                onClick={() => setType(t.type)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {link && (
        <button className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5" onClick={() => void openLink(link)}>
          <Link2 className="text-accent" />
          <span className="text-[15px]">{link.playlistId ? 'Mở playlist từ link' : 'Phát bài từ link'}</span>
        </button>
      )}

      {showSuggestions && !link && (
        <div>
          {suggestions.data?.queries.map((q) => (
            <div key={q} className="flex items-center">
              <button className="flex flex-1 items-center gap-3 px-4 py-3 text-left text-[15px] active:bg-white/5" onMouseDown={(e) => e.preventDefault()} onClick={() => submit(q)}>
                <Search size={18} className="text-subdued" />
                {q}
              </button>
              <button className="p-3 text-subdued" aria-label="Điền vào ô tìm kiếm" onMouseDown={(e) => e.preventDefault()} onClick={() => setInput(q + ' ')}>
                <ArrowUpLeft size={18} />
              </button>
            </div>
          ))}
          {suggestions.data && suggestions.data.items.length > 0 && <Results items={suggestions.data.items} query={typed} />}
        </div>
      )}

      {showRecent && (
        <div className="px-4">
          {recent.length > 0 ? (
            <>
              <div className="flex items-center justify-between pb-1">
                <h2 className="text-[17px] font-bold">Tìm kiếm gần đây</h2>
                <button className="text-[13px] text-subdued" onClick={() => void clearSearches()}>
                  Xoá hết
                </button>
              </div>
              {recent.map((q) => (
                <div key={q} className="flex items-center">
                  <button className="flex flex-1 items-center gap-3 py-2.5 text-left text-[15px]" onClick={() => submit(q)}>
                    <Clock size={18} className="text-subdued" />
                    {q}
                  </button>
                  <button className="p-2 text-subdued" aria-label={`Xoá ${q}`} onClick={() => void removeSearch(q)}>
                    <X size={18} />
                  </button>
                </div>
              ))}
            </>
          ) : (
            <Centered>Tìm bài hát, nghệ sĩ, album hoặc dán link playlist YouTube.</Centered>
          )}
        </div>
      )}

      {query && !showSuggestions && (
        <>
          {results.isPending && <Spinner className="mt-10" />}
          {results.isError && <ErrorState error={new Error('Không tìm được. Kiểm tra kết nối mạng.')} onRetry={() => void results.refetch()} />}
          {results.data && <Results items={results.data} query={query} />}
        </>
      )}
    </Page>
  );
}
