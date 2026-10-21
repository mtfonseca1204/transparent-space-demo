import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseAdminInstance: SupabaseClient | null = null;

function getSupabaseAdminClient(): SupabaseClient {
  if (supabaseAdminInstance) return supabaseAdminInstance;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local, or set DEV_LOCAL_AUTH=true for local demo UI.",
    );
  }

  supabaseAdminInstance = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseAdminInstance;
}

/**
 * Server-side Supabase client using the service role key.
 * Lazily initialized so local dev can run with DEV_LOCAL_AUTH when Supabase is absent.
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseAdminClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
