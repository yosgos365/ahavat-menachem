import { create } from 'zustand';

interface AppState {
  isAdminAuth: boolean;
  adminToken: string | null;
  setAdminAuth: (isAuth: boolean, token?: string) => void;
  logout: () => void;
}

export const useStore = create<AppState>((set) => ({
  isAdminAuth: !!localStorage.getItem('adminToken'),
  adminToken: localStorage.getItem('adminToken'),
  setAdminAuth: (isAuth, token) => {
    if (token) {
      localStorage.setItem('adminToken', token);
    }
    set({ isAdminAuth: isAuth, adminToken: token || null });
  },
  logout: () => {
    localStorage.removeItem('adminToken');
    set({ isAdminAuth: false, adminToken: null });
  },
}));
