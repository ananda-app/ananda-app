import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { OPENAI_API_KEY } from '$env/static/private';
import { textToSpeech } from '$lib/textToSpeech';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;
    while (i < binary.length) {
        const a = binary.charCodeAt(i++);
        const b = binary.charCodeAt(i++);
        const c = binary.charCodeAt(i++);
        result += base64Chars.charAt(a >> 2) +
                  base64Chars.charAt(((a & 3) << 4) | (b >> 4)) +
                  (isNaN(b) ? '=' : base64Chars.charAt(((b & 15) << 2) | (c >> 6))) +
                  (isNaN(b + c) ? '=' : base64Chars.charAt(c & 63));
    }
    return result;
}

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
): Promise<{ instruction: string }> {
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

    userMessage = [
      "Here are the biometrics for the last minute:",
      biometrics,
      "",
      `Time left in session: ${timeLeft} seconds. ${stage_suffix}`,
      "",
      "Respond as per the JSON format specified:"
    ].join("\n");

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

  const instruction = response.thoughts.instruction;

  return { instruction };
}

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession();
    if (!session) {
        return json({ type: "error", error: "Unauthorized" }, { status: 401 });
    }

    const data = await request.json();
    const meditationId = Number(data.meditationId);

    if (!meditationId) {
        return json({ type: "error", error: "Meditation ID is required" }, { status: 400 });
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
                return json({ type: "error", error: `Meditation session ${meditationId} not found` }, { status: 404 });
            }
            throw meditationError;
        }

        if (meditationData.end_ts !== null) {
            throw new Error(`Meditation session ${meditationId} has already ended`);
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
            .order('ts', { ascending: true })
            .limit(24);

        if (biometricsError) throw biometricsError;

        const biometrics = ['elapsed_seconds,bpm,brpm,movement', 
            ...biometricsData.map(row => 
            `${row.elapsed_seconds},${row.bpm},${row.brpm},${row.movement}`
            )
        ].join('\n');

        const now = new Date();
        const startTime = new Date(meditationData.start_ts);
        const elapsedSeconds = Math.floor((now.getTime() - startTime.getTime()) / 1000);
        const timeLeft = Math.max(0, meditationData.duration * 60 - elapsedSeconds);

        const { instruction } = await generate_instruction(
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
        
        let audioBase64: string | null = null;

        try {
            const audioBuffer = await textToSpeech(instruction);
            if (!audioBuffer) {
              throw new Error('Text-to-speech returned no audio data');
            }
            audioBase64 = arrayBufferToBase64(audioBuffer);
        } catch (error) {
            console.error('Text-to-speech error:', error);
            // Note: We're not throwing the error here, so the instruction can still be used without audio
        }
        
        // Insert the instruction into the meditation_instructions table
        const { data: insertedInstruction, error: insertError } = await supabase
            .from('meditation_instructions')
            .insert({
              ts: new Date().toISOString(),
              meditation_id: meditationId,
              elapsed_seconds: elapsedSeconds,
              instruction: instruction,
            })
            .select('id')
            .single();

        if (insertError) throw insertError;

        console.log(`[${elapsedSeconds}s] [id:${meditationId}] [mid:${insertedInstruction.id}]: ${instruction}`);

        return json({
            type: "success",
            data: {
                instruction: instruction,
                audioBase64: audioBase64,
                instructionId: insertedInstruction.id,
                timeLeft: timeLeft
            }
        });
    } catch (error) {
        console.error("Error generating instruction:", error);
        return json({
            type: "error",
            data: {
                error: error.message || "Failed to generate audio for instruction",
                redirect: "/account/meditate/oops"
            }
        }, { status: 500 });
    }
};
