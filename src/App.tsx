import React from "react";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { PublicLayout } from "./components/PublicLayout";
import { AdminLayout } from "./components/AdminLayout";
import { Home } from "./pages/Home";
import { SeatSelection } from "./pages/SeatSelection";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AdminLogin } from "./pages/AdminLogin";
import { useStore } from "./store";

function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const isAdminAuth = useStore((state) => state.isAdminAuth);
  return isAdminAuth ? <>{children}</> : <Navigate to="/admin/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="select" element={<SeatSelection />} />
        </Route>
        
        <Route path="/admin">
          <Route path="login" element={<AdminLogin />} />
          <Route 
            path="dashboard" 
            element={
              <ProtectedAdminRoute>
                <AdminLayout />
              </ProtectedAdminRoute>
            } 
          >
            <Route index element={<AdminDashboard />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

