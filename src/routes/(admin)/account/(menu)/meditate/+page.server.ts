import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { AutoGPT } from "$lib/autogpt";
import { DynamicTool } from "@langchain/core/tools";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { OPENAI_API_KEY } from '$env/static/private';

// Biometric tools
const getHeartRate = new DynamicTool({
  name: "get_heart_rate",
  description: "Get the current heart rate of the user. Input should be an empty string.",
  func: async () => {
    return Math.floor(Math.random() * (100 - 60) + 60).toString();
  },
});

const getBreathingRate = new DynamicTool({
  name: "get_breathing_rate",
  description: "Get the current breathing rate of the user. Input should be an empty string.",
  func: async () => {
    return Math.floor(Math.random() * (20 - 10) + 10).toString();
  },
});

const getMovement = new DynamicTool({
  name: "get_movement",
  description: "Get the current movement level of the user. Input should be an empty string.",
  func: async () => {
    return Math.floor(Math.random() * (100 - 60) + 60).toString();
  },
});

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { session } = await safeGetSession();
  
  if (!session) {
    throw redirect(303, "/login");
  }

  return {
    // return any data needed for the page
  };
};

export const actions: Actions = {
  default: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession();
    if (!session) {
      throw redirect(303, "/login/sign_in");
    }

    const formData = await request.formData();
    const duration = formData.get("duration");
    const comments = formData.get("comments");

    console.log(duration);
    console.log(comments);

    // Validate the form data
    if (!duration || isNaN(Number(duration))) {
      return fail(400, { error: "Duration is required and must be a number" });
    }

    try {
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
      autogpt.run(goals);

      // Return the result
      return { success: true };
    } catch (error) {
      console.error(error);
      return fail(500, { error: "An error occurred while processing your request" });
    }
  },
};