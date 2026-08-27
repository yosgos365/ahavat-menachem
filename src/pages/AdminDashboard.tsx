import React from "react";
import { useState, useEffect } from "react";
import { useStore } from "../store";
import { SEATS, MAX_ROWS, MAX_COLS } from "../MapData";
import { clsx } from "clsx";
import { useNavigate } from "react-router-dom";
import { Users, UserCheck, AlertTriangle, Eye, Trash2, Key, Settings, LogOut, X, Printer, Table2, Download, History, Search } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Request {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  seats: string[];
  status: "pending" | "approved" | "rejected";
  isLastYearUser: boolean;
  isDemo?: boolean;
  lastYearIdentityConfirmed?: boolean;
  lastYearChoice?: "same-seat" | "different-seats" | "not-confirmed";
  lastYearSeats?: string[];
  paymentImage: string;
  timestamp?: number;
  requestedSeats?: string[];
  seatChanges?: Array<{
    seatId: string;
    type: "released" | "transferred";
    timestamp: number;
  }>;
  rejectionReason?: string;
}

interface DBState {
  requests: Request[];
  seats: Record<string, { status: "available" | "pending" | "taken"; owner?: string; reservedBy?: string }>;
  lastYearUsers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    seats: string[];
  }>;
  auditLog?: Array<{ id: number; timestamp: number; action: string; seatId?: string; fromOwner?: string; toOwner?: string; details?: string }>;
}

