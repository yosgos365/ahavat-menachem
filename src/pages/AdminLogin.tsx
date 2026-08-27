import React from "react";
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useStore } from "../store";
import { Lock, ArrowRight } from "lucide-react";

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const setAdminAuth = useStore((state) => state.setAdminAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(false);
    
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      
      const data = await res.json();
      if (data.success) {
        setAdminAuth(true, data.token);
        navigate("/admin/dashboard");
      } else {
        setError(true);
      }
    } catch (err) {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative" dir="rtl">
      <Link to="/" className="absolute top-6 right-6 flex items-center gap-2 text-stone-600 hover:text-blue-600 font-medium transition-colors">
        <ArrowRight className="w-5 h-5" />
        חזור לדף הבית
      </Link>
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center text-blue-600">
          <Lock className="w-12 h-12" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-stone-900">
          כניסת מנהל
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-stone-200">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-stone-700">
                סיסמה
              </label>
              <div className="mt-1">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm placeholder-stone-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-left"
                  dir="ltr"
                />
              </div>
            </div>

            {error && (
              <div className="text-red-600 text-sm font-medium">
                סיסמה שגויה, נסה שוב.
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {isLoading ? "מתחבר..." : "היכנס"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
