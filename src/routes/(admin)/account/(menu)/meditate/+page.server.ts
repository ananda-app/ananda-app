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
    const technique = String(formData.get('technique'));
    const comments = String(formData.get("comments"));

    // Validate the form data
    if (!durationMinutes || isNaN(Number(durationMinutes))) {
      return fail(400, { error: "Duration is required and must be a number" });
    }

    try {
      // Insert the session data into the 'meditation_sessions' table
      const startTime = new Date();

      const { data, error } = await supabase
        .from('meditation_sessions')
        .insert([
          { 
            user_id: session.user.id,
            duration: durationMinutes, 
            technique: technique as string | null, 
            comments: comments as string | null,
            start_ts: startTime,
            end_ts: null 
          }
        ])
        .select('id');

      if (error) throw error;

      // Retrieve the ID of the newly created session
      if (!data || data.length === 0) {
        throw new Error("Failed to retrieve meditation ID");
      }
      const meditationId = Number(data[0].id);

      const meditationSession = new MeditationSession(
        meditationId,
        technique,
        comments,
        durationMinutes,
        session
      );

      meditationSession.start();

      console.log(`Successfully started ${technique} meditation ${meditationId} with comments: ${comments}`);
      
      // Return the result
      return { success: true, meditationId: meditationId };
    } catch (error) {
      console.error(error);
      return fail(500, { error: "An error occurred while processing your request" });
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
      meditationSession.endSession(true);
      console.log(`Sucessfully stopped meditation ${meditationId}`);
      return { success: true };
    } else {
      console.log(`MeditationSession instance for ${meditationId} not found`);
      return fail(404, { error: "Meditation session not found" });
    }
  }
};