export function AdminDashboard() {
  const adminToken = useStore(state => state.adminToken);
  const logout = useStore(state => state.logout);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"requests" | "allRequests" | "conflicts" | "mapCurrent" | "mapLastYear" | "print" | "settings">("allRequests");
  
  const [data, setData] = useState<DBState | null>(null);
  const [loading, setLoading] = useState(true);
  
  // State for Map View Modal (when clicking "Show on map" in request list)
  const [viewRequestSeats, setViewRequestSeats] = useState<{ reqId?: string, seats: string[], canApprove?: boolean } | null>(null);
  
  // Image Viewer Modal
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [reassigningRequest, setReassigningRequest] = useState<Request | null>(null);
  const [reassignmentSeats, setReassignmentSeats] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Request["status"]>("all");
  const [actionError, setActionError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [rejectingRequest, setRejectingRequest] = useState<Request | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showDeveloperAccess, setShowDeveloperAccess] = useState(false);
  const [developerPassword, setDeveloperPassword] = useState("");
  const [developerMessage, setDeveloperMessage] = useState("");
  const [developerToken, setDeveloperToken] = useState(() => localStorage.getItem("synagogue-developer-token") || "");
  const [developerDeviceId] = useState(() => {
    const existing = localStorage.getItem("synagogue-developer-device");
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem("synagogue-developer-device", created);
    return created;
  });

  // Conflict Resolution Modal
  const [resolvingConflict, setResolvingConflict] = useState<{
    seatId: string;
    requests: Request[];
    winnerReqId?: string;
    loserReplacements: Record<string, string>;
    activeLoserId?: string;
  } | null>(null);
  const [replacementPicker, setReplacementPicker] = useState<{ loserId: string; requestedSeat: string } | null>(null);

  // Seat Edit Modal
  const [editSeat, setEditSeat] = useState<{ id: string, owner: string } | null>(null);
  const [editLastYearSeat, setEditLastYearSeat] = useState<{ id: string, owner: string } | null>(null);
  const [relocatingSeat, setRelocatingSeat] = useState<{ id: string; owner: string } | null>(null);
  
  // Password Change
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passMsg, setPassMsg] = useState("");
  const paymentImageUrl = (url: string) => url.startsWith("/api/payment-images/") ? `${url}?token=${encodeURIComponent(adminToken)}` : url;
  
  // State for Long Press (Delete)
  const [longPressId, setLongPressId] = useState<string | null>(null);
  let pressTimer: any;

  const handlePressStart = (id: string) => {
    pressTimer = setTimeout(() => {
      setLongPressId(id);
    }, 800);
  };
  const handlePressEnd = () => {
    clearTimeout(pressTimer);
  };

  const loadData = async () => {
    try {
      const res = await fetch("/api/admin/dashboard", { headers: { "Authorization": `Bearer ${adminToken}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "טעינת הנתונים נכשלה");
      const result = await res.json();
      setData(result);
      setActionError("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "טעינת הנתונים נכשלה");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    loadData();
  }, [adminToken]);

  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") loadData(); };
    const refreshTimer = window.setInterval(loadData, 20_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.clearInterval(refreshTimer); document.removeEventListener("visibilitychange", refreshWhenVisible); };
  }, [adminToken]);

  useEffect(() => {
    const openDeveloperAccess = () => { setDeveloperMessage(""); setShowDeveloperAccess(true); };
    window.addEventListener("developer-settings-request", openDeveloperAccess);
    return () => window.removeEventListener("developer-settings-request", openDeveloperAccess);
  }, []);

  useEffect(() => {
    if (!successNotice) return;
    const timer = window.setTimeout(() => setSuccessNotice(""), 4_500);
    return () => window.clearTimeout(timer);
  }, [successNotice]);

  const approveRequest = async (id: string): Promise<boolean> => {
    if (approvingRequestId) return false;
    const request = data?.requests.find(item => item.id === id);
    setApprovingRequestId(id);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/requests/${id}/approve`, { method: "POST", headers: { "Authorization": `Bearer ${adminToken}` } });
      if (!res.ok) { setActionError((await res.json().catch(() => null))?.error || "אישור הבקשה נכשל"); return false; }
      await loadData();
      const customerName = [request?.firstName, request?.lastName].filter(Boolean).join(" ") || "הלקוח";
      const seats = request?.seats ?? [];
      const seatLabel = seats.length === 1 ? "מושב" : "מושבים";
      setSuccessNotice(`האישור ל־${customerName} עבור ${seatLabel} ${seats.join(", ")} נקלט בהצלחה`);
      return true;
    } catch {
      setActionError("לא ניתן לאשר את הבקשה. בדוק את החיבור ונסה שוב.");
      return false;
    } finally { setApprovingRequestId(null); }
  };

  const deleteRequest = async (id: string) => {
    const res = await fetch(`/api/admin/requests/${id}/delete`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (!res.ok) { setActionError((await res.json().catch(() => null))?.error || "מחיקת הבקשה נכשלה"); return; }
    setLongPressId(null);
    loadData();
  };

  const developerHeaders = () => ({ "X-Developer-Token": developerToken, "X-Developer-Device": developerDeviceId });
  const unlockDeveloper = async (event: React.FormEvent) => {
    event.preventDefault();
    setDeveloperMessage("בודק סיסמת מפתח...");
    const response = await fetch("/api/admin/developer/unlock", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` }, body: JSON.stringify({ password: developerPassword, deviceId: developerDeviceId }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setDeveloperMessage(result?.error || "לא ניתן לפתוח את מצב המפתח."); return; }
    localStorage.setItem("synagogue-developer-token", result.token);
    setDeveloperToken(result.token);
    setDeveloperPassword("");
    setDeveloperMessage("");
  };
  const runDeveloperAction = async (path: string, confirmation: string) => {
    if (!window.confirm(confirmation)) return;
    setDeveloperMessage("מבצע...");
    const response = await fetch(path, { method: "POST", headers: developerHeaders() });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 403) { localStorage.removeItem("synagogue-developer-token"); setDeveloperToken(""); }
      setDeveloperMessage(result?.error || "הפעולה נכשלה.");
      return;
    }
    setDeveloperMessage(path.endsWith("create-demo") ? `נוצרו ${result.count} בקשות הדגמה.` : "כל הבקשות והאישורים נמחקו.");
    loadData();
  };

  const rejectRequest = async () => {
    if (!rejectingRequest || !rejectionReason.trim()) return;
    const res = await fetch(`/api/admin/requests/${rejectingRequest.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: rejectionReason.trim() })
    });
    if (!res.ok) { setActionError((await res.json().catch(() => null))?.error || "דחיית הבקשה נכשלה"); return; }
    setRejectingRequest(null);
    setRejectionReason("");
    loadData();
  };

  const exportExcel = async () => {
    const res = await fetch("/api/admin/export.xlsx", { headers: { "Authorization": `Bearer ${adminToken}` } });
    if (!res.ok) { setActionError("ייצוא Excel נכשל"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ניהול-מושבים.xls";
    link.click();
    URL.revokeObjectURL(url);
  };

  const overrideSeat = async (seatId: string, status: "available" | "taken", owner: string = "") => {
     await fetch(`/api/admin/seat/${seatId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ status, owner })
    });
    setEditSeat(null);
    loadData();
  };

  const moveSeat = async (toSeatId: string) => {
    if (!relocatingSeat || !toSeatId) return;
    const res = await fetch(`/api/admin/seat/${relocatingSeat.id}/move`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` }, body: JSON.stringify({ toSeatId }) });
    if (!res.ok) { setActionError((await res.json().catch(() => null))?.error || "העברת הלקוח נכשלה"); return; }
    setRelocatingSeat(null);
    setEditSeat(null);
    loadData();
  };

  const saveLastYearSeat = async () => {
    if (!editLastYearSeat) return;
    const response = await fetch(`/api/admin/last-year/seat/${editLastYearSeat.id}`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` }, body: JSON.stringify({ owner: editLastYearSeat.owner }) });
    if (!response.ok) { setActionError((await response.json().catch(() => null))?.error || "שמירת מפת תשפ״ו נכשלה"); return; }
    setEditLastYearSeat(null);
    loadData();
  };

  const resolveConflictSubmit = async () => {
    if (!resolvingConflict || !resolvingConflict.winnerReqId) return;
    
    const loserUpdates = Object.entries(resolvingConflict.loserReplacements).map(([reqId, newSeat]) => ({
      reqId, newSeat
    }));

    const response = await fetch(`/api/admin/resolve-conflict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({
        seatId: resolvingConflict.seatId,
        winnerReqId: resolvingConflict.winnerReqId,
        loserUpdates
      })
    });
    if (!response.ok) {
      setActionError((await response.json().catch(() => null))?.error || "הטיפול בכפילות נכשל");
      return;
    }
    setResolvingConflict(null);
    loadData();
  };

  const openReassignment = (request: Request) => {
    setReassigningRequest(request);
    setReassignmentSeats([]);
  };

  const resolveRequest = async () => {
    if (!reassigningRequest || reassignmentSeats.length !== reassigningRequest.seats.length) return;
    await fetch(`/api/admin/requests/${reassigningRequest.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ assignedSeats: reassignmentSeats })
    });
    setReassigningRequest(null);
    setReassignmentSeats([]);
    loadData();
  };

  const reopenApprovedRequest = async (request: Request) => {
    const response = await fetch(`/api/admin/requests/${request.id}/reopen`, { method: "POST", headers: { "Authorization": `Bearer ${adminToken}` } });
    if (!response.ok) { setActionError((await response.json().catch(() => null))?.error || "לא ניתן לפתוח את השיבוץ מחדש"); return; }
    setReassigningRequest({ ...request, status: "pending" });
    setReassignmentSeats([]);
    loadData();
  };

  const printMap = () => {
    const originalTitle = document.title;
    const restoreTitle = () => {
      document.title = originalTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    document.title = "מפת בית הכנסת";
    window.addEventListener("afterprint", restoreTitle);
    window.print();
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPassMsg("הסיסמה החדשה ואימות הסיסמה אינם תואמים.");
      return;
    }
    setPassMsg("מעדכן...");
    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json();
      if (data.success) {
        setPassMsg("סיסמה עודכנה בהצלחה! יש להתחבר מחדש בפעם הבאה.");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPassMsg("שגיאה בעדכון הסיסמה: " + data.error);
      }
    } catch(err) {
      setPassMsg("שגיאת רשת.");
    }
  };

  if (loading || !data) {
    return <div className="text-center py-12">טוען נתונים...</div>;
  }

  // Find conflicts
  const allRequests = data.requests;
  const allPendingRequests = allRequests.filter(req => req.status === "pending");
  const requestedSeatsCount: Record<string, string[]> = {};

  allPendingRequests.forEach(req => {
    req.seats.forEach(seat => {
      if (!requestedSeatsCount[seat]) requestedSeatsCount[seat] = [];
      requestedSeatsCount[seat].push(req.id);
    });
  });
  
  const conflictedSeats = Object.entries(requestedSeatsCount)
    .filter(([_, reqIds]) => reqIds.length > 1)
    .map(([seatId]) => seatId);
    
  const hasConflicts = conflictedSeats.length > 0;
  
  const conflictedReqIds = new Set(Object.values(requestedSeatsCount).filter(ids => ids.length > 1).flat());
  const pendingRequests = allPendingRequests.filter(req => !conflictedReqIds.has(req.id));
  const sortedAllRequests = [...allRequests]
    .filter((req) => {
      const query = searchTerm.trim().toLowerCase();
      const matchesSearch = !query || [req.firstName, req.lastName, req.phone, ...req.seats, ...(req.requestedSeats ?? [])].join(" ").toLowerCase().includes(query);
      return matchesSearch && (statusFilter === "all" || req.status === statusFilter);
    })
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const viewedRequest = viewRequestSeats?.reqId ? allRequests.find(request => request.id === viewRequestSeats.reqId) : undefined;


  return (
    <div className="space-y-6 relative">
      {actionError && <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-lg flex items-center justify-between gap-3"><span>{actionError}</span><button onClick={() => setActionError("")} className="font-bold" aria-label="סגור הודעת שגיאה">×</button></div>}
      <AnimatePresence>
        {successNotice && <motion.div
          role="status"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="fixed bottom-4 left-4 right-4 z-[100] mx-auto flex max-w-lg items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-xl sm:left-auto sm:right-6"
        >
          <span>{successNotice}</span>
          <button type="button" onClick={() => setSuccessNotice("")} className="touch-manipulation text-xl leading-none opacity-90 hover:opacity-100" aria-label="סגור הודעת הצלחה">×</button>
        </motion.div>}
      </AnimatePresence>
      

      {/* Tabs */}
      <div className="dashboard-tabs bg-white rounded-lg p-1 shadow-sm border border-slate-200 flex max-w-full overflow-x-auto gap-1">
        <button
          onClick={() => setActiveTab("allRequests")}
          className={clsx(
            "px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2",
            activeTab === "allRequests" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700"
          )}
        >
          <Table2 className="w-4 h-4" />
          כל הבקשות
        </button>
        <button
          onClick={() => setActiveTab("conflicts")}
          className={clsx(
            "px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2 rounded-md",
            hasConflicts 
              ? activeTab === "conflicts" ? "bg-red-600 text-white shadow-sm" : "bg-red-100 text-red-700 hover:bg-red-200 font-bold"
              : activeTab === "conflicts" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700"
          )}
        >
          {hasConflicts && <AlertTriangle className="w-4 h-4" />}
          כפולים {hasConflicts && `(${conflictedSeats.length})`}
        </button>
        <button
          onClick={() => setActiveTab("mapCurrent")}
          className={clsx(
            "px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "mapCurrent" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700"
          )}
        >
          מפת תשפ"ז (נוכחי)
        </button>
        <button
          onClick={() => setActiveTab("mapLastYear")}
          className={clsx(
            "px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "mapLastYear" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700"
          )}
        >
          מפת תשפ"ו (שנה שעברה)
        </button>
        <button
          onClick={() => setActiveTab("print")}
          className={clsx(
            "px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2",
            activeTab === "print" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700"
          )}
        >
          <Printer className="w-4 h-4" />
          הדפסת מפה
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={clsx(
            "px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2",
            activeTab === "settings" ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700"
          )}
        >
          <Key className="w-4 h-4" />
          שינוי סיסמה
        </button>
      
        
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
        {activeTab === "requests" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-800">בקשות ממתינות לאישור ({pendingRequests.length})</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {pendingRequests.length === 0 ? (
                <div className="col-span-full py-8 text-center text-slate-500 bg-slate-50 rounded-lg">
                  אין בקשות בהמתנה כרגע.
                </div>
              ) : pendingRequests.map(req => (
                <div 
                  key={req.id} 
                  className="border border-slate-200 rounded-lg p-4 relative"
                  onMouseDown={() => handlePressStart(req.id)}
                  onMouseUp={handlePressEnd}
                  onMouseLeave={handlePressEnd}
                  onTouchStart={() => handlePressStart(req.id)}
                  onTouchEnd={handlePressEnd}
                >
                  {/* Delete Overlay */}
                  <AnimatePresence>
                    {longPressId === req.id && (
                      <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-red-50/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-lg border border-red-200"
                      >
                        <p className="font-medium text-red-800 mb-4">האם למחוק בקשה זו?</p>
                        <div className="flex gap-2">
                          <button onClick={() => deleteRequest(req.id)} className="bg-red-600 text-white px-4 py-2 shadow flex items-center gap-2 text-sm font-medium hover:bg-red-700">
                            <Trash2 className="w-4 h-4" /> מחק והתפנה מושבים
                          </button>
                          <button onClick={() => setLongPressId(null)} className="bg-white text-slate-700 px-4 py-2 shadow text-sm font-medium hover:bg-slate-50">
                            ביטול
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        {req.firstName} {req.lastName}
                        {req.isLastYearUser && (
                          <span className="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                            <UserCheck className="w-3 h-3" /> ישב בעבר
                          </span>
                        )}
                      </h3>
                      <p className="text-sm text-slate-500">{req.phone}</p>
                      {req.isLastYearUser && req.lastYearSeats?.length ? <p className="mt-1 text-xs text-blue-700">ישב בתשפ״ו: {req.lastYearSeats.join(", ")}{req.lastYearChoice === "same-seat" ? " · ביקש לשמור אותם" : " · בחר מקומות אחרים"}</p> : null}
                    </div>
                    <button 
                      onClick={() => setViewRequestSeats({ reqId: req.id, seats: req.seats, canApprove: true })}
                      className="text-indigo-600 hover:text-indigo-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 text-sm font-medium flex items-center gap-1 transition-colors"
                    >
                      <Eye className="w-4 h-4" /> צפה במפה
                    </button>
                    <button
                      onClick={() => openReassignment(req)}
                      className="text-violet-700 hover:text-violet-900 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 text-sm font-medium flex items-center gap-1 transition-colors"
                    >
                      <Settings className="w-4 h-4" /> שבץ במקום אחר
                    </button>
                  </div>
                  
                  <div className="mb-4">
                    <p className="text-sm font-medium text-slate-700 mb-1">מושבים מבוקשים:</p>
                    <div className="flex gap-1 flex-wrap">
                      {req.seats.map(s => (
                        <span key={s} className="bg-stone-100 text-slate-800 border border-slate-200 px-2 py-1 text-xs font-mono">{s}</span>
                      ))}
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-sm font-medium text-slate-700 mb-1">צילום מסך העברה:</p>
                    {req.paymentImage ? (
                      <button 
                        onClick={() => setViewImage(paymentImageUrl(req.paymentImage))}
                        className="block w-24 h-24 border border-slate-200 overflow-hidden relative group"
                      >
                        <img src={paymentImageUrl(req.paymentImage)} alt="Payment" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center text-white text-xs">הגדל</div>
                      </button>
                    ) : (
                      <span className="text-slate-400 text-sm">לא הועלה</span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={Boolean(approvingRequestId)}
                    onClick={() => void approveRequest(req.id)}
                    className="w-full touch-manipulation bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 transition-colors disabled:cursor-wait disabled:opacity-60"
                  >
                    {approvingRequestId === req.id ? "מאשר..." : "אשר בקשה ותפוס מושבים"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "allRequests" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-800">בקשות</h2>
            <div className="flex flex-wrap gap-3 items-center">
              <label className="relative flex-1 min-w-56"><Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="חיפוש שם, טלפון או מושב" className="w-full pr-9 px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="px-3 py-2 border border-slate-300 rounded-lg">
                <option value="all">כל הסטטוסים</option><option value="pending">ממתינות</option><option value="approved">מאושרות</option><option value="rejected">נדחו</option>
              </select>
              <button onClick={exportExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2"><Download className="w-4 h-4" /> ייצוא Excel</button>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full min-w-[1080px] text-sm text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="p-3 font-medium">לקוח</th>
                    <th className="p-3 font-medium">טלפון</th>
                    <th className="p-3 font-medium">נשלחה בתאריך</th>
                    <th className="p-3 font-medium">מיקום בתשפ״ו</th>
                    <th className="p-3 font-medium">בקשה</th>
                    <th className="p-3 font-medium">שיבוץ סופי</th>
                    <th className="p-3 font-medium">סטטוס</th>
                    <th className="p-3 font-medium">צילום העברה</th>
                    <th className="p-3 font-medium">פעולה</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedAllRequests.map(req => (
                    <tr key={req.id} className="hover:bg-slate-50/70">
                      <td className="p-3 text-slate-800 font-medium"><div>{req.firstName} {req.lastName}{req.isDemo && <span className="mr-2 inline-flex rounded-full bg-violet-100 text-violet-800 px-2 py-0.5 text-[10px] font-semibold">דמה</span>}</div><div className="mt-1 text-xs font-normal text-slate-500">נשלחה: {req.timestamp ? new Date(req.timestamp).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "לא ידוע"}</div></td>
                      <td className="p-3 text-slate-800" dir="ltr">{req.phone}</td>
                      <td className="p-3 whitespace-nowrap text-xs text-slate-600">{req.timestamp ? new Date(req.timestamp).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                      <td className="p-3">
                        {req.isLastYearUser && req.lastYearSeats?.length ? <><div className="font-mono text-xs text-blue-800">{req.lastYearSeats.join(", ")}</div><div className="text-xs text-slate-500 mt-1">{req.lastYearChoice === "same-seat" ? "ביקש לשמור" : "ביקש לשנות"}</div></> : <span className="text-slate-400">לא נמצא</span>}
                      </td>
                      <td className="p-3"><div className="font-mono text-xs text-slate-800">{(req.requestedSeats ?? req.seats).join(", ")}</div></td>
                      <td className="p-3">
                        {req.status === "approved" ? <><div className="font-mono text-xs text-emerald-800">{req.seats.join(", ") || "ללא מושב"}</div>{req.seatChanges?.length ? <div className="text-xs text-slate-500 mt-1">שונה לאחר אישור: {req.seatChanges.map(change => change.seatId).join(", ")}</div> : null}</> : <span className="text-slate-400">{req.status === "pending" ? "טרם שובץ" : "לא שובץ"}</span>}
                      </td>
                      <td className="p-3">
                        <span className={clsx(
                          "inline-flex px-2 py-1 rounded-full text-xs font-medium",
                          req.status === "approved" && "bg-emerald-100 text-emerald-800",
                          req.status === "pending" && "bg-amber-100 text-amber-800",
                          req.status === "rejected" && "bg-rose-100 text-rose-800"
                        )}>
                          {req.status === "approved" ? "אושרה" : req.status === "pending" ? "ממתינה" : "נדחתה"}
                        </span>
                        {req.rejectionReason && <p className="text-xs text-rose-700 mt-1">סיבה: {req.rejectionReason}</p>}
                      </td>
                      <td className="p-3">
                        {req.paymentImage ? (
                          <button onClick={() => setViewImage(paymentImageUrl(req.paymentImage))} className="w-16 h-16 border border-slate-200 rounded overflow-hidden hover:ring-2 hover:ring-indigo-400" title="הגדל צילום">
                            <img src={paymentImageUrl(req.paymentImage)} alt={`צילום העברה של ${req.firstName} ${req.lastName}`} className="w-full h-full object-cover" />
                          </button>
                        ) : <span className="text-slate-400">לא הועלה</span>}
                      </td>
                      <td className="p-3">
                        {req.status === "pending" ? <div className="flex gap-2"><button type="button" disabled={Boolean(approvingRequestId)} onClick={() => void approveRequest(req.id)} className="touch-manipulation bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm disabled:cursor-wait disabled:opacity-60">{approvingRequestId === req.id ? "מאשר..." : "אשר"}</button><button type="button" onClick={() => openReassignment(req)} className="touch-manipulation bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm">שבץ מחדש</button><button type="button" onClick={() => { setRejectingRequest(req); setRejectionReason(""); }} className="touch-manipulation bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm">דחה</button></div> : req.status === "approved" ? <button type="button" onClick={() => reopenApprovedRequest(req)} className="touch-manipulation bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm">ערוך שיבוץ</button> : <span className="text-slate-400 text-xs">—</span>}
                      </td>
                    </tr>
                  ))}
                  {allRequests.length === 0 && (
                    <tr><td colSpan={9} className="p-8 text-center text-slate-500">לא נמצאו בקשות.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {data.auditLog && data.auditLog.length > 0 && <div className="border border-slate-200 rounded-lg p-4"><h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-3"><History className="w-4 h-4" /> יומן שיבוצים אחרון</h3><div className="max-h-52 overflow-y-auto space-y-2 text-sm">{data.auditLog.slice(0, 20).map(item => <div key={item.id} className="flex flex-wrap gap-x-2 text-slate-600"><span>{new Date(item.timestamp).toLocaleString("he-IL")}</span><strong>{item.action}</strong>{item.seatId && <span>מושב {item.seatId}</span>}{item.fromOwner && <span>{item.fromOwner} ←</span>}{item.toOwner && <span>→ {item.toOwner}</span>}{item.details && <span>{item.details}</span>}</div>)}</div></div>}
          </div>
        )}

        {activeTab === "conflicts" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-800">התנגשויות ומושבים כפולים</h2>
            {!hasConflicts ? (
              <div className="py-8 text-center text-slate-500 bg-slate-50 rounded-lg">
                מצוין, אין בקשות כפולות על מושבים.
              </div>
            ) : (
              <div className="space-y-6">
                {conflictedSeats.map(seatId => {
                  const conflictingRequests = allPendingRequests.filter(r => requestedSeatsCount[seatId].includes(r.id));
                  return (
                    <div key={seatId} className="border border-red-200 bg-red-50/50 rounded-lg p-4">
                      <h3 className="font-bold text-red-800 text-lg mb-3 flex items-center gap-2">
                        מושב {seatId} <span className="text-sm font-normal text-red-600">(מבוקש ע"י {conflictingRequests.length} אנשים)</span>
                      </h3>
                      <button
                        onClick={() => setViewRequestSeats({ seats: [seatId] })}
                        className="mb-3 text-indigo-700 hover:text-indigo-900 bg-white border border-indigo-200 hover:border-indigo-400 px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1"
                      >
                        <Eye className="w-4 h-4" /> הצג מושב במפה
                      </button>
                      
                      <div className="flex gap-3 flex-wrap">
                        {conflictingRequests.map(req => (
                          <button
                            key={req.id}
                            onClick={() => {
                              setResolvingConflict({
                                seatId,
                                requests: conflictingRequests,
                                winnerReqId: req.id,
                                loserReplacements: {},
                              });
                            }}
                            className="bg-white border border-red-200 shadow-sm hover:border-red-400 hover:shadow text-slate-800 px-4 py-3 rounded-lg flex flex-col items-start gap-1 transition-all"
                          >
                            <span className="font-semibold text-sm">
                              {req.firstName} {req.lastName}
                            </span>
                            {req.isLastYearUser && req.lastYearSeats?.includes(seatId) && (
                              <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                <UserCheck className="w-3 h-3" /> ישב בכיסא זה בתשפ״ו
                              </span>
                            )}
                            <span className="text-xs text-slate-500 mt-1">בחר כזוכה למושב זה</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "mapCurrent" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-800">מפת תשפ"ז (עריכה וצפייה)</h2>
            <p className="text-sm text-slate-500 mb-1">לחץ על מושב כדי לטפל בבקשה, בכפילות או לערוך בעלות ידנית.</p>
            <div className="flex flex-wrap gap-3 text-xs font-medium"><span className="rounded px-2 py-1 bg-rose-200 text-rose-950 border border-rose-500">אדום: מושב מאושר</span><span className="rounded px-2 py-1 bg-amber-100 text-amber-900 border border-amber-400">צהוב: ממתין לאישור</span><span className="rounded px-2 py-1 bg-violet-100 text-violet-900 border border-violet-500">סגול: כפילות</span></div>
            <div className="overflow-x-auto pb-4" dir="ltr">
              <div 
                className="inline-grid gap-0.5 mx-auto p-6 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm relative"
                style={{
                  gridTemplateColumns: `repeat(${MAX_COLS}, 60px)`,
                  gridTemplateRows: `repeat(${MAX_ROWS}, 64px)`,
                }}
              >

                {/* Static Elements Modal */}
                <div style={{ gridRow: '14 / 19', gridColumn: '1 / 35' }} className="rounded-3xl w-full h-full bg-slate-100/60 border border-slate-200/60 pointer-events-none z-0">
                </div>
                <div style={{ gridRow: '1 / 2', gridColumn: '14 / 18' }} className="bg-indigo-100 border border-indigo-200 flex items-center justify-center text-sm font-bold text-indigo-900 shadow-sm pointer-events-none z-0">
                  ארון קודש
                </div>
                <div style={{ gridRow: '5 / 8', gridColumn: '14 / 17', width: '184px', justifySelf: 'start' }} className="bg-indigo-50/80 border border-indigo-200/50 flex items-center justify-center text-base font-bold text-indigo-800 shadow-sm pointer-events-none z-20">
                  בימה
                </div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '3 / 13', gridColumn: '34', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  עזרת גברים
                </div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '15 / 18', gridColumn: '1', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  עזרת נשים
                </div>

                {SEATS.map((seat) => {
                  const seatData = data.seats[seat.id];
                  const status = seatData?.status || "available";
                  const owner = seatData?.owner || "";
                  const pendingRequestsForSeat = allPendingRequests.filter(request => request.seats.includes(seat.id));
                  const isConflict = pendingRequestsForSeat.length > 1;
                  const isPending = !isConflict && pendingRequestsForSeat.length === 1;
                  const seatText = isConflict ? "כפילות" : isPending ? "ממתין לאישור" : status === "taken" ? owner : seat.label;
                  
                  return (
                    <button
                      key={seat.id}
                      onClick={() => {
                        if (isConflict) {
                          setResolvingConflict({ seatId: seat.id, requests: pendingRequestsForSeat, loserReplacements: {} });
                        } else if (isPending) {
                          setViewRequestSeats({ reqId: pendingRequestsForSeat[0].id, seats: pendingRequestsForSeat[0].seats, canApprove: true });
                        } else {
                          setEditSeat({ id: seat.id, owner });
                        }
                      }}
                      className={clsx(
                        "flex items-center justify-center text-center leading-[1.25] font-semibold shadow-sm border transition-colors hover:brightness-95 overflow-hidden break-words rounded-sm py-4",
                        seatText.length > 15 ? "text-[10px] px-1" : seatText.length > 10 ? "text-[12px] px-2" : "text-[15px] px-4",
                        isConflict && "bg-violet-200 text-violet-950 border-violet-600 ring-1 ring-violet-400",
                        isPending && "bg-amber-100 text-amber-950 border-amber-500 ring-1 ring-amber-300",
                        !isConflict && !isPending && status === "available" && "bg-white text-slate-700 border-slate-300",
                        !isConflict && !isPending && status === "taken" && "bg-rose-200 text-rose-950 border-rose-600 ring-1 ring-rose-400",
                      )}
                      style={{ gridRow: seat.row + 1, gridColumn: seat.col + 1 }}
                    >
                      {seatText}
                    </button>
                  );
                })}
                

              </div>
            </div>
          </div>
        )}

        {activeTab === "mapLastYear" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-800">מפת תשפ"ו (שנה שעברה)</h2>
            <p className="text-sm text-slate-500">לחץ על מושב כדי לעדכן את השיבוץ ההיסטורי. הנתון המעודכן ישמש גם לזיהוי הלקוח בטופס.</p>
            <div className="overflow-x-auto pb-4" dir="ltr">
              <div 
                className="inline-grid gap-1 mx-auto p-6 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm relative"
                style={{
                  gridTemplateColumns: `repeat(${MAX_COLS}, 60px)`,
                  gridTemplateRows: `repeat(${MAX_ROWS}, 64px)`,
                }}
              >

                {/* Static Elements Modal */}
                <div style={{ gridRow: '14 / 19', gridColumn: '1 / 35' }} className="rounded-3xl w-full h-full bg-slate-100/60 border border-slate-200/60 pointer-events-none z-0">
                </div>
                <div style={{ gridRow: '1 / 2', gridColumn: '14 / 18' }} className="bg-indigo-100 border border-indigo-200 flex items-center justify-center text-sm font-bold text-indigo-900 shadow-sm pointer-events-none z-0">
                  ארון קודש
                </div>
                <div style={{ gridRow: '5 / 8', gridColumn: '14 / 17', width: '184px', justifySelf: 'start' }} className="bg-indigo-50/80 border border-indigo-200/50 flex items-center justify-center text-base font-bold text-indigo-800 shadow-sm pointer-events-none z-20">בימה</div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '3 / 13', gridColumn: '34', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  עזרת גברים
                </div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '15 / 18', gridColumn: '1', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  עזרת נשים
                </div>

                {SEATS.map((seat) => {
                  // Find owner from lastYearUsers
                  const user = data.lastYearUsers.find(u => u.seats.includes(seat.id));
                  const seatText = user ? `${user.firstName} ${user.lastName}`.trim() : seat.label;
                  
                  return (
                    <button
                      key={seat.id}
                      onClick={() => setEditLastYearSeat({ id: seat.id, owner: user ? `${user.firstName} ${user.lastName}`.trim() : "" })}
                      className={clsx(
                        "flex items-center justify-center text-center leading-[1.25] font-semibold shadow-sm border rounded-sm overflow-hidden break-words py-4 z-10 relative",
                        seatText.length > 15 ? "text-[10px] px-1" : seatText.length > 10 ? "text-[12px] px-2" : "text-[15px] px-4",
                        user ? "bg-indigo-100 text-indigo-950 border-indigo-400 ring-1 ring-indigo-200" : "bg-white text-slate-400 border-slate-300"
                      )}
                      style={{ gridRow: seat.row + 1, gridColumn: seat.col + 1 }}
                    >
                      {seatText}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === "print" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 items-start justify-between print:hidden">
              <div>
                <h2 className="text-xl font-semibold text-slate-800">תצוגה להדפסה — מפת בית הכנסת</h2>
              </div>
              <button onClick={printMap} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2">
                <Printer className="w-4 h-4" /> הדפס / שמור כ־PDF
              </button>
            </div>
            <div id="print-map" className="print-map-preview pb-4" dir="ltr">
              <div className="print-map-title text-center text-slate-800 font-bold text-xl mb-5" dir="rtl">בית כנסת אחוות מנחם</div>
              <div className="print-map-grid inline-grid gap-0.5 mx-auto p-6 bg-white rounded-2xl border-2 border-slate-500 relative" style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 60px)`, gridTemplateRows: `repeat(${MAX_ROWS}, 64px)` }}>
                <div style={{ gridRow: '14 / 19', gridColumn: '1 / 35' }} className="rounded-3xl w-full h-full bg-slate-50 border border-slate-200 pointer-events-none" />
                <div style={{ gridRow: '1 / 2', gridColumn: '14 / 18' }} className="bg-slate-100 border border-slate-400 flex items-center justify-center text-base font-bold text-slate-800 pointer-events-none">ארון קודש</div>
                <div style={{ gridRow: '5 / 8', gridColumn: '14 / 17', width: '184px', justifySelf: 'start' }} className="bg-slate-50 border border-slate-400 flex items-center justify-center text-base font-bold text-slate-800 pointer-events-none">בימה</div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-600 tracking-widest pointer-events-none" style={{ gridRow: '3 / 13', gridColumn: '34', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>עזרת גברים</div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-600 tracking-widest pointer-events-none" style={{ gridRow: '15 / 18', gridColumn: '1', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>עזרת נשים</div>
                {SEATS.map(seat => {
                  const seatData = data.seats[seat.id];
                  const owner = seatData?.status === "taken" ? seatData.owner?.trim() : "";
                  return <div key={seat.id} style={{ gridRow: seat.row + 1, gridColumn: seat.col + 1 }} className={clsx("flex items-center justify-center text-center text-[15px] leading-[1.25] font-semibold border rounded-sm overflow-hidden break-words px-4 py-4", owner ? "bg-slate-100 border-slate-600 text-slate-900" : "bg-white border-slate-300")}>{owner}</div>;
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-4 max-w-sm">
            <h2 className="text-xl font-semibold text-slate-800">הגדרות מנהל</h2>
            <div className="mb-8">
              <button 
                onClick={() => {
                  logout();
                  navigate("/");
                }}
                className="flex items-center gap-2 bg-rose-50 text-rose-700 px-4 py-2 rounded-lg font-medium hover:bg-rose-100 transition-colors border border-rose-200 w-full justify-center"
              >
                <LogOut className="w-4 h-4" />
                התנתק מהמערכת
              </button>
            </div>
            
            <form onSubmit={changePassword} className="bg-slate-50 border border-slate-200 p-6 rounded-lg space-y-4">
              <h3 className="font-medium text-slate-700 flex items-center gap-2">
                <Key className="w-4 h-4" />
                שינוי סיסמת התחברות
              </h3>
              
              <div>
                <label className="block text-sm text-slate-600 mb-1">סיסמה חדשה</label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-left"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">אימות סיסמה חדשה</label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-left"
                  dir="ltr"
                />
              </div>
              <button 
                type="submit" 
                className="w-full bg-indigo-600 text-white font-medium py-2 hover:bg-indigo-700 transition-colors"
              >
                שמור סיסמה חדשה
              </button>
              {passMsg && <p className="text-sm font-medium text-blue-700 mt-2">{passMsg}</p>}
            </form>
          </div>
        )}


      </div>

      {/* Reassign Request Modal */}
      <AnimatePresence>
        {reassigningRequest && (
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[calc(100vh-1.5rem)] overflow-y-auto p-4 sm:p-6 my-auto space-y-4"
            >
              <div className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-slate-800">שיבוץ חלופי — {reassigningRequest.firstName} {reassigningRequest.lastName}</h3>
                  <p className="text-sm text-slate-500 mt-1">בחר {reassigningRequest.seats.length} מושבים פנויים במקום הבקשה המקורית: {reassigningRequest.seats.join(", ")}</p>
                </div>
                <button onClick={() => setReassigningRequest(null)} className="text-slate-400 hover:text-slate-700 p-2"><X className="w-5 h-5" /></button>
              </div>

              <div className="overflow-x-auto pb-4" dir="ltr">
                <div className="inline-grid gap-1.5 mx-auto p-6 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm relative" style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 38px)`, gridTemplateRows: `repeat(${MAX_ROWS}, 26px)` }}>
                  <div style={{ gridRow: '14 / 19', gridColumn: '1 / 35' }} className="rounded-3xl w-full h-full bg-slate-100/60 border border-slate-200/60 pointer-events-none z-0" />
                  <div style={{ gridRow: '1 / 2', gridColumn: '14 / 18' }} className="bg-indigo-100 border border-indigo-200 flex items-center justify-center text-sm font-bold text-indigo-900 shadow-sm pointer-events-none z-0">ארון קודש</div>
                  <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '3 / 13', gridColumn: '34', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>עזרת גברים</div>
                  <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '15 / 18', gridColumn: '1', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>עזרת נשים</div>
                  {SEATS.map(seat => {
                    const isSelected = reassignmentSeats.includes(seat.id);
                    const seatData = data.seats[seat.id];
                    const isAvailable = !seatData || seatData.status === "available";
                    return (
                      <button
                        key={seat.id}
                        disabled={!isAvailable && !isSelected}
                        onClick={() => setReassignmentSeats(current => {
                          if (current.includes(seat.id)) return current.filter(id => id !== seat.id);
                          if (current.length === reassigningRequest.seats.length) return current;
                          return [...current, seat.id];
                        })}
                        className={clsx(
                          "flex items-center justify-center text-xs font-medium rounded-full shadow-sm border transition-colors z-10 relative",
                          isSelected ? "bg-violet-600 text-white border-violet-800 ring-2 ring-violet-300" :
                          isAvailable ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" :
                          "bg-stone-200 text-slate-400 border-slate-300 cursor-not-allowed"
                        )}
                        style={{ gridRow: seat.row + 1, gridColumn: seat.col + 1 }}
                      >
                        {seat.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
                <span className="text-sm font-medium text-slate-600">נבחרו {reassignmentSeats.length} מתוך {reassigningRequest.seats.length} מושבים</span>
                <div className="flex gap-3">
                  <button onClick={() => setReassigningRequest(null)} className="bg-slate-200 text-slate-700 px-5 py-2 rounded-lg font-medium hover:bg-slate-300">ביטול</button>
                  <button onClick={resolveRequest} disabled={reassignmentSeats.length !== reassigningRequest.seats.length} className="bg-violet-600 text-white px-5 py-2 rounded-lg font-medium hover:bg-violet-700 disabled:opacity-50 disabled:bg-slate-300">אשר שיבוץ חלופי</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {false && activeTab === "allRequests" && longPressId && (() => {
          const request = allRequests.find(item => item.id === longPressId);
          if (!request) return null;
          return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-5">
              <h3 className="text-xl font-bold text-slate-800">מחיקת בקשה</h3>
              <p className="text-slate-600">למחוק את הבקשה של <strong>{request.firstName} {request.lastName}</strong>? פעולה זו תשחרר את המושבים שבבקשה, אם הם עדיין שייכים לה.</p>
              <div className="flex gap-3"><button onClick={() => { setLongPressId(null); deleteRequest(request.id); }} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5 rounded-lg">מחק בקשה</button><button onClick={() => setLongPressId(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 rounded-lg">ביטול</button></div>
            </motion.div>
          </div>;
        })()}
      </AnimatePresence>

      {/* Map View Modal */}
      <AnimatePresence>
        {viewRequestSeats && (
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[calc(100vh-1.5rem)] overflow-y-auto p-4 sm:p-6 my-auto space-y-4"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">
                  {viewedRequest ? `בקשה של ${viewedRequest.firstName} ${viewedRequest.lastName}` : "מושבים מבוקשים"}
                </h3>
                <button onClick={() => setViewRequestSeats(null)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>
              {viewedRequest && <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700 flex flex-wrap gap-x-4 gap-y-1"><span>טלפון: <strong dir="ltr">{viewedRequest.phone}</strong></span><span>מושבים מבוקשים: <strong>{viewedRequest.seats.join(", ")}</strong></span>{viewedRequest.paymentImage && <button onClick={() => setViewImage(paymentImageUrl(viewedRequest.paymentImage))} className="text-indigo-700 font-semibold hover:underline">צפייה בצילום התשלום</button>}</div>}
              
              <div className="overflow-x-auto pb-4" dir="ltr">
                <div 
                  className="inline-grid gap-1.5 mx-auto p-6 bg-slate-50 rounded-2xl border border-slate-200 shadow-sm relative"
                  style={{
                    gridTemplateColumns: `repeat(${MAX_COLS}, 38px)`,
                    gridTemplateRows: `repeat(${MAX_ROWS}, 26px)`,
                  }}
                >

                {/* Static Elements Modal */}
                <div style={{ gridRow: '14 / 19', gridColumn: '1 / 35' }} className="rounded-3xl w-full h-full bg-slate-100/60 border border-slate-200/60 pointer-events-none z-0">
                </div>
                <div style={{ gridRow: '1 / 2', gridColumn: '14 / 18' }} className="bg-indigo-100 border border-indigo-200 flex items-center justify-center text-sm font-bold text-indigo-900 shadow-sm pointer-events-none z-0">
                  ארון קודש
                </div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '3 / 13', gridColumn: '34', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  עזרת גברים
                </div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '15 / 18', gridColumn: '1', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  עזרת נשים
                </div>

                  {SEATS.map((seat) => {
                    const isRequested = viewRequestSeats.seats.includes(seat.id);
                    const seatData = data.seats[seat.id];
                    const status = seatData?.status || "available";
                    
                    return (
                      <div
                        key={seat.id}
                        className={clsx(
                          "flex items-center justify-center text-xs font-medium rounded-full shadow-sm border transition-colors z-10 relative",
                          isRequested ? "bg-indigo-600 text-white border-indigo-800 ring-2 ring-indigo-400 scale-110 shadow-lg" :
                          status === "available" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                          status === "pending" ? "bg-amber-50 text-amber-700 border-amber-200" :
                          "bg-slate-200 text-slate-600 border-slate-300"
                        )}
                        style={{ gridRow: seat.row + 1, gridColumn: seat.col + 1 }}
                      >
                        {seat.label}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-200 gap-3">
                <button
                  onClick={() => setViewRequestSeats(null)}
                  className="bg-slate-200 text-slate-700 px-6 py-2 rounded-lg font-medium hover:bg-slate-300 transition-colors"
                >
                  סגור
                </button>
                {viewRequestSeats.canApprove && viewRequestSeats.reqId && <button
                  type="button"
                  disabled={Boolean(approvingRequestId)}
                  onClick={async () => { if (await approveRequest(viewRequestSeats.reqId!)) setViewRequestSeats(null); }}
                  className="touch-manipulation bg-emerald-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
                >
                  {approvingRequestId === viewRequestSeats.reqId ? "מאשר..." : "אשר בקשה זו"}
                </button>}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Image Viewer Modal */}
      <AnimatePresence>
        {viewImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setViewImage(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative max-w-4xl w-full max-h-screen flex justify-center"
              onClick={e => e.stopPropagation()}
            >
              <button 
                onClick={() => setViewImage(null)}
                className="absolute -top-12 right-0 text-white hover:text-slate-300 transition-colors"
              >
                <X className="w-8 h-8" />
              </button>
              <img src={viewImage} alt="Payment Receipt" className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Conflict Resolution Modal */}
      <AnimatePresence>
        {resolvingConflict && (
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[calc(100vh-1.5rem)] overflow-y-auto p-4 sm:p-6 my-auto flex flex-col gap-4"
            >
              {/* Left panel: Info and Actions */}
              <div className="w-full flex flex-col border-b border-slate-200 pb-4">
                <h3 className="text-xl font-semibold mb-1">טיפול בכפילות: מושב {resolvingConflict.seatId}</h3>
                <div className="mt-4"><h4 className="text-sm font-semibold text-slate-800 mb-2">בחר מי יקבל את המושב:</h4><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{resolvingConflict.requests.map(request => <button key={request.id} onClick={() => setResolvingConflict(current => current ? { ...current, winnerReqId: request.id, loserReplacements: {}, activeLoserId: undefined } : current)} className={clsx("text-right p-2.5 rounded-lg border font-medium transition-colors", resolvingConflict.winnerReqId === request.id ? "bg-emerald-100 border-emerald-500 text-emerald-950" : "bg-white border-slate-200 hover:border-emerald-400")}>{request.firstName} {request.lastName}{request.isLastYearUser && request.lastYearSeats?.includes(resolvingConflict.seatId) ? <span className="block text-xs text-blue-700 mt-1">ישב במושב זה בתשפ״ו</span> : null}</button>)}</div></div>
                {/* Losers that need reassignment */}
                {resolvingConflict.winnerReqId && <div className="mt-6 flex-1">
                  <h4 className="font-medium text-slate-800 mb-3">שבץ מחדש את שאר המבקשים:</h4>
                  <div className="space-y-3">
                    {resolvingConflict.requests.filter(r => r.id !== resolvingConflict.winnerReqId).map(loser => (
                      <button
                        key={loser.id}
                        onClick={() => setReplacementPicker({ loserId: loser.id, requestedSeat: resolvingConflict.seatId })}
                        className={clsx(
                          "w-full text-right p-3 rounded-lg border transition-all text-sm",
                          replacementPicker?.loserId === loser.id ? "bg-blue-50 border-blue-400 ring-1 ring-blue-400" : "bg-white border-slate-200 hover:border-blue-300"
                        )}
                      >
                        <div className="font-semibold text-slate-800 mb-1">{loser.firstName} {loser.lastName}</div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500 text-xs">
                            מושב חלופי: {resolvingConflict.loserReplacements[loser.id] ? (
                              <span className="font-mono font-bold text-blue-700 bg-blue-100 px-1 rounded">{resolvingConflict.loserReplacements[loser.id]}</span>
                            ) : (
                              <span className="text-red-500 font-medium">לא נבחר</span>
                            )}
                          </span>
                          {replacementPicker?.loserId === loser.id && <span className="text-indigo-600 text-[10px] font-bold">בחירת מפה פתוחה</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>}

                <div className="mt-6 pt-4 border-t border-slate-200 flex gap-3">
                  <button 
                    onClick={() => setResolvingConflict(null)}
                    className="flex-1 bg-stone-100 hover:bg-stone-200 text-slate-700 font-medium py-2 transition-colors"
                  >
                    ביטול
                  </button>
                  <button 
                    onClick={resolveConflictSubmit}
                    disabled={!resolvingConflict.winnerReqId || Object.keys(resolvingConflict.loserReplacements).length !== resolvingConflict.requests.length - 1}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 transition-colors disabled:opacity-50 disabled:bg-stone-300 disabled:text-slate-500"
                  >
                    שמור שיבוצים
                  </button>
                </div>
              </div>

              {/* Right panel: Map for selecting replacements */}
              <div className="hidden w-full max-h-[52vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50" dir="ltr">
                <div className="mb-2 text-center text-sm font-medium text-slate-500" dir="rtl">
                  {resolvingConflict.activeLoserId ? "לחץ על מושב פנוי במפה כדי לשבץ אותו" : "בחר משתמש מימין כדי לשבץ לו מושב"}
                </div>
                <div 
                  className="inline-grid gap-1 mx-auto p-5 bg-slate-50 relative"
                  style={{
                    gridTemplateColumns: `repeat(${MAX_COLS}, 46px)`,
                    gridTemplateRows: `repeat(${MAX_ROWS}, 40px)`,
                  }}
                >

                {/* Static Elements Modal */}
                <div style={{ gridRow: '14 / 19', gridColumn: '1 / 35' }} className="rounded-3xl w-full h-full bg-slate-100/60 border border-slate-200/60 pointer-events-none z-0">
                </div>
                <div style={{ gridRow: '1 / 2', gridColumn: '14 / 18' }} className="bg-indigo-100 border border-indigo-200 flex items-center justify-center text-sm font-bold text-indigo-900 shadow-sm pointer-events-none z-0">
                  ארון קודש
                </div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '3 / 13', gridColumn: '34', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  עזרת גברים
                </div>
                <div className="flex items-center justify-center text-lg font-bold text-slate-400 tracking-widest z-0 pointer-events-none" style={{ gridRow: '15 / 18', gridColumn: '1', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  עזרת נשים
                </div>

                  {SEATS.map((seat) => {
                    const isConflictedSeat = seat.id === resolvingConflict.seatId;
                    const isSelectedAsReplacement = Object.values(resolvingConflict.loserReplacements).includes(seat.id);
                    const seatData = data.seats[seat.id];
                    const isAvailable = !seatData || seatData.status === "available";
                    
                    return (
                      <button
                        key={seat.id}
                        disabled={!isAvailable && !isSelectedAsReplacement}
                        onClick={() => {
                          if (resolvingConflict.activeLoserId && isAvailable) {
                            setResolvingConflict(prev => {
                              if (!prev || !prev.activeLoserId) return prev;
                              const nextMap = { ...prev.loserReplacements };
                              nextMap[prev.activeLoserId] = seat.id;
                              return { ...prev, loserReplacements: nextMap };
                            });
                          }
                        }}
                        className={clsx(
                          "flex items-center justify-center text-xs font-medium rounded-full shadow-sm border transition-colors z-10 relative",
                          isConflictedSeat ? "bg-rose-100 text-rose-800 border-rose-300 ring-2 ring-rose-400 scale-110" :
                          isSelectedAsReplacement ? "bg-indigo-600 text-white border-indigo-700 scale-110 shadow-md" :
                          isAvailable ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 cursor-pointer" :
                          "bg-stone-200 text-slate-400 border-slate-300 cursor-not-allowed"
                        )}
                        style={{ gridRow: seat.row + 1, gridColumn: seat.col + 1 }}
                      >
                        {seat.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {replacementPicker && resolvingConflict && (() => {
          const loser = resolvingConflict.requests.find(request => request.id === replacementPicker.loserId);
          if (!loser) return null;
          return <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] p-4 sm:p-6 flex flex-col gap-4" dir="rtl">
              <div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-bold text-slate-800">בחירת מושב חלופי</h3><p className="text-sm text-slate-600 mt-1">בחר מקום חלופי עבור {loser.firstName} {loser.lastName}. סימן × מציין את המושב שביקש ולא קיבל: {replacementPicker.requestedSeat}.</p></div><button onClick={() => setReplacementPicker(null)} className="text-slate-500 hover:text-slate-900 font-medium">חזרה לפסיקה</button></div>
              <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4" dir="ltr">
                <div className="inline-grid gap-1 min-w-max relative" style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 52px)`, gridTemplateRows: `repeat(${MAX_ROWS}, 56px)` }}>
                  <div style={{ gridRow: "14 / 19", gridColumn: "1 / 35" }} className="rounded-2xl bg-slate-100/70 border border-slate-200 pointer-events-none" />
                  <div style={{ gridRow: "1 / 2", gridColumn: "14 / 18" }} className="bg-indigo-100 border border-indigo-200 flex items-center justify-center text-xs font-bold text-indigo-900 pointer-events-none">ארון קודש</div>
                  <div style={{ gridRow: "5 / 8", gridColumn: "14 / 17", width: "158px", justifySelf: "start" }} className="bg-indigo-50 border border-indigo-200 flex items-center justify-center text-sm font-bold text-indigo-800 pointer-events-none">בימה</div>
                  {SEATS.map(seat => {
                    const seatData = data.seats[seat.id];
                    const isRequested = seat.id === replacementPicker.requestedSeat;
                    const isSelected = resolvingConflict.loserReplacements[loser.id] === seat.id;
                    const alreadySelected = Object.entries(resolvingConflict.loserReplacements).some(([requestId, value]) => requestId !== loser.id && value === seat.id);
                    const isAvailable = (!seatData || seatData.status === "available") && !alreadySelected;
                    return <button key={seat.id} disabled={!isAvailable || isRequested} onClick={() => { setResolvingConflict(current => current ? { ...current, loserReplacements: { ...current.loserReplacements, [loser.id]: seat.id }, activeLoserId: undefined } : current); setReplacementPicker(null); }} style={{ gridRow: seat.row + 1, gridColumn: seat.col + 1 }} className={clsx("border rounded-sm font-semibold text-xs transition-colors", isRequested && "bg-rose-600 text-white border-rose-800 cursor-not-allowed", isSelected && "bg-indigo-600 text-white border-indigo-800", !isRequested && !isSelected && isAvailable && "bg-emerald-50 hover:bg-emerald-200 text-emerald-900 border-emerald-400", !isRequested && !isSelected && !isAvailable && "bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed")}>{isRequested ? "×" : isSelected ? seat.id : seat.label}</button>;
                  })}
                </div>
              </div>
              <p className="text-xs text-slate-500">ירוק: פנוי · אפור: לא זמין · × אדום: המושב המבוקש · כחול: הבחירה החדשה</p>
            </motion.div>
          </div>;
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {relocatingSeat && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] p-5 space-y-4" dir="rtl">
              <div className="flex items-start justify-between gap-4">
                <div><h3 className="text-xl font-bold text-slate-800">בחירת מושב חדש מהמפה</h3><p className="text-sm text-slate-600 mt-1">בחר מושב פנוי עבור {relocatingSeat.owner}. המושב הנוכחי: {relocatingSeat.id}.</p></div>
                <button onClick={() => setRelocatingSeat(null)} className="text-slate-500 hover:text-slate-800 font-medium">סגירה</button>
              </div>
              <div className="overflow-auto max-h-[72vh] rounded-xl border border-slate-200 bg-slate-50 p-5" dir="ltr">
                <div className="inline-grid gap-0.5 min-w-max relative" style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 52px)`, gridTemplateRows: `repeat(${MAX_ROWS}, 56px)` }}>
                  <div style={{ gridRow: "14 / 19", gridColumn: "1 / 35" }} className="rounded-2xl bg-slate-100/70 border border-slate-200 pointer-events-none" />
                  <div style={{ gridRow: "1 / 2", gridColumn: "14 / 18" }} className="bg-indigo-100 border border-indigo-200 flex items-center justify-center text-xs font-bold text-indigo-900 pointer-events-none">ארון קודש</div>
                  <div style={{ gridRow: "5 / 8", gridColumn: "14 / 17", width: "158px", justifySelf: "start" }} className="bg-indigo-50 border border-indigo-200 flex items-center justify-center text-sm font-bold text-indigo-800 pointer-events-none">בימה</div>
                  {SEATS.map((seat) => {
                    const isSource = seat.id === relocatingSeat.id;
                    const available = !data.seats[seat.id] || data.seats[seat.id].status === "available";
                    const seatInfo = data.seats[seat.id];
                    return <button key={seat.id} disabled={!available || isSource} onClick={() => { if (window.confirm(`להעביר את ${relocatingSeat.owner} ממושב ${relocatingSeat.id} למושב ${seat.id}?`)) moveSeat(seat.id); }} style={{ gridRow: seat.row + 1, gridColumn: seat.col + 1 }} className={clsx("border rounded-sm font-semibold text-xs leading-tight px-1 transition-colors", isSource && "bg-violet-700 text-white border-violet-900 cursor-not-allowed", !isSource && available && "bg-emerald-50 hover:bg-emerald-200 text-emerald-900 border-emerald-400", !isSource && !available && "bg-rose-100 text-rose-800 border-rose-300 cursor-not-allowed")}>{isSource ? `${seat.id}\nמושב נוכחי` : available ? seat.id : seatInfo?.owner || seat.id}</button>;
                  })}
                </div>
              </div>
              <p className="text-xs text-slate-500">ירוק: מושב פנוי לבחירה · סגול: המושב הנוכחי · אדום: תפוס</p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeveloperAccess && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-5" dir="rtl">
              <div className="flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold text-slate-800">הגדרות מפתח</h3><p className="text-sm text-slate-500 mt-1">הגישה פעילה רק בדפדפן ובמכשיר הזה.</p></div><button onClick={() => setShowDeveloperAccess(false)} className="text-slate-500 hover:text-slate-800">סגירה</button></div>
              {!developerToken ? <form onSubmit={unlockDeveloper} className="space-y-4"><label className="block text-sm font-medium text-slate-700">סיסמת מפתח<input autoFocus type="password" value={developerPassword} onChange={event => setDeveloperPassword(event.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-left" dir="ltr" /></label><button type="submit" disabled={!developerPassword} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-2 rounded-lg disabled:opacity-50">כניסה להגדרות מפתח</button>{developerMessage && <p className="text-sm text-rose-700">{developerMessage}</p>}</form> : <div className="space-y-4"><div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">פעולות אלה מיועדות להכנת סביבת בדיקה בלבד. מחיקה אינה ניתנת לשחזור.</div><button onClick={() => runDeveloperAction("/api/admin/developer/create-demo", "ליצור כעת 22 בקשות הדגמה חדשות? הבקשות הקיימות יישארו במערכת.")} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg">צור נתוני דמה</button><button onClick={() => runDeveloperAction("/api/admin/developer/clear-requests", "למחוק את כל הבקשות, האישורים וצילומי התשלום הקיימים? פעולה זו אינה ניתנת לשחזור.")} className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold py-3 rounded-lg">מחק את כל הבקשות והאישורים</button><button onClick={() => { localStorage.removeItem("synagogue-developer-token"); setDeveloperToken(""); setDeveloperMessage("מצב המפתח ננעל במכשיר זה."); }} className="w-full text-slate-600 hover:text-slate-900 text-sm font-medium py-2">נעל מצב מפתח במכשיר זה</button>{developerMessage && <p className="text-sm text-indigo-700 text-center">{developerMessage}</p>}</div>}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editLastYearSeat && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4" dir="rtl">
              <h3 className="text-lg font-bold text-slate-800">עריכת מפת תשפ״ו — מושב {editLastYearSeat.id}</h3>
              <p className="text-sm text-slate-600">השם כאן הוא מקור הנתונים לזיהוי השיבוץ משנה שעברה.</p>
              <label className="block text-sm text-slate-700">שם הלקוח<input autoFocus value={editLastYearSeat.owner} onChange={event => setEditLastYearSeat({ ...editLastYearSeat, owner: event.target.value })} placeholder="השאר ריק כדי לפנות מושב" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg" /></label>
              <div className="flex gap-3"><button onClick={saveLastYearSeat} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded-lg">שמור</button><button onClick={() => setEditLastYearSeat(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 rounded-lg">ביטול</button></div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Seat Modal */}
      <AnimatePresence>
        {rejectingRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-800">דחיית בקשה של {rejectingRequest.firstName} {rejectingRequest.lastName}</h3>
              <label className="block text-sm text-slate-600">סיבת הדחייה<textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} className="mt-1 w-full min-h-24 px-3 py-2 border border-slate-300 rounded-lg" placeholder="לדוגמה: אין אפשרות לשבץ את המושבים שביקשת" /></label>
              <div className="flex gap-2"><button onClick={rejectRequest} disabled={!rejectionReason.trim()} className="flex-1 bg-rose-600 text-white font-medium py-2 rounded-lg disabled:opacity-50">דחה בקשה</button><button onClick={() => setRejectingRequest(null)} className="flex-1 bg-slate-100 text-slate-700 font-medium py-2 rounded-lg">ביטול</button></div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Seat Modal */}
      <AnimatePresence>
        {editSeat && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4"
            >
              <h3 className="text-lg font-bold text-slate-800 border-b pb-2">עריכת מושב — מספר מושב: {editSeat.id}</h3>
              <div>
                <label className="block text-sm text-slate-600 mb-1">שם הלקוח (בעלים)</label>
                <input 
                  type="text" 
                  value={editSeat.owner} 
                  onChange={e => setEditSeat({ ...editSeat, owner: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="הזן שם כדי לתפוס מושב"
                />
              </div>
              <div className="flex gap-2 pt-4">
                <button 
                  onClick={() => overrideSeat(editSeat.id, "taken", editSeat.owner)}
                  disabled={!editSeat.owner.trim()}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 transition-colors disabled:opacity-50"
                >
                  שמור בעלות
                </button>
                <button 
                  onClick={() => overrideSeat(editSeat.id, "available", "")}
                  className="flex-1 bg-red-100 hover:bg-red-200 text-red-700 font-medium py-2 transition-colors"
                >
                  פנה מושב
                </button>
              </div>
              {editSeat.owner.trim() && <div className="pt-3 border-t border-slate-200"><button onClick={() => setRelocatingSeat({ id: editSeat.id, owner: editSeat.owner })} className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium py-2 rounded-lg">שבץ במושב אחר דרך המפה</button></div>}
              <button 
                onClick={() => setEditSeat(null)}
                className="w-full mt-2 text-slate-500 hover:text-slate-700 text-sm font-medium py-2"
              >
                ביטול
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
