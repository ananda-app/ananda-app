import { fail, redirect, json } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { AutoGPT } from "$lib/autogpt";
import { DynamicTool } from "@langchain/core/tools";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { OPENAI_API_KEY } from '$env/static/private';

let biometricsData = {
  bpm: 0,
  brpm: 0,
  movement: 0
};

// Biometric tools
const getHeartRate = new DynamicTool({
  name: "get_heart_rate",
  description: "Get the current heart rate of the user. Input should be an empty string.",
  func: async () => biometricsData.bpm.toString(),
});

const getBreathingRate = new DynamicTool({
  name: "get_breathing_rate",
  description: "Get the current breathing rate of the user. Input should be an empty string.",
  func: async () => biometricsData.brpm.toString(),
});

const getMovement = new DynamicTool({
  name: "get_movement",
  description: "Get the current movement level of the user. Input should be an empty string.",
  func: async () => biometricsData.movement.toString(),
});

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session } = await safeGetSession();
  
  if (!session) {
    throw redirect(303, "/login/sign_in");
  }

  return {
    // return any data needed for the page
  };
};

export const actions: Actions = {
  start: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession();
    if (!session) {
      throw redirect(303, "/login/sign_in");
    }

    const formData = await request.formData();
    const duration = formData.get("duration");
    const technique = formData.get('technique');
    const comments = formData.get("comments");

    // Validate the form data
    if (!duration || isNaN(Number(duration))) {
      return fail(400, { error: "Duration is required and must be a number" });
    }

    try {
      // Insert the session data into the 'meditation_sessions' table
      const { data, error } = await supabase
        .from('meditation_sessions')
        .insert([
          { 
            user_id: session.user.id,
            duration: Number(duration), 
            technique: technique as string | null, 
            comments: comments as string | null,
            end_time: null 
          }
        ])
        .select('id');

      if (error) throw error;

      // Retrieve the ID of the newly created session
      if (!data || data.length === 0) {
        throw new Error("Failed to retrieve session ID");
      }
      const sessionId = data[0].id; 

      const llm = new ChatOpenAI({ model: 'gpt-4o', temperature: 0.8, apiKey: OPENAI_API_KEY });
      const tools = [getHeartRate, getBreathingRate, getMovement];

      const vectorStore = new MemoryVectorStore(
        new OpenAIEmbeddings({ apiKey: OPENAI_API_KEY })
      );

      const autogpt = new AutoGPT(llm, tools, {
        memory: vectorStore.asRetriever(),
      });

      // Run AutoGPT
      const goals = [`Conduct a meditation session of ${duration} minutes.`];
      //autogpt.run(goals);

      // Return the result
      return { success: true, sessionId: sessionId };
    } catch (error) {
      console.error(error);
      return fail(500, { error: "An error occurred while processing your request" });
    }
  },

  saveBiometrics: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession();
    if (!session) {
      return fail(401, { error: "Unauthorized" });
    }
  
    const formData = await request.formData();
    const ts = Number(formData.get('ts'));
    const bpm = Number(formData.get('bpm'));
    const brpm = Number(formData.get('brpm'));
    const movement = Number(formData.get('movement'));
    const elapsedSeconds = Number(formData.get('elapsedSeconds'));
  
    if (isNaN(ts) || isNaN(bpm) || isNaN(brpm) || isNaN(movement) || isNaN(elapsedSeconds)) {
      return fail(400, { error: "Invalid data" });
    }
  
    biometricsData = { bpm, brpm, movement };

    console.log(biometricsData)
  
    // Process and save the data as needed
    // For example, you might want to save it to the database:
    // const { error } = await supabase
    //   .from('biometrics')
    //   .insert({ user_id: session.user.id, ts, bpm, brpm, movement, elapsed_seconds: elapsedSeconds });
    
    // if (error) throw error;
  
    return { success: true };
  }  
};
