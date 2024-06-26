import { SupabaseClient, Session } from "@supabase/supabase-js"
import { Database } from "./DatabaseDefinitions"

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient<Database>
      supabaseServiceRole: SupabaseClient<Database>
      safeGetSession(): Promise<{ session: Session | null; user: User | null }>
    }
    interface PageData {
      session: Session | null
    }
    // interface Error {}
    // interface Platform {}
  }
}

declare module '@supabase/supabase-js' {
  interface SupabaseClient {
    rpc(
      fn: 'check_user_exists',
      params: { email: string }
    ): Promise<{ data: boolean | null; error: PostgrestError | null }>;
  }
}

export {}
