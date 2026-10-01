import { useEffect } from 'react';
import { clearError } from '@/player/controller';
import { usePlayer } from '@/player/store';
import { toast, useOverlays } from '@/ui/overlays';

/** Thông báo ngắn phía trên trình phát mini; lỗi của trình phát cũng hiện ở đây. */
export function Toasts() {
  const toasts = useOverlays((s) => s.toasts);
  const error = usePlayer((s) => s.error);

  useEffect(() => {
    if (!error) return;
    toast(error);
    clearError();
  }, [error]);

  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(140px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className="toast-in max-w-full rounded-lg bg-white px-4 py-2.5 text-center text-[14px] font-medium text-black shadow-xl">
          {t.message}
        </div>
      ))}
    </div>
  );
}
