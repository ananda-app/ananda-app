import type { SupabaseClient } from '@supabase/supabase-js';

export async function checkUserExists(supabase: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)('check_user_exists', { email });

  if (error) {
    console.error('Error checking if user exists:', error);
    throw error;
  }

  return !!data;
}

export async function getSuperAdminStatus(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)('is_user_super_admin', { user_id: userId });

  if (error) {
    console.error('Error fetching super admin status:', error);
    throw error;
  }

  return !!data;
}
