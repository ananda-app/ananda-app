import { fail, redirect, json } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { AutoGPT } from "$lib/autogpt";
import { DynamicTool } from "@langchain/core/tools";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { OPENAI_API_KEY } from '$env/static/private';
import { writable } from 'svelte/store';

const activeMeditations = writable<Record<number, AutoGPT>>({});

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

      const getBiometrics = new DynamicTool({
        name: "get_biometrics",
        description: `Get the biometric stats of the user for the last 30 seconds or so in CSV format. 
                      The stats returned are heart rate (beats per minute), breathing rate (breaths per minute), 
                      movement score (0 is absolutely still). These stats are estimated from the live video feed.`,
        func: async () => {
          const { data, error } = await supabase
            .from('biometrics')
            .select('ts, bpm, brpm, movement, elapsed_seconds')
            .eq('meditation_id', meditationId)
            .order('ts', { ascending: false })
            .limit(15);
          
          if (error) throw error;
          const csvData = ['ts,bpm,brpm,movement,elapsed_seconds', 
            ...data.map(row => `${row.ts},${row.bpm},${row.brpm},${row.movement},${row.elapsed_seconds}`)
          ].join('\n');
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
          console.log(`Meditation ID ${meditationId}: Remaining seconds: ${remainingSeconds.toFixed(0)}`);
          return remainingSeconds.toFixed(0);
        },
      });

      const provideNextInstruction = new DynamicTool({
        name: "provide_next_instruction",
        description: "Provide the next meditation instruction to the user. Input should be the instruction as a string.",
        func: async (instruction) => {
          const { data, error } = await supabase
            .from('meditation_instructions')
            .insert({
              ts: new Date().toISOString(),
              meditation_id: meditationId,
              instruction: instruction
            })
            .select('id');

          if (error) throw console.log(error);

          if (data && data.length > 0 && 'id' in data[0]) {
            const instructionId = data[0].id;
            console.log(`Saved instruction ${instructionId}, ${instruction}`);
          } else {
            console.log("Failed to retrieve instruction ID after insertion");
          }
                    
          return "";
        },
      });

      const llm = new ChatOpenAI({ model: 'gpt-4o', temperature: 0.5, apiKey: OPENAI_API_KEY });
      const tools = [getBiometrics, getTimeLeft, provideNextInstruction];

      const vectorStore = new MemoryVectorStore(
        new OpenAIEmbeddings({ apiKey: OPENAI_API_KEY })
      );

      const autogpt = new AutoGPT(meditationId, comments ?? '', llm, tools, {
        memory: vectorStore.asRetriever(),
      });

      activeMeditations.update(meditations => ({
        ...meditations,
        [meditationId]: autogpt
      }));      

      // Run AutoGPT in the background
      autogpt.run([`Conduct a ${technique} meditation session`]).then(result => {
        console.log(`AutoGPT execution completed for meditation ${meditationId}: ${result}`);
      }).catch(error => {
        console.error(`AutoGPT error for meditation ${meditationId}:`, error);
      }).finally(() => {
        // Clean up the store
        activeMeditations.update(meditations => {
          const { [meditationId]: _, ...rest } = meditations;
          return rest;
        });
      });

      console.log(`Successfully started meditation ${meditationId}`);
      
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

    let autogpt: AutoGPT | undefined;
    activeMeditations.subscribe(meditations => {
      autogpt = meditations[meditationId];
    })();
  
    if (autogpt) {
      autogpt.abort();
      console.log(`Aborted meditation ${meditationId}`);
    } else {
      console.log(`AutoGPT instance for ${meditationId} not found`);
    }

    try {
      const { error } = await supabase
        .from('meditation_sessions')
        .update({ end_ts: new Date() })
        .eq('id', meditationId)
        .eq('user_id', session.user.id);

      if (error) throw error;

      console.log(`Successfully stopped meditation ${meditationId}`);

      return { success: true };
    } catch (error) {
      console.error('Error stopping meditation:', error);
      return fail(500, { error: "Failed to stop meditation" });
    }
  }
};
