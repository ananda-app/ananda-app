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
    biometrics: string;
    mental_state: string;
    reasoning: string;
    plan: string[];
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
  private comments: string;
  private durationSeconds: number;
  private maxTokens: number = 100000; 
  private encoding: any = null;
  private startTime: number;
  private parser: JsonOutputParser<MeditationResponse>;

  constructor(meditationId: number, supabase: SupabaseClient, technique: string, comments: string, durationMinutes: number) {
    super();

    this.meditationId = meditationId;
    this.supabase = supabase;
    this.llm = new ChatOpenAI({ model: 'gpt-4o', temperature: 0.75, apiKey: OPENAI_API_KEY, verbose: true });
    this.messageHistory = new InMemoryChatMessageHistory();
    this.technique = technique;
    this.comments = comments;
    this.durationSeconds = durationMinutes * 60;
    this.startTime = Date.now();
    this.initializeEncoding();
    this.parser = new JsonOutputParser<MeditationResponse>();
  }

  private async initializeEncoding() {
    this.encoding = await encodingForModel("gpt-4");
  }

  private async countTokens(text: string): Promise<number> {
    if (!this.encoding) {
      await this.initializeEncoding();
    }
    return this.encoding!.encode(text).length;
  }

  async start() {
    const systemPrompt = `
As a meditation guru, your task is to conduct a ${this.technique} meditation session based on the biometric stats of the user. 
Conduct the session in three stages: grounding, immersion and closure. Instructions for each stage is detailed below.
Think step by step. Base your decisions on the biometric stats and your assessment of the user's mental state.
The biometrics stats are estimated from the live video feed using rPPG algorithm. Infer the mental/physical state of the user from the data.
Keep the instructions brief. Encourage and reassure the user whenever possible. 
Do NOT repeat the same instruction. Mix it up. Be creative. 

User Comments: 
${this.comments}

Grounding Stage Instructions:
- Greet the user and provide instructions sit in a comfortable posture, look straight, take few deep breaths and close the eyes.
- Ask the user to set an intention to sit still.
- Move to the next stage when biometrics settle down.

Immersion Stage Instructions:
- Start by providing instructions for ${this.technique} technique.
- Monitor the stats and assess the mental state of the user.
- If user has lost focus then provide the 6Rs return instruction. Skip otherwise.
- Move to the next stage when time left in session is less than 60 seconds.

Closure Stage Instructions:
- Provide instructions to reflect on the session and current mental state.
- Ask user to rub the hands together, place the palms on the eyes and open it.
- Ask the user to try and keep practicing it for the rest of the day. 
- End this stage with a goodbye and set the 'exit' flag go true.

ALWAYS respond in JSON format as described below:
{{
  "thoughts": {{
    "stage": "stage of meditation",
    "biometrics": "analysis of the biometric stats",
    "mental_state": "assessment of user's mental state",
    "reasoning": "reasoning",
    "plan": ["short list", "that conveys", "long-term plan"],
    "criticism": "constructive self-criticism of the plan",
    "instruction": "instruction to provide to the user, if any",
    "exit": "true if this is the last instruction of the session, false otherwise"
  }}
}}

Ensure the response can be parsed by JSON.parse()`;

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", systemPrompt],
      ["human", [
        "Here are the latest biometrics:\n{biometrics}",
        "Time left in session: {timeLeft} seconds",
        "Respond as per the format specified: "
      ].join('\n')],
    ]);

    const filterMessages = ({ chat_history }: { chat_history: BaseMessage[] }) => {
      return this.truncateMessageHistory(chat_history);
    };

    const chain = RunnableSequence.from([
      RunnablePassthrough.assign({
        chat_history: (input: Record<string, unknown>) => filterMessages(input as { chat_history: BaseMessage[] }),
      }),
      prompt,
      this.llm
    ]);

    const withMessageHistory = new RunnableWithMessageHistory({
      runnable: chain,
      getMessageHistory: async () => this.messageHistory,
      inputMessagesKey: "biometrics",
      historyMessagesKey: "chat_history",
    });

    const runLLM = async () => {
      const timeLeft = this.durationSeconds - Math.floor((Date.now() - this.startTime) / 1000);
      
      const biometrics = await this.getBiometricStats();
      
      const response = await withMessageHistory.invoke(
        { biometrics, timeLeft: timeLeft.toString() },
        { configurable: { sessionId: this.meditationId.toString() } }
      );

      await this.messageHistory.addMessages([
        new HumanMessage(biometrics + "\nTime left in session: " + timeLeft + " seconds"),
        new AIMessage(JSON.stringify(response))
      ]);      

      const content = (response as any).content;
      console.log("LLM Response:", content);
      const parsedResponse = this.parseResponse(Array.isArray(content) ? content[0].content : content);
      await this.provideNextInstruction(parsedResponse.thoughts.instruction);

      if (parsedResponse.thoughts.exit) {
        this.stop();
      }
    };

    await runLLM();

    this.intervalId = setInterval(runLLM, 60000); // Run every 1 minute
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.emit('done');
  }

  private async truncateMessageHistory(messages: BaseMessage[]): Promise<BaseMessage[]> {
    let totalTokens = 0;
    const truncatedMessages: BaseMessage[] = [];

    // Count tokens from the end of the conversation
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const messageContent = Array.isArray(message.content) ? message.content.join(' ') : message.content;
      const messageTokens = await this.countTokens(messageContent);
      
      if (totalTokens + messageTokens > this.maxTokens) {
        break;
      }

      totalTokens += messageTokens;
      truncatedMessages.unshift(message);
    }

    return truncatedMessages;
  }

  private parseResponse(content: string): MeditationResponse {
    try {
      const jsonString = content.replace(/^```json\n/, '').replace(/\n```$/, '');
      return JSON.parse(jsonString);
    } catch (error) {
      console.error("Failed to parse LLM response:", error);
      throw new Error("Invalid response format from LLM");
    }
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
}