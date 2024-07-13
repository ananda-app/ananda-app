// src/routes/layout.ts
import { createSupabaseLoadClient } from "@supabase/auth-helpers-sveltekit";
import type { Database } from "../../../DatabaseDefinitions.js";
import { redirect } from "@sveltejs/kit";

export const load = async ({ fetch, data, depends, url }) => {
  depends("supabase:auth");

  const supabase = createSupabaseLoadClient({
    supabaseUrl: import.meta.env.VITE_PUBLIC_SUPABASE_URL,
    supabaseKey: import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY,
    event: { fetch },
    serverSession: data.session,
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const profile: Database["public"]["Tables"]["profiles"]["Row"] | null =
    data.profile;

  const createProfilePath = "/account/create_profile";
  if (
    profile &&
    !_hasFullProfile(profile) &&
    url.pathname !== createProfilePath
  ) {
    redirect(303, createProfilePath);
  }
  
  return { supabase, session, profile };
};

export const _hasFullProfile = (
  profile: Database["public"]["Tables"]["profiles"]["Row"] | null,
) => {
  if (!profile) {
    return false;
  }
  if (!profile.full_name) {
    return false;
  }
  if (!profile.gender) {
    return false;
  }
  if (!profile.date_of_birth) {
    return false;
  }
  if (!profile.location) {
    return false;
  }

  return true;
};