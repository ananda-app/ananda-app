import { redirect, error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals: { safeGetSession, supabase } }) => {
  try {
    const { session } = await safeGetSession();
    if (!session) throw redirect(303, "/login/sign_in");

    const meditationId = url.searchParams.get('id');
    if (!meditationId) throw new Error("Missing meditation ID");

    const { data: meditationData, error: meditationError } = await supabase
      .from('meditation_sessions')
      .select('*')
      .eq('id', meditationId)
      .single();

    if (meditationError) throw meditationError;

    if (meditationData.end_ts !== null) {
      throw new Error(`Meditation session ${meditationId} has already ended`);
    }
  } catch (err) {
    console.error("Error in load function:", err);
    throw redirect(303, "/account/meditate/oops");
  }
};