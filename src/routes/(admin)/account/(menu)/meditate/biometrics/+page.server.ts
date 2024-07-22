import { redirect, error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { MeditationSession } from "$lib/MeditationSession";

export const load: PageServerLoad = async ({ url, locals: { safeGetSession } }) => {
  const { session } = await safeGetSession();
  if (!session) {
    throw redirect(303, "/login/sign_in");
  }

  const meditationId = url.searchParams.get("id");
  if (!meditationId) {
    throw redirect(303, "/account/meditate/oops");
  }

  const meditationSession = MeditationSession.getSession(Number(meditationId));
  if (!meditationSession) {
    throw redirect(303, "/account/meditate/oops");
  }
};