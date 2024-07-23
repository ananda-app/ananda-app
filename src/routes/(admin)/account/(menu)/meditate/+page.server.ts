import { fail, redirect, json } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { OPENAI_API_KEY } from '$env/static/private';

interface MeditationResponse {
  thoughts: {
    stage: string;
    seconds_left: number;
    biometric_analysis: string;
    mental_state: string;
    reasoning: string;
    criticism: string;
    instruction: string;
  }
}

async function generate_instruction(
  supabase: SupabaseClient, 
  meditationId: number, 
  method: string, 
  durationSeconds: number, 
  comments: string,
  userInfo: {
    fullName: string;
    location: string;
    age: number | null;
    totalSessions: number;
  },
  biometrics: string,
  timeLeft: number,
  elapsedSeconds: number
): Promise<string> {
  const llm = new ChatOpenAI({ model: 'gpt-4o-mini', temperature: 1.0, apiKey: OPENAI_API_KEY });
  const parser = new JsonOutputParser<MeditationResponse>();

  const systemPrompt = `
As a meditation guru, your task is to conduct a ${method} meditation session of ${durationSeconds} seconds using the biometric stats as a guide.
Conduct the session in three stages: grounding, immersion, and closure. Instructions for each stage are detailed below. Move to the next stage ONLY when instructed.
The biometric stats are estimated from the live video feed using the rPPG algorithm. Infer the mental/physical state of the user from the data. Invalid values may indicate incorrect posture.
Think step by step. Base your decisions on the biometric stats and your assessment of the user's mental state.
Keep the instructions brief. Encourage and reassure the user whenever possible. Consider the user's comments, if any.
Do NOT repeat the same instruction. Mix it up. Be creative. Make it fun. 

User Information:
Name: ${userInfo.fullName}
Location: ${userInfo.location}
Age: ${userInfo.age}
Total Sessions: ${userInfo.totalSessions}
User Comments (for this session):
${comments ? comments.trim() : 'None'}

Grounding Stage Instructions:
- Greet the user warmly and provide instructions to sit in a comfortable posture and look straight at the camera.
- Instruct the user to take a few deep breaths and close their eyes when ready.
- Ask the user to set an intention to sit as still as possible.
- Inform them that you'll monitor their biometrics and provide further instructions.

Immersion Stage Instructions:
- Start by providing instructions for the ${method} meditation technique.
- Assess the mental state of the user based on the biometrics.
- If the user seems to have lost focus, provide a gentle reminder to return to the object of focus. 
- Do not provide any instruction if the user is focused.
- Keep cycling through the instructions until the stage is over.
- Remind the user to correct their posture if invalid biometric data is detected.

Closure Stage Instructions:
- Provide instructions to reflect on the session and current mental state.
- Ask the user to rub their hands together, place their palms on their eyes, and then open them.
- Summarize the biometrics observed during the session and provide feedback.
- Encourage the user to continue practicing throughout the day. 
- End this stage with a farewell until the next session.

ALWAYS respond in JSON format as described below:
{
  "thoughts": {
    "stage": "stage of meditation",
    "seconds_left": "seconds left in session",
    "biometric_analysis": "analysis of the biometric stats",
    "mental_state": "assessment of user's mental state",
    "reasoning": "reasoning based on biometrics and mental state",
    "criticism": "constructive self-criticism of the reasoning",
    "instruction": "instruction to provide to the user, if any"
  }
}

Ensure the JSON is valid and can be parsed by JSON.parse()
`;

  let userMessage: string;
  let messages: (HumanMessage | AIMessage)[] = []; 

  const { data: chatHistory, error: chatError } = await supabase
    .from('chat_history')
    .select('*')
    .eq('meditation_id', meditationId)
    .order('created_at', { ascending: false }) // Order by most recent first
    .limit(100) // Limit to 100 entries
    .then(result => ({
      ...result,
      data: result.data ? result.data.reverse() : [] // Reverse the array to get chronological order
    }));

  if (chatError) throw chatError;

  if (chatHistory.length === 0) {
    userMessage = "Start with grounding instructions. Respond as per the JSON format specified:";
  } else {
    let stage_suffix = "Stay in the immersion stage.";
    if (elapsedSeconds > 60) {
        stage_suffix = "Move to the immersion stage.";
    }
    if(timeLeft <= 0) {
        stage_suffix = "Move to the closure stage.";
    }

    userMessage = `
Here are the biometrics for the last minute:
${biometrics}

Time left in session: ${timeLeft} seconds. ${stage_suffix}

Respond as per the JSON format specified:
`;

    // Rebuild chat history
    messages = chatHistory.flatMap(msg => [
      new HumanMessage(msg.user_message),
      new AIMessage(msg.ai_message)
    ]);
  }

  const prompt = ChatPromptTemplate.fromMessages([
    new SystemMessage(systemPrompt.trim()),
    ...messages,
    new HumanMessage(userMessage.trim()),
  ]);

  const chain = prompt.pipe(llm).pipe(parser);

  const response = await chain.invoke({});

  // Save user message and AI message to chat_history table in the same row
  const { error: chatInsertError } = await supabase
    .from('chat_history')
    .insert({
      meditation_id: meditationId,
      user_message: userMessage.trim(),
      ai_message: JSON.stringify(response)
    });

  if (chatInsertError) throw chatInsertError;

  return response.thoughts.instruction;
}

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

  instr: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession();
    if (!session) {
      return fail(401, { error: "Unauthorized" });
    }
  
    const formData = await request.formData();
    const meditationId = Number(formData.get('meditationId'));
  
    if (!meditationId) {
      return fail(400, { error: "Meditation ID is required" });
    }
  
    try {
      // Check if meditation session exists
      const { data: meditationData, error: meditationError } = await supabase
        .from('meditation_sessions')
        .select('*')
        .eq('id', meditationId)
        .single();

      if (meditationError) {
        if (meditationError.code === 'PGRST116') {
          return fail(404, { error: "Meditation session not found" });
        }
        throw meditationError;
      }

      // Fetch user info
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('full_name, location, date_of_birth')
        .eq('id', session.user.id)
        .single();

      if (userError) throw userError;

      // Calculate age
      const age = userData.date_of_birth 
        ? Math.floor((new Date().getTime() - new Date(userData.date_of_birth).getTime()) / 3.15576e+10)
        : null;

      // Fetch total sessions
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('meditation_sessions')
        .select('id')
        .eq('user_id', session.user.id);

      if (sessionsError) throw sessionsError;

      // Fetch biometrics
      const { data: biometricsData, error: biometricsError } = await supabase
        .from('biometrics')
        .select('*')
        .eq('meditation_id', meditationId)
        .order('ts', { ascending: false })
        .limit(24);

      if (biometricsError) throw biometricsError;

      const biometrics = ['elapsed_seconds,bpm,brpm,movement', 
        ...biometricsData.map(row => 
          `${row.elapsed_seconds},${row.bpm},${row.brpm},${row.movement}`
        )
      ].join('\n');

      const elapsedSeconds = Math.floor((new Date().getTime() - new Date(meditationData.start_ts).getTime()) / 1000);
      const timeLeft = meditationData.duration * 60 - elapsedSeconds;

      const instruction = await generate_instruction(
        supabase,
        meditationId,
        meditationData.method ?? '',
        meditationData.duration * 60,
        meditationData.comments ?? '',
        {
          fullName: userData.full_name ?? '',
          location: userData.location ?? '',
          age,
          totalSessions: sessionsData.length
        },
        biometrics,
        timeLeft,
        elapsedSeconds
      );
      
      // Calculate elapsed seconds just before insertion
      const elapsedSecondsNew = Math.floor((Date.now() - new Date(meditationData.start_ts).getTime()) / 1000);

      // Insert the instruction into the meditation_instructions table
      const { data: insertedInstruction, error: insertError } = await supabase
        .from('meditation_instructions')
        .insert({
          ts: new Date().toISOString(),
          meditation_id: meditationId,
          elapsed_seconds: elapsedSecondsNew,
          instruction: instruction,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      console.log(`[${elapsedSeconds}s] [id:${meditationId}] [${insertedInstruction.id}]: ${instruction}`);

      return { success: true };
    } catch (error) {
      console.error("Error generating instruction:", error);
      return {
        success: false,
        redirect: "/account/meditate/oops"
      };
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
  
    try {
      const { error } = await supabase
        .from('meditation_sessions')
        .update({ end_ts: new Date() })
        .eq('id', meditationId)
        .eq('user_id', session.user.id);

      if (error) throw error;

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
  }
};