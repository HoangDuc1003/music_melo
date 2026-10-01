import { setSleepTimer } from '@/player/controller';
import { usePlayer } from '@/player/store';
import { closeSleepTimer, toast, useOverlays } from '@/ui/overlays';
import { Sheet } from './Sheet';

const OPTIONS = [5, 10, 15, 30, 45, 60, 90];

/** Hẹn giờ tắt nhạc (chạy ở phần native nên vẫn đúng khi khoá máy). */
export function SleepTimerSheet() {
  const open = useOverlays((s) => s.sleepOpen);
  const endsAt = usePlayer((s) => s.sleepTimerEndsAt);
  const endOfItem = usePlayer((s) => s.sleepAtEndOfItem);
  const active = Boolean(endsAt || endOfItem);

  const choose = (minutes: number, atEnd = false) => {
    closeSleepTimer();
    void setSleepTimer(minutes, atEnd).then(() =>
      toast(minutes === 0 && !atEnd ? 'Đã tắt hẹn giờ' : atEnd ? 'Sẽ dừng khi hết bài này' : `Sẽ dừng sau ${minutes} phút`)
    );
  };

  return (
    <Sheet open={open} onClose={closeSleepTimer} label="Hẹn giờ tắt">
      <div className="pb-3">
        <h2 className="pb-2 text-center text-[17px] font-bold">Hẹn giờ tắt</h2>
        {active && (
          <p className="pb-2 text-center text-[13px] text-accent">
            {endOfItem ? 'Dừng khi hết bài này' : `Dừng lúc ${new Date(endsAt!).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        )}
        {OPTIONS.map((m) => (
          <button key={m} className="block w-full px-5 py-3.5 text-left text-[15px] active:bg-white/10" onClick={() => choose(m)}>
            {m < 60 ? `${m} phút` : m === 60 ? '1 giờ' : `${m / 60} giờ`.replace('.', ',')}
          </button>
        ))}
        <button className="block w-full px-5 py-3.5 text-left text-[15px] active:bg-white/10" onClick={() => choose(0, true)}>
          Khi hết bài này
        </button>
        {active && (
          <button className="block w-full px-5 py-3.5 text-left text-[15px] text-red-400 active:bg-white/10" onClick={() => choose(0)}>
            Tắt hẹn giờ
          </button>
        )}
      </div>
    </Sheet>
  );
}
