// src/hooks.server.ts
import {
  PRIVATE_SUPABASE_SERVICE_ROLE, 
  VITE_PUBLIC_SUPABASE_URL,
  VITE_PUBLIC_SUPABASE_ANON_KEY,
} from "$env/static/private"
import { createSupabaseServerClient } from "@supabase/auth-helpers-sveltekit"
import { createClient } from "@supabase/supabase-js"
import type { Handle } from "@sveltejs/kit"

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createSupabaseServerClient({
    supabaseUrl: VITE_PUBLIC_SUPABASE_URL,
    supabaseKey: VITE_PUBLIC_SUPABASE_ANON_KEY,
    event,
  })

  event.locals.supabaseServiceRole = createClient(
    VITE_PUBLIC_SUPABASE_URL,
    PRIVATE_SUPABASE_SERVICE_ROLE,
    { auth: { persistSession: false } },
  )

  /**
   * Unlike `supabase.auth.getSession()`, which returns the session _without_
   * validating the JWT, this function also calls `getUser()` to validate the
   * JWT before returning the session.
   */
  event.locals.safeGetSession = async () => {
    const {
      data: { session },
    } = await event.locals.supabase.auth.getSession()
    if (!session) {
      return { session: null, user: null }
    }

    const {
      data: { user },
      error,
    } = await event.locals.supabase.auth.getUser()
    if (error) {
      // JWT validation has failed
      return { session: null, user: null }
    }

    return { session, user }
  }

  await event.locals.safeGetSession()

  return resolve(event, {
    filterSerializedResponseHeaders(name) {
      return name === "content-range"
    },
  })
}
