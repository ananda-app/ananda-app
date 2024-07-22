import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { MeditationSession } from "$lib/MeditationSession";

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  try {
    const { session } = await safeGetSession();
    
    if (!session) {
      throw redirect(303, "/login/sign_in");
    }

    return {
      // ... existing return data ...
    };
  } catch (error) {
    console.error("Error in load function:", error);
    throw error;
  }
};

export const actions: Actions = {
  start: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession();
    if (!session) {
      throw redirect(303, "/login/sign_in");
    }

    const formData = await request.formData();
    const durationMinutes = Number(formData.get("duration"));
    const method = String(formData.get('method'));
    const comments = String(formData.get("comments"));
    if (!durationMinutes || isNaN(Number(durationMinutes))) {
      return fail(400, { error: "Duration is required and must be a number" });
    }

    try {
      const startTime = new Date();

      const { data, error } = await supabase
        .from('meditation_sessions')
        .insert([
          { 
            user_id: session.user.id,
            duration: durationMinutes, 
            method: method as string | null, 
            comments: comments as string | null,
            start_ts: startTime,
            end_ts: null 
          }
        ])
        .select('id');

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error("Failed to retrieve meditation ID");
      }
      const meditationId = Number(data[0].id);

      const meditationSession = new MeditationSession(
        meditationId,
        method,
        comments,
        durationMinutes,
        session,
        "gpt-4o-mini"
      );

      meditationSession.start();

      console.log(`Successfully started ${method} meditation ${meditationId} with comments: ${comments}`);
      
      return {
        success: true,
        redirect: `/account/meditate/biometrics?id=${meditationId}`
      };
    } catch (error) {
      console.error(error);
      throw redirect(303, "/account/meditate/oops");
    }
  },

  stop: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession();
    if (!session) {
      return fail(401, { error: "Unauthorized" });
    }
  
    const formData = await request.formData();
    const meditationId = Number(formData.get('meditationId'));
  
    if (!meditationId) {
      return fail(400, { error: "Meditation ID is required" });
    }
  
    const meditationSession = MeditationSession.getSession(meditationId);
  
    if (meditationSession) {
      try {
        await meditationSession.endSession(true);
        console.log(`Successfully stopped meditation ${meditationId}`);
        return {
          success: true,
          redirect: `/account/meditate/thank-you?id=${meditationId}`
        };
      } catch (error) {
        console.error("Error stopping meditation:", error);
        return {
          success: false,
          redirect: "/account/meditate/oops"
        };
      }
    } else {
      console.log(`MeditationSession instance for ${meditationId} not found`);
      return {
        success: false,
        redirect: "/account/meditate/oops"
      };
    }
  }
};