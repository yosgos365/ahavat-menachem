import { useEffect, useState } from "react";
import { SEATS, MAX_ROWS, MAX_COLS } from "../MapData";
import { clsx } from "clsx";

interface SeatStatus {
  status: "available" | "pending" | "taken";
}

export function Home() {
  const [seatStatuses, setSeatStatuses] = useState<Record<string, SeatStatus>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/seats")
      .then((res) => res.json())
      .then((data) => {
        setSeatStatuses(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load seats", err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-8">
        <h1 className="text-3xl font-semibold text-slate-800 mb-2">מפת המושבים</h1>
        <p className="text-slate-500 mb-8">
          כאן תוכלו לראות את מצב המושבים בבית הכנסת לקראת השנה החדשה.
        </p>

        <div className="flex gap-4 mb-8 justify-center flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-emerald-100 border border-emerald-300 rounded-full"></div>
            <span className="text-sm">פנוי</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-amber-100 border border-amber-300 rounded-full"></div>
            <span className="text-sm">בהמתנה לאישור</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-rose-200 border border-rose-500 rounded-full"></div>
            <span className="text-sm">תפוס</span>
          </div>
        </div>

        {loading ? (
          <div className="h-96 flex items-center justify-center">
            <div className="animate-pulse text-slate-400">טוען מפה...</div>
          </div>
        ) : (
          <div className="overflow-x-auto pb-4" dir="ltr">
            <div 
              className="public-seat-map inline-grid gap-1.5 mx-auto p-6 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm relative"
              style={{
                gridTemplateColumns: `repeat(${MAX_COLS}, 38px)`,
                gridTemplateRows: `repeat(${MAX_ROWS}, 26px)`,
              }}
            >
              {/* Static Elements */}
              <div style={{ gridRow: '14 / 19', gridColumn: '1 / 35' }} className="rounded-3xl w-full h-full bg-slate-100/60 border border-slate-200/60 pointer-events-none z-0">
              </div>
              <div style={{ gridRow: '1 / 2', gridColumn: '14 / 18' }} className="bg-indigo-100 border border-indigo-200 flex items-center justify-center text-sm font-bold text-indigo-900 shadow-sm z-0">
                ארון קודש
              </div>
              <div style={{ gridRow: '5 / 8', gridColumn: '14 / 17', width: '126px', justifySelf: 'start' }} className="bg-indigo-50/80 border border-indigo-200/50 flex items-center justify-center text-sm font-bold text-indigo-800 shadow-sm z-20">
                בימה
              </div>
              
              {/* Labels for sections */}
              <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0" style={{ gridRow: '3 / 13', gridColumn: '34', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                עזרת גברים
              </div>
              <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0" style={{ gridRow: '15 / 18', gridColumn: '1', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                עזרת נשים
              </div>

              {SEATS.map((seat) => {
                const status = seatStatuses[seat.id]?.status || "available";
                
                return (
                  <div
                    key={seat.id}
                    className={clsx(
                      "flex items-center justify-center text-xs font-medium rounded-full shadow-sm border transition-colors z-10 relative",
                      status === "available" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                      status === "pending" && "bg-amber-50 text-amber-700 border-amber-200",
                      status === "taken" && "bg-rose-200 text-rose-900 border-rose-500 ring-1 ring-rose-300",
                    )}
                    style={{
                      gridRow: seat.row + 1,
                      gridColumn: seat.col + 1,
                    }}
                    title={`${seat.label} - ${status === 'available' ? 'פנוי' : status === 'pending' ? 'בהמתנה' : 'תפוס'}`}
                  >
                    {seat.label}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
