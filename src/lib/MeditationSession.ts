import { createClient, AuthApiError, type Session, type Subscription } from '@supabase/supabase-js';
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
    id: string;
    stage: string;
    seconds_left: number;
    biometric_analysis: string;
    mental_state: string;
    reasoning: string;
    criticism: string;
    instruction: string;
  }
}

export class MeditationSession extends EventEmitter {
  private static activeSessions: Map<number, MeditationSession> = new Map();

  private meditationId: number;
  private supabase: SupabaseClient;
  private llm: ChatOpenAI;
  private messageHistory: InMemoryChatMessageHistory;
  private intervalId: NodeJS.Timeout | null = null;
  private method: string;
  private durationSeconds: number;
  private comments: string;
  private maxTokens: number = 100000; 
  private encoding: any = null;
  private startTime: number = 0;
  private parser: JsonOutputParser<MeditationResponse>;
  private withMessageHistory!: RunnableWithMessageHistory<{
    input: string;
    biometrics: string;
    timeLeft: number;
    move_instruction: string;
    chat_history: BaseMessage[];
  }, AIMessage>;
  private session: Session;
  private authListener: Subscription;
  private model: string;

  constructor(meditationId: number, method: string, comments: string, durationMinutes: number, session: Session, model: string = 'gpt-4o') {
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
    this.method = method;
    this.comments = comments;
    this.durationSeconds = durationMinutes * 60;
    this.model = model;
    this.parser = new JsonOutputParser<MeditationResponse>();
    this.authListener = this.setupAuthListener();

    MeditationSession.activeSessions.set(meditationId, this);
  }

  private async getUserInfo(userId: string) {
    const { data: profileData, error: profileError } = await this.supabase
      .from('profiles')
      .select('full_name, location, date_of_birth')
      .eq('id', userId)
      .single();
  
    if (profileError) throw profileError;
  
    const { data: sessionData, error: sessionError } = await this.supabase
      .from('meditation_sessions')
      .select('id')
      .eq('user_id', userId);
  
    if (sessionError) throw sessionError;
  
    const age = profileData.date_of_birth 
      ? Math.floor((new Date().getTime() - new Date(profileData.date_of_birth).getTime()) / 3.15576e+10)
      : null;
  
    return {
      fullName: profileData.full_name,
      location: profileData.location,
      age,
      totalSessions: sessionData.length
    };
  }

  static getSession(meditationId: number): MeditationSession | undefined {
    return MeditationSession.activeSessions.get(meditationId);
  }

