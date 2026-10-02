// Thẻ mix "Dành cho bạn" kiểu Spotify: ảnh bìa bài đầu + dải màu có tên mix.
import { memo } from 'react';
import type { Mix, MixKind } from '@/lib/recommend';
import { navigate } from '@/ui/nav';
import { Artwork } from './Artwork';

const COLORS: Record<MixKind, string[]> = {
  daily: ['#1db954', '#e8115b', '#509bf5'],
  discover: ['#8d67ab'],
  repeat: ['#e1118c'],
  daylist: ['#f59b23']
};

const mixColor = (mix: Mix) => {
  const colors = COLORS[mix.kind];
  return colors[(Number(mix.id.replace(/\D/g, '')) || 1) % colors.length];
};

/** Ảnh mix: ảnh bìa + dải màu dưới cùng ghi tên (dùng cả ở thẻ và đầu trang mix). */
export function MixCover({ mix, size, className = '' }: { mix: Mix; size?: number; className?: string }) {
  const color = mixColor(mix);
  return (
    <div className={`relative aspect-square overflow-hidden rounded bg-highlight ${className}`}>
      <Artwork src={mix.cover} size={size} className="absolute inset-0 size-full rounded-none" />
      <div className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: color }} />
      <div className="absolute inset-x-0 bottom-1.5 bg-gradient-to-t from-black/80 to-transparent px-2.5 pt-8 pb-2">
        <div className="text-[15px] font-extrabold leading-tight text-white drop-shadow">{mix.title}</div>
      </div>
      <div className="absolute top-2 left-2 rounded-sm px-1 text-[9px] font-bold tracking-wider text-black" style={{ background: color }}>
        MELO
      </div>
    </div>
  );
}

export const MixCard = memo(function MixCard({ mix }: { mix: Mix }) {
  return (
    <button className="w-36 shrink-0 text-left active:opacity-70" onClick={() => navigate({ name: 'mix', id: mix.id })}>
      <MixCover mix={mix} size={144} className="w-36" />
      <div className="mt-2 line-clamp-2 text-[12px] leading-snug text-subdued">{mix.subtitle}</div>
    </button>
  );
});
