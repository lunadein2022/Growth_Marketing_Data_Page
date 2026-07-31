// Auth seam — Supabase only. Firebase has been removed.
// Kept as a thin indirection so screens import a stable auth API regardless of
// the backend.
import {
  hasSupabaseConfig,
  signInWithGoogle as supabaseSignInWithGoogle,
  signOutFromSupabase,
  subscribeToSupabaseUser,
} from "./supabaseClient";

export type DashboardUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

export function hasAuthConfig() {
  return hasSupabaseConfig();
}

export function subscribeToAuthUser(callback: (user: DashboardUser | null) => void) {
  return subscribeToSupabaseUser(callback);
}

export async function signInWithGoogle(): Promise<DashboardUser | null> {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase 환경변수가 설정되지 않았습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 설정하세요.");
  }
  return supabaseSignInWithGoogle();
}

export async function signOutFromAuth() {
  if (hasSupabaseConfig()) return signOutFromSupabase();
}
