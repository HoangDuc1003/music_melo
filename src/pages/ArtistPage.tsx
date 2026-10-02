import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { Artwork } from '@/components/Artwork';
import { Page, PageError, PageLoading } from '@/components/Page';
import { PlayContextButton } from '@/components/PlayContextButton';
import { Shelf } from '@/components/Shelf';
import { TrackRow } from '@/components/TrackRow';
import { playRadio, playTracks } from '@/player/controller';
import { useArtworkColor } from '@/ui/hooks';
import { getArtist } from '@/youtube/music';

export function ArtistPage({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['artist', id], queryFn: () => getArtist(id) });
  const color = useArtworkColor(query.data?.thumbnail, id);
  const [showAll, setShowAll] = useState(false);

  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message="Không tải được nghệ sĩ. Kiểm tra kết nối mạng." onRetry={() => void query.refetch()} />;
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
          <PlayContextButton tracks={artist.topTracks} context={context} />
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
