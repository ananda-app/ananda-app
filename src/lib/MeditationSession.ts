import { createClient, AuthApiError, type Session } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "$env/static/public";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableWithMessageHistory, RunnableSequence, RunnablePassthrough } from "@langchain/core/runnables";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPENAI_API_KEY } from '$env/static/private';
import type { BaseMessage } from "@langchain/core/messages";
import { encodingForModel } from "@langchain/core/utils/tiktoken";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { EventEmitter } from 'events';
import { HumanMessage, AIMessage } from "@langchain/core/messages";

interface MeditationResponse {
  thoughts: {
    stage: string;
    seconds_left: number;
    biometric_analysis: string;
    mental_state: string;
    reasoning: string;
    criticism: string;
    instruction: string;
    exit: boolean;
  }
}

export class MeditationSession extends EventEmitter {
  private meditationId: number;
  private supabase: SupabaseClient;
  private llm: ChatOpenAI;
  private messageHistory: InMemoryChatMessageHistory;
  private intervalId: NodeJS.Timeout | null = null;
  private technique: string;
  private durationSeconds: number;
  private maxTokens: number = 100000; 
  private encoding: any = null;
  private startTime: number;
  private parser: JsonOutputParser<MeditationResponse>;
  private withMessageHistory: RunnableWithMessageHistory<{
    input: string;
    biometrics: string;
    timeLeft: number;
    move_instruction: string;
    chat_history: BaseMessage[];
  }, AIMessage>;
  private session: Session;

