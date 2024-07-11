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
    const duration = Number(formData.get("duration"));
    const technique = String(formData.get('technique'));
    const comments = String(formData.get("comments"));

    // Validate the form data
    if (!duration || isNaN(Number(duration))) {
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
            duration: Number(duration), 
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

      const getHeartRate = new DynamicTool({
        name: "get_heart_rate",
        description: "Get the last 5 heart beats per minute stat for the meditation session in CSV format",
        func: async () => {
          const { data, error } = await supabase
            .from('biometrics')
            .select('ts, bpm, elapsed_seconds')
            .eq('meditation_id', meditationId)
            .order('ts', { ascending: false })
            .limit(5);
          
          if (error) throw error;
          const csvData = ['ts,bpm,elapsed_seconds', ...data.map(row => `${row.ts},${row.bpm},${row.elapsed_seconds}`)].join('\n');
          console.log(csvData);
          return csvData;
        },
      });
      
      const getBreathingRate = new DynamicTool({
        name: "get_breathing_rate",
        description: "Get the last 5 breaths per minute stat for the meditation session in CSV format",
        func: async () => {
          const { data, error } = await supabase
            .from('biometrics')
            .select('ts, brpm, elapsed_seconds')
            .eq('meditation_id', meditationId)
            .order('ts', { ascending: false })
            .limit(5);
          
          if (error) throw error;
          const csvData = ['ts,brpm,elapsed_seconds', ...data.map(row => `${row.ts},${row.brpm},${row.elapsed_seconds}`)].join('\n');
          console.log(csvData);
          return csvData;
        },
      });
      
      const getMovement = new DynamicTool({
        name: "get_movement",
        description: "Get the last 5 movement score stat for the meditation session in CSV format (0 is completely still)",
        func: async () => {
          const { data, error } = await supabase
            .from('biometrics')
            .select('ts, movement, elapsed_seconds')
            .eq('meditation_id', meditationId)
            .order('ts', { ascending: false })
            .limit(5);
          
          if (error) throw error;
          const csvData = ['ts,movement,elapsed_seconds', ...data.map(row => `${row.ts},${row.movement},${row.elapsed_seconds}`)].join('\n');
          console.log(csvData);
          return csvData;
        },
      });      

      const getTimeLeft = new DynamicTool({
        name: "get_time_left",
        description: "Get the remaining time in the meditation session in seconds",
        func: async () => {
          const now = new Date();
          const elapsedSeconds = (now.getTime() - startTime.getTime()) / 1000;
          const remainingSeconds = Math.max(0, duration * 60 - elapsedSeconds);
          console.log(`remaining seconds: ${remainingSeconds.toFixed(0)}`);
          return remainingSeconds.toFixed(0);
        },
      });

      const provideNextInstruction = new DynamicTool({
        name: "provide_next_instruction",
        description: "Provide the next meditation instruction to the user. Input should be the instruction as a string.",
        func: async (instruction) => {
          console.log(`${instruction}`);
          return "";
        },
      });

      const llm = new ChatOpenAI({ model: 'gpt-4o', temperature: 0.8, apiKey: OPENAI_API_KEY });
      const tools = [getHeartRate, getBreathingRate, getMovement, getTimeLeft, provideNextInstruction];

      const vectorStore = new MemoryVectorStore(
        new OpenAIEmbeddings({ apiKey: OPENAI_API_KEY })
      );

      const autogpt = new AutoGPT(meditationId, comments ?? '', llm, tools, {
        memory: vectorStore.asRetriever(),
      });

      // Run AutoGPT
      const goals = [`Conduct a ${technique} meditation session of ${duration} minutes.`];
      autogpt.run(goals);

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
    const meditationId = formData.get('meditationId');

    if (!meditationId) {
      return fail(400, { error: "Meditation ID is required" });
    }

    try {
      const { error } = await supabase
        .from('meditation_sessions')
        .update({ end_ts: new Date() })
        .eq('id', meditationId)
        .eq('user_id', session.user.id);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error stopping meditation:', error);
      return fail(500, { error: "Failed to stop meditation" });
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
    const meditationId = Number(formData.get('meditationId'));

    if (isNaN(ts) || isNaN(bpm) || isNaN(brpm) || isNaN(movement) || isNaN(elapsedSeconds) || isNaN(meditationId)) {
      return fail(400, { error: "Invalid data" });
    }
  
    biometricsData = { bpm, brpm, movement };

    console.log(`Meditation ID: ${meditationId}, BPM: ${bpm}, BRPM: ${brpm}, Movement: ${movement}, Elapsed Seconds: ${elapsedSeconds}`);
  
    try {
      const { error } = await supabase
        .from('biometrics')
        .insert({ 
          ts: new Date(ts).toISOString(),
          meditation_id: meditationId,
          bpm, 
          brpm, 
          movement, 
          elapsed_seconds: elapsedSeconds 
        });
      
      if (error) throw error;
  
      return { success: true };
    } catch (error) {
      console.error('Error saving biometrics:', error);
      return fail(500, { error: "Failed to save biometrics data" });
    }
  }  
};
