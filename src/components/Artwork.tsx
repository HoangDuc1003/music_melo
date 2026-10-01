import { useState } from 'react';
import { Music } from 'lucide-react';

interface Props {
  src?: string;
  alt?: string;
  className?: string;
  /** nghệ sĩ: ảnh tròn */
  round?: boolean;
  /** ảnh ở đầu trang: tải ngay, không lazy */
  eager?: boolean;
}

/** Ảnh bìa có ô giữ chỗ khi chưa có ảnh hoặc ảnh lỗi (offline). */
export function Artwork({ src, alt = '', className = '', round = false, eager = false }: Props) {
  const [failed, setFailed] = useState<string>();
  const shape = round ? 'rounded-full' : 'rounded';
  if (!src || failed === src) {
    return (
      <div className={`flex items-center justify-center bg-highlight text-subdued ${shape} ${className}`} aria-hidden>
        <Music className="size-1/3 min-h-4 min-w-4" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={`bg-highlight object-cover ${shape} ${className}`}
    />
  );
}
