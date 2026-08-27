import { Outlet, Link, useLocation } from "react-router-dom";
import { User, Map as MapIcon, Lock } from "lucide-react";
import { clsx } from "clsx";

export function PublicLayout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900" dir="rtl">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center min-h-16 py-2 gap-2 sm:flex-nowrap">
            <div className="flex items-center gap-2">
              <span className="text-lg sm:text-xl font-semibold tracking-tight text-blue-900 whitespace-nowrap">אחוות מנחם</span>
            </div>
            
            <nav className="order-3 basis-full flex justify-center gap-1 sm:order-none sm:basis-auto sm:space-x-4 sm:space-x-reverse">
              <Link
                to="/"
                className={clsx(
                  "px-3 py-2.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap",
                  location.pathname === "/"
                    ? "bg-blue-50 text-blue-700"
                    : "text-stone-600 hover:bg-stone-100"
                )}
              >
                <MapIcon className="w-4 h-4" />
                מפת מקומות
              </Link>
              <Link
                to="/select"
                className={clsx(
                  "px-3 py-2.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap",
                  location.pathname === "/select"
                    ? "bg-blue-50 text-blue-700"
                    : "text-stone-600 hover:bg-stone-100"
                )}
              >
                <User className="w-4 h-4" />
                רכישת כסא
              </Link>
            </nav>
            
            <div>
              <Link
                to="/admin/login"
                className="text-stone-400 hover:text-stone-600 transition-colors flex items-center gap-1 text-sm"
                title="כניסת מנהל"
              >
                <Lock className="w-4 h-4" />
                <span className="sr-only">כניסת מנהל</span>
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
