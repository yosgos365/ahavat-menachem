import { Outlet, Link } from "react-router-dom";
import { useRef } from "react";
import { Home, LayoutDashboard } from "lucide-react";
import { useStore } from "../store";

export function AdminLayout() {
  const iconPresses = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDashboardIconPress = () => {
    iconPresses.current += 1;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => { iconPresses.current = 0; }, 3000);
    if (iconPresses.current === 4) {
      iconPresses.current = 0;
      window.dispatchEvent(new Event("developer-settings-request"));
    }
  };
  
  return (
    <div className="min-h-screen bg-stone-100 text-stone-900" dir="rtl">
      <header className="bg-slate-900 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center min-h-14 sm:h-16 py-2 gap-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleDashboardIconPress} aria-label="לוח בקרה" className="rounded p-1 -m-1 hover:bg-slate-800"><LayoutDashboard className="w-5 h-5 text-indigo-400" /></button>
              <span className="text-sm sm:text-lg font-semibold tracking-wide">ניהול אחוות מנחם</span>
            </div>
            <div className="flex items-center gap-4">
              <Link
                to="/"
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
              >
                <Home className="w-4 h-4" />
                דף הבית
              </Link>
              
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
