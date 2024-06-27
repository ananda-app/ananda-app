import { redirect, error } from "@sveltejs/kit";
import type { PageServerLoad } from './$types';
import { getSuperAdminStatus } from '$lib/supabaseHelpers';

export const load: PageServerLoad = async ({ locals: { safeGetSession, supabase } }) => {
  const { session } = await safeGetSession();
  
  if (!session) {
    throw redirect(303, "/login/sign_in");
  }

  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw error(403, "User not found.");
  }
  
  // Fetch the is_super_admin status
  const isSuperAdmin = await getSuperAdminStatus(supabase, user.id);

  // Add the is_super_admin field to the user object
  const enhancedUser = {
    ...user,
    is_super_admin: isSuperAdmin
  };

  if (!enhancedUser.is_super_admin) {
    throw redirect(303, '/account/meditate');
  }

  return {
    user: enhancedUser
  };
};

export const actions = {
  signout: async ({ locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession();
    if (session) {
      await supabase.auth.signOut();
      throw redirect(303, "/");
    }
  },
};