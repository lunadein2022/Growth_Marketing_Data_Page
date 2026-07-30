import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type SupabaseDashboardUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

let client: SupabaseClient | null = null;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabaseClient() {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase config is missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }

  if (!client) {
    client = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return client;
}

export function toDashboardUser(user: User | null): SupabaseDashboardUser | null {
  if (!user) return null;

  return {
    uid: user.id,
    email: user.email ?? null,
    displayName:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      null,
  };
}

export function subscribeToSupabaseUser(callback: (user: SupabaseDashboardUser | null) => void) {
  if (!hasSupabaseConfig()) {
    callback(null);
    return () => undefined;
  }

  const supabase = getSupabaseClient();

  // Emit the current session immediately, then subscribe to changes.
  supabase.auth.getUser().then(({ data }) => callback(toDashboardUser(data.user)));

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(toDashboardUser(session?.user ?? null));
  });

  return () => subscription.unsubscribe();
}

export async function signInWithGoogle() {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
      queryParams: { prompt: "select_account" },
    },
  });

  if (error) throw error;
  // OAuth is redirect-based; the resolved user arrives via subscribeToSupabaseUser after redirect.
  return null;
}

export async function signOutFromSupabase() {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
