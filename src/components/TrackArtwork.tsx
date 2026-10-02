import type { ComponentProps } from 'react';
import { useDownloads } from '@/downloads/manager';
import type { Track } from '@/youtube/types';
import { Artwork } from './Artwork';

/** Ảnh bìa của một bài; ảnh trên mạng không tải được (offline) thì dùng ảnh đã tải về máy. */
export function TrackArtwork({ track, ...props }: { track: Track } & Omit<ComponentProps<typeof Artwork>, 'src' | 'fallbackSrc'>) {
  const localArt = useDownloads((s) => s.artwork.get(track.id));
  return <Artwork src={track.thumbnail} fallbackSrc={localArt} {...props} />;
}