  static stopSession(meditationId: number): void {
    const session = MeditationSession.activeSessions.get(meditationId);
    if (session) {
      session.stop();
    }
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

  private setupAuthListener(): Subscription {
    const { data: { subscription } } = this.supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        console.log(`User signed out during meditation session, meditation: ${this.meditationId}`);
        await this.endSession(false);
        this.emit('sessionEnded', 'User signed out');
      } else if (event === 'TOKEN_REFRESHED' && session) {
        console.log(`Token refreshed during meditation session, meditation: ${this.meditationId}`);
        this.session = session;
        this.supabase = this.createSupabaseClient(session.access_token);
      }
    });
    return subscription;
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
    this.startTime = Date.now();
    await this.initializeEncoding();
    const userInfo = await this.getUserInfo(this.session.user.id);
  
    const systemPrompt = `
As a meditation guru, your task is to conduct a ${this.method} meditation session of ${this.durationSeconds} seconds using the biometric stats as a guide. The id of this session is ${this.meditationId}.
Conduct the session in three stages: grounding, immersion and closure. Instructions for each stage is detailed below. Move to the next stage ONLY when instructed.
The biometrics stats are estimated from the live video feed using rPPG algorithm. Infer the mental/physical state of the user from the data. Invalid values may indicate wrong posture.
Think step by step. Base your decisions on the biometric stats and your assessment of the user's mental state.
Keep the instructions brief. Encourage and reassure the user whenever possible. Consider the user comments, if any.
Do NOT repeat the same instruction. Mix it up. Be creative. 

User Information:
Name: ${userInfo.fullName}
Location: ${userInfo.location}
Age: ${userInfo.age}
Total Sessions: ${userInfo.totalSessions}
User Comments (for this session):
${this.comments ? this.comments.trim() : 'None'}

Grounding Stage Instructions:
- Greet the user warmly and provide instructions to sit in a comfortable posture and look straight at the camera.
- Instruct the user to take few deep breaths and close the eyes when ready.
- Ask the user to set an intention to sit as still as possible.
- Inform that you'll monitor the biometrics and provide further instructions.

Immersion Stage Instructions:
- Start by providing instructions for the ${this.method} meditation technique.
- Assess the mental state of the user based on the biometrics.
- If user seems to have lost focus, then provide a gentle reminder to return to the object of focus. 
- Do not provide any instruction if the user is focussed.
- Keep cycling through the instructions till the stage is over.
- Remind the user to correct posture on invalid biometrics data.

Closure Stage Instructions:
- Provide instructions to reflect on the session and current mental state.
- Ask user to rub the hands together, place the palms on the eyes and open it.
- Summaize the biometrics observed during the session and provide feedback.
- Ask the user to try and keep practicing it for the rest of the day. 
- End this stage with a goodbye till the next session.

ALWAYS respond in JSON format as described below:
{{
  "thoughts": {{
    "id": "id of this session",
    "stage": "stage of meditation",
    "seconds_left": "seconds left in session",
    "biometric_analysis": "analysis of the biometric stats",
    "mental_state": "assessment of user's mental state",
    "reasoning": "reasoning based on biometrics and mental state",
    "criticism": "constructive self-criticism of the reasoning",
    "instruction": "instruction to provide to the user, if any",
  }}
}}

Ensure the JSON is valid and can be parsed by JSON.parse()
`;
  
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", systemPrompt.trim()],
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

    await this.runLLM();
    this.intervalId = setInterval(() => this.runLLM(), 60000); // Run every 1 minute
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.authListener) {
      this.authListener.unsubscribe();
    }
    MeditationSession.activeSessions.delete(this.meditationId);
    console.log(`MeditationSession ${this.meditationId} stopped`);
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
        elapsed_seconds: elapsedSeconds,
        instruction: instruction,
      })
      .select('id');

    if (error) throw error;

    if (data && data.length > 0 && 'id' in data[0]) {
      const instructionId = data[0].id;
      console.log(`[${elapsedSeconds}s] [id:${this.meditationId}] Saved instruction ${instructionId}: ${instruction}`);
    } else {
      console.log(`[${elapsedSeconds}s] Failed to retrieve instruction ID after insertion for meditation ${this.meditationId}`);
    }
  }

  private async runLLM(retryAttempt: number = 0, errorMessage: string = ""): Promise<void> {
    const MAX_RETRIES = 3;
  
    try {
      const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
      const timeLeft = this.durationSeconds - elapsedSeconds;
      
      let move_instruction = "Stay in the immersion stage.";
      if (elapsedSeconds > 60) {
        move_instruction = "Move to the immersion stage.";
      }
      if (timeLeft <= 0) {
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
  
      if (timeLeft <= 0) {
        console.log(`time left ${timeLeft}, ending meditation ${this.meditationId}`);
        await this.endSession(true);
      }
    } catch (error: any) {
      console.error(`Attempt ${retryAttempt + 1} - Error in runLLM:`, error);
      
      if (retryAttempt < MAX_RETRIES - 1) {
        // If we haven't exhausted all retries, call runLLM again with an error message
        return this.runLLM(retryAttempt + 1, "Invalid JSON. Please respond with a valid JSON in the format specified.");
      } else {
        // If we've exhausted all retries, end the session with an error
        await this.endSession(false);
      }
    }
  }

  async endSession(success: boolean) {
    try {
      const { error } = await this.supabase
        .from('meditation_sessions')
        .update({ end_ts: new Date().toISOString() })
        .eq('id', this.meditationId)
        .eq('user_id', this.session.user.id);

      if (error) throw error;

      console.log(`end_ts updated for meditation ${this.meditationId}`);

      this.stop();
      this.emit('done', { success });
    } catch (error) {
      console.error('Error ending session:', error);
      this.emit('done', { success: false, error });
    }
  }
}