import { useState } from 'react';
import { DEFAULT_PLAYLIST_NAME } from '@/lib/library';

/** Ô nhập tên playlist + nút xác nhận (tạo mới, đổi tên). */
export function PlaylistNameForm({
  initial = '',
  submitLabel,
  title,
  onSubmit
}: {
  initial?: string;
  submitLabel: string;
  title?: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(name);
      }}
    >
      {title && <h2 className="text-center text-[17px] font-bold">{title}</h2>}
      <input
        autoFocus
        maxLength={100}
        className="rounded-md bg-white/10 px-4 py-3 text-[16px] outline-none focus:bg-white/15"
        placeholder={DEFAULT_PLAYLIST_NAME}
        aria-label="Tên playlist"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="self-center rounded-full bg-accent px-8 py-3 font-bold text-black active:scale-95">
        {submitLabel}
      </button>
    </form>
  );
}