  constructor(meditationId: number, technique: string, comments: string, durationMinutes: number, session: Session) {
    super();

    this.meditationId = meditationId;
 
    // Validate the session
    if (!session || !session.access_token) {
      throw new Error("Invalid session");
    }    
    this.session = session;
     
    this.supabase = this.createSupabaseClient(session.access_token);
    this.llm = new ChatOpenAI({ model: 'gpt-4o', temperature: 1.0, apiKey: OPENAI_API_KEY });
    this.messageHistory = new InMemoryChatMessageHistory();
    this.technique = technique;
    this.durationSeconds = durationMinutes * 60;
    this.startTime = Date.now();
    this.initializeEncoding();
    this.parser = new JsonOutputParser<MeditationResponse>();
    
    const systemPrompt = `
As a meditation guru, your task is to conduct a ${this.technique} meditation session of ${this.durationSeconds} seconds using the biometric stats as a guide. 
Conduct the session in three stages: grounding, immersion and closure. Instructions for each stage is detailed below. Move to the next stage ONLY when instructed.
The biometrics stats are estimated from the live video feed using rPPG algorithm. Infer the mental/physical state of the user from the data.
Think step by step. Base your decisions on the biometric stats and your assessment of the user's mental state.
Keep the instructions brief. Encourage and reassure the user whenever possible. 
Do NOT repeat the same instruction. Mix it up. Be creative. 

User Comments:
${comments ? comments.trim() : 'None'}

Grounding Stage Instructions:
- Greet the user and provide instructions sit in a comfortable posture, look straight, take few deep breaths and close the eyes.
- Ask the user to set an intention to sit still.

Immersion Stage Instructions:
- Start by providing instructions for ${this.technique} technique.
- Monitor the stats and assess the mental state of the user.
- If user seems to have lost focus, then provide a gentle reminder to return to the object of focus. 
- If the user seems to be focussed, do not provide any instruction.

Closure Stage Instructions:
- Provide instructions to reflect on the session and current mental state.
- Ask user to rub the hands together, place the palms on the eyes and open it.
- Summaize the biometrics observed during the session and provide feedback.
- Ask the user to try and keep practicing it for the rest of the day. 
- End this stage with a goodbye and set the 'exit' flag go true.

ALWAYS respond in JSON format as described below:
{{
  "thoughts": {{
    "stage": "stage of meditation",
    "seconds_left": "seconds left in session",
    "biometric_analysis": "analysis of the biometric stats",
    "mental_state": "assessment of user's mental state",
    "reasoning": "reasoning based on biometrics and mental state",
    "criticism": "constructive self-criticism of the reasoning",
    "instruction": "instruction to provide to the user, if any",
    "exit": "true if this is the last instruction of the session, false otherwise"
  }}
}}

Ensure the response can be parsed by JSON.parse()
`;

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", systemPrompt],
      ["placeholder", "{chat_history}"],
      ["human", [
        "Here are the biometrics for the last minute:", 
        "{biometrics}", 
        "", 
        "Time left in session: {timeLeft} seconds. {move_instruction}",
        "",
        "Respond as per the JSON format specified: "
      ].join("\n")],
    ]);

    const filterMessages = ({ chat_history }: { chat_history: BaseMessage[] }): BaseMessage[] => {
      return chat_history.slice(-100);
    };

    const chain = RunnableSequence.from<{
      input: string;
      biometrics: string;
      timeLeft: number;
      move_instruction: string; 
      chat_history: BaseMessage[];
    }, AIMessage>([
      RunnablePassthrough.assign({
        chat_history: (input: { chat_history: BaseMessage[] }) => 
          filterMessages({ chat_history: input.chat_history }),
      }),
      prompt,
      this.llm
    ]);

    this.withMessageHistory = new RunnableWithMessageHistory({
      runnable: chain,
      getMessageHistory: async (sessionId) => this.messageHistory,
      inputMessagesKey: "input",
      historyMessagesKey: "chat_history",
    });
  }

  private createSupabaseClient(accessToken: string) {
    return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  private async refreshSession() {
    try {
      if (this.session && this.session.expires_at) {
        const expiresAt = new Date(this.session.expires_at).getTime();
        if (Date.now() < expiresAt) {
          return;
        }
      }

      const { data, error } = await this.supabase.auth.refreshSession(this.session);
  
      if (error) {
        if (error instanceof AuthApiError && error.message.includes('Invalid Refresh Token')) {
          console.log("Invalid refresh token. Attempting to use existing access token.");
          return; // Continue with the existing token
        }
        throw error;
      }
  
      if (data.session) {
        this.session = data.session;
        this.supabase = this.createSupabaseClient(this.session.access_token);
        console.log("Session refreshed successfully");
      } else {
        throw new Error("No session data returned");
      }
    } catch (error) {
      console.error("Failed to refresh session:", error);
      throw error;
    }
  }  

  private async initializeEncoding() {
    this.encoding = await encodingForModel("gpt-4o");
  }

  private async countTokens(text: string): Promise<number> {
    if (!this.encoding) {
      await this.initializeEncoding();
    }
    return this.encoding!.encode(text).length;
  }

  async start() {
    await this.runLLM();
    this.intervalId = setInterval(() => this.runLLM(), 60000); // Run every 1 minute
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.emit('done');
  }

  private async getBiometricStats(): Promise<string> {
    const { data, error } = await this.supabase
      .from('biometrics')
      .select('ts, bpm, brpm, movement, elapsed_seconds')
      .eq('meditation_id', this.meditationId)
      .order('ts', { ascending: false })
      .limit(24);
    
    if (error) throw error;

    console.log(`Getting biometrics for meditation ${this.meditationId}`);

    if (data.length === 0) {
      return 'elapsed_seconds,bpm,brpm,movement\n0,0,0,0';
    }

    return ['elapsed_seconds,bpm,brpm,movement', 
      ...data.map(row => 
        `${row.elapsed_seconds},${row.bpm},${row.brpm},${row.movement}`
      )
    ].join('\n');
  }

  private async provideNextInstruction(instruction: string): Promise<void> {
    const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    const { error, data } = await this.supabase
      .from('meditation_instructions')
      .insert({
        ts: new Date().toISOString(),
        meditation_id: this.meditationId,
        instruction: instruction
      })
      .select('id');

    if (error) throw error;

    if (data && data.length > 0 && 'id' in data[0]) {
      const instructionId = data[0].id;
      console.log(`[${elapsedSeconds}s] Saved instruction ${instructionId}: ${instruction}`);
    } else {
      console.log(`[${elapsedSeconds}s] Failed to retrieve instruction ID after insertion`);
    }
  }

  private async runLLM(retryAttempt: number = 0, errorMessage: string = ""): Promise<void> {
    const MAX_RETRIES = 3;
  
    try {
      // Attempt to refresh the session
      try {
        await this.refreshSession();
      } catch (refreshError) {
        console.warn("Failed to refresh session. Continuing with existing token.", refreshError);
      }
  
      const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
      const timeLeft = this.durationSeconds - elapsedSeconds;
      
      let move_instruction = "Stay in the immersion stage.";
      if (elapsedSeconds > 60) {
        move_instruction = "Move to the immersion stage.";
      }
      if (timeLeft < 60) {
        move_instruction = "Move to the closure stage.";
      }
      
      const biometrics = await this.getBiometricStats();
      
      const response = await this.withMessageHistory.invoke(
        { 
          input: errorMessage || [
            "Here are the biometrics for the last minute:",
            biometrics,
            "",
            `Time left in session is ${timeLeft} seconds. ${move_instruction}`,
            "Respond as per the JSON format specified: "
          ].join("\n"),
          biometrics,
          timeLeft,
          move_instruction,
          chat_history: await this.messageHistory.getMessages()
        },
        { configurable: { sessionId: this.meditationId.toString() } }
      );
  
      console.log(`Attempt ${retryAttempt + 1} - LLM Response:`, response.content);
  
      const responseContent = Array.isArray(response.content) ? response.content.join('') : response.content ?? '';
      const parsedResponse = await this.parser.parse(responseContent);
      await this.provideNextInstruction(parsedResponse.thoughts.instruction);
  
      if (parsedResponse.thoughts.exit) {
        this.stop();
      }
    } catch (error: any) {
      console.error(`Attempt ${retryAttempt + 1} - Error in runLLM:`, error);
      
      if (retryAttempt < MAX_RETRIES - 1) {
        // If we haven't exhausted all retries, call runLLM again with an error message
        return this.runLLM(retryAttempt + 1, "Invalid JSON. Please respond with a valid JSON in the format specified.");
      } else {
        // If we've exhausted all retries, emit an error event
        this.emit('error', new Error(`Failed to run LLM after ${MAX_RETRIES} attempts: ${error.message}`));
        // Provide a fallback instruction
        await this.provideNextInstruction("Take a deep breath and continue your meditation. We're experiencing some technical difficulties.");
      }
    }
  }
}