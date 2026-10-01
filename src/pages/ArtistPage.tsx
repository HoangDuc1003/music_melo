import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, Radio } from 'lucide-react';
import { Artwork } from '@/components/Artwork';
import { ErrorState, Page, Spinner } from '@/components/Page';
import { Shelf } from '@/components/Shelf';
import { TrackRow } from '@/components/TrackRow';
import { pause, play, playRadio, playTracks } from '@/player/controller';
import { usePlayer } from '@/player/store';
import { useArtworkColor } from '@/ui/hooks';
import { getArtist } from '@/youtube/music';

export function ArtistPage({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['artist', id], queryFn: () => getArtist(id) });
  const color = useArtworkColor(query.data?.thumbnail, id);
  const [showAll, setShowAll] = useState(false);
  const isThis = usePlayer((s) => s.context?.type === 'artist' && s.context.id === id);
  const playing = usePlayer((s) => s.playing);

  if (query.isPending) {
    return (
      <Page>
        <Spinner className="mt-40" />
      </Page>
    );
  }
  if (query.isError) {
    return (
      <Page solidHeader>
        <ErrorState error={new Error('Không tải được nghệ sĩ. Kiểm tra kết nối mạng.')} onRetry={() => void query.refetch()} />
      </Page>
    );
  }
  const artist = query.data;
  const context = { type: 'artist' as const, id, title: artist.name };
  const top = showAll ? artist.topTracks : artist.topTracks.slice(0, 5);

  return (
    <Page title={artist.name} color={color}>
      <div className="relative -mt-[calc(48px+env(safe-area-inset-top))]">
        <Artwork src={artist.thumbnail} eager className="aspect-[4/3] w-full rounded-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-base" />
        <h1 className="absolute inset-x-4 bottom-3 text-[40px] font-extrabold leading-none drop-shadow-lg">{artist.name}</h1>
      </div>

      <div className="flex items-center gap-2 px-4 pt-3">
        <button
          className="rounded-full border border-white/40 px-4 py-1.5 text-[13px] font-semibold active:scale-95"
          onClick={() => artist.topTracks[0] && void playRadio(artist.topTracks[0])}
        >
          <Radio size={14} className="mr-1 inline" /> Radio
        </button>
        <div className="flex-1" />
        {artist.topTracks.length > 0 && (
          <button
            className="flex size-14 items-center justify-center rounded-full bg-accent text-black shadow-lg active:scale-95"
            aria-label={isThis && playing ? 'Tạm dừng' : 'Phát'}
            onClick={() => (isThis ? void (playing ? pause() : play()) : void playTracks(artist.topTracks, 0, { context, shuffle: false }))}
          >
            {isThis && playing ? <Pause size={26} fill="black" strokeWidth={0} /> : <Play size={26} fill="black" strokeWidth={0} className="ml-0.5" />}
          </button>
        )}
      </div>

      {artist.topTracks.length > 0 && (
        <section className="mt-4">
          <h2 className="px-4 pb-1 text-[20px] font-bold">Phổ biến</h2>
          {top.map((track, i) => (
            <TrackRow key={track.id} track={track} onPlay={() => void playTracks(artist.topTracks, i, { context })} />
          ))}
          {artist.topTracks.length > 5 && (
            <button className="mx-4 mt-1 rounded-full border border-white/30 px-4 py-1.5 text-[13px] font-semibold" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Thu gọn' : 'Xem thêm'}
            </button>
          )}
        </section>
      )}

      {artist.shelves.map((shelf) => (
        <Shelf key={shelf.title} shelf={shelf} />
      ))}

      {artist.description && (
        <section className="mx-4 mt-8 rounded-lg bg-highlight p-4">
          <h2 className="pb-2 text-[17px] font-bold">Giới thiệu</h2>
          <p className="line-clamp-6 text-[14px] leading-relaxed text-subdued">{artist.description}</p>
        </section>
      )}
    </Page>
  );
}
