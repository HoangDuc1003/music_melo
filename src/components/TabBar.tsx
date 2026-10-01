import { House, Library, Search } from 'lucide-react';
import { selectTab, useNav, type Tab } from '@/ui/nav';

const TABS: { tab: Tab; label: string; Icon: typeof House }[] = [
  { tab: 'home', label: 'Trang chủ', Icon: House },
  { tab: 'search', label: 'Tìm kiếm', Icon: Search },
  { tab: 'library', label: 'Thư viện', Icon: Library }
];

export function TabBar() {
  const active = useNav((s) => s.tab);
  return (
    <nav className="safe-bottom grid grid-cols-3" aria-label="Điều hướng">
      {TABS.map(({ tab, label, Icon }) => {
        const on = tab === active;
        return (
          <button
            key={tab}
            className={`flex flex-col items-center gap-1 pt-2 pb-1.5 text-[10px] active:scale-95 ${on ? 'text-white' : 'text-subdued'}`}
            aria-current={on ? 'page' : undefined}
            onClick={() => selectTab(tab)}
          >
            <Icon size={24} strokeWidth={on ? 2.6 : 1.8} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
