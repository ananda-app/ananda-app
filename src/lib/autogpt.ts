import type { VectorStoreRetrieverInterface } from "@langchain/core/vectorstores";
import { Tool } from "@langchain/core/tools";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getEmbeddingContextSize, getModelContextSize } from "@langchain/core/language_models/base";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { TokenTextSplitter } from "@langchain/textsplitters";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { JsonSchema7ObjectType } from "zod-to-json-schema";
import { getEncoding, encodingForModel } from "@langchain/core/utils/tiktoken";

export type ObjectTool = Tool;
export const FINISH_NAME = "finish";

export interface AutoGPTAction {
  name: string;
  args: Record<string, any>;
}

export interface AutoGPTInput {
  memory: VectorStoreRetrieverInterface;
  maxIterations?: number;
}

export class AutoGPT {
  private meditationId: number;
  private comments: string;
  private technique: string;
  private memory: VectorStoreRetrieverInterface;
  private fullMessageHistory: BaseMessage[] = [];
  private chain: RunnableSequence;
  private tools: ObjectTool[];
  private maxIterations: number;
  private textSplitter: TokenTextSplitter;
  private sendTokenLimit: number;
  private encoding: any = null;
  private abortFlag: boolean = false;
  private elapsedSeconds: number = 0;
  private secondsLeftInSession: number = 0;
  private secondsSinceLastInstruction: number = 0;
  private sessionDuration: number;
  private instructions: Array<{ elapsedSeconds: number; content: string }> = [];

  constructor(
    meditationId: number,
    technique: string,
    comments: string,
    durationMinutes: number,
    llm: BaseChatModel,
    tools: ObjectTool[],
    { memory, maxIterations = 1000, sendTokenLimit = 100000 }: AutoGPTInput & { sendTokenLimit?: number }
  ) {
    this.meditationId = meditationId;
    this.comments = comments;
    this.technique = technique;
    this.sessionDuration = durationMinutes * 60;  // Convert minutes to seconds
    this.secondsLeftInSession = this.sessionDuration;  
    this.tools = tools;
    this.memory = memory;
    this.maxIterations = maxIterations;
    this.sendTokenLimit = sendTokenLimit;
  
    this.initializeEncoding();
  
    const prompt = ChatPromptTemplate.fromMessages([
      new MessagesPlaceholder("messages"),
    ]);
  
    this.chain = RunnableSequence.from([prompt, llm]);
  
    const chunkSize = getEmbeddingContextSize(
      "modelName" in memory.vectorStore.embeddings
        ? (memory.vectorStore.embeddings.modelName as string)
        : undefined
    );
    this.textSplitter = new TokenTextSplitter({
      chunkSize,
      chunkOverlap: Math.round(chunkSize / 10),
    });
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
  
  private constructPrompt(): string {
    const basePrompt = `
As a meditation guru, your task is to conduct a ${this.technique} meditation session using the biometric stats to track the progress. 
Conduct the session in three stages: grounding, immersion and closure. Instructions for each stage is detailed below.
The session will last ${(this.sessionDuration / 60).toFixed(0)} minutes. Keep track of the time left and plan each stage accordingly.
Think step by step. Base your decisions on the biometric stats and last command result. Continiously monitor biometrics throughout the session.
The biometrics stats are estimated from the live video feed using rPPG algorithm. Infer the mental/physical state of the user from the data.
Provide the next instruction only when seconds since last instruction is 60 or more. Keep checking biometrics while waiting.
Keep the instructions brief. Encourage and reassure the user whenever possible. 
Do NOT repeat the same instruction. Refer to the past instructions section to check. Mix it up. Be creative. 
When all stages are complete, use the "${FINISH_NAME}" command to exit. 

User Comments: 
${this.comments}

Grouding Stage Instructions:
- Greet the user and provide instructions sit in a comfortable posture, look straight, take few deep breaths and close the eyes.
- Ask the user to set an intention to sit still.
- Start monitoring the biometrics. 
- Move to the next stage when biometrics settle down.

Immersion Stage Instructions:
- Start by providing instructions for ${this.technique} meditation technique.
- Changes to the stats may indicate the user has lost focus. 
- Keep monitoring if the biometrics remain stable. Interrupt only if they change.
- Move to the next stage ONLY when seconds left in session is less than 60.

Clousure Stage Instructions:
- Provide intructions to reflect on the session and current mental state.
- Ask user to rub the hands together, place the palms on the eyes and open it.
- Ask the user to try and keep practicing it for the rest of the day. 
- End this stage with a goodbye.

Constraints:
1. If you are unsure how you previously did something or want to recall past events, thinking about similar events will help you remember.
2. No user assistance
3. Exclusively use the commands listed in double quotes e.g. "command name"

Commands:
${this.tools.map((tool, i) => `${i + 1}. ${this.generateCommandString(tool)}`).join('\n')}
${this.tools.length + 1}. "${FINISH_NAME}": use this to signal that you have completed the meditation session"
  
Performance Evaluation:
1. Continuously review and analyze your plan, biometrics and time stats to ensure you are performing to the best of your abilities.
2. Constructively self-criticize your big-picture behavior constantly.
3. Reflect on past decisions and strategies to refine your approach.

You should only respond in JSON format as described below:

Response Format:
{
  "thoughts": {
    "meditation_id": ${this.meditationId},
    "stage": "stage of meditation",
    "text": "thought",
    "biometrics": "analysis of the biometric stats",
    "mental_state": "assessment of user's mental state",
    "reasoning": "reasoning",
    "plan": ["short list", "that conveys", "long-term plan"],
    "criticism": "constructive self-criticism of the plan",
    "time_stats": {
      "elapsed_seconds": "elapsed seconds",
      "seconds_left_in_session": "seconds left in session",
      "seconds_since_last_instruction": "seconds since last instruction",
    }
  },
  "command": {
    "name": "command name",
    "args": {
      "arg name": "value"
    }
  }
}

Ensure the response can be parsed by JSON.parse()`;
  
    return basePrompt;
  }
  
  private generateCommandString(tool: ObjectTool): string {
    const schema = zodToJsonSchema(tool.schema) as JsonSchema7ObjectType;
    return `"${tool.name}": ${tool.description}, args json schema: ${JSON.stringify(schema.properties)}`;
  }

  private async formatMessages(userInput: string): Promise<BaseMessage[]> {
    const basePrompt = new SystemMessage(this.constructPrompt());
    let usedTokens = await this.countTokens(basePrompt.content as string);
  
    // Add the last command result
    const lastSystemMessage = this.fullMessageHistory.findLast(message => message instanceof SystemMessage);
    let lastResultMessage: SystemMessage | null = null;
    if (lastSystemMessage) {
      const lastResultContent = "Last command result:\n" + lastSystemMessage.content;
      lastResultMessage = new SystemMessage(lastResultContent);
      usedTokens += await this.countTokens(lastResultContent);
    }
  
    // Prepare past instructions
    let pastInstructions = this.instructions
      .map(instruction => `- ${instruction.elapsedSeconds}s: ${instruction.content}`);
  
    // Calculate tokens for each instruction
    const instructionTokens = await Promise.all(pastInstructions.map(instr => this.countTokens(instr)));
  
    // Trim past instructions from the beginning if needed
    let systemContextContent = "Past instructions:\n";
    let totalInstructionTokens = instructionTokens.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < pastInstructions.length && 
           usedTokens + totalInstructionTokens + await this.countTokens(systemContextContent) > this.sendTokenLimit - 2000) {
      totalInstructionTokens -= instructionTokens[i];
      i++;
    }
  
    systemContextContent += pastInstructions.slice(i).join('\n');
    usedTokens += totalInstructionTokens + await this.countTokens(systemContextContent);
  
    const systemContext = new SystemMessage(systemContextContent);
  
    const inputMessage = new HumanMessage(userInput);
    usedTokens += await this.countTokens(inputMessage.content as string);
  
    const messages: BaseMessage[] = [basePrompt, systemContext];
    if (lastResultMessage) messages.push(lastResultMessage);
    messages.push(inputMessage);

    // console.log("###")
    // console.log("Full prompt:", messages.map(m => m.content).join('\n\n'));
    // console.log(`Total tokens used: ${usedTokens}`);
    // console.log("###")
  
    return messages;
  }

  async run(): Promise<string | undefined> {
    const baseUserInput = "Determine which next command to use, and respond using the format specified above:";
    let loopCount = 0;
    const startTime = Date.now();
    let lastInstructionTime = startTime - 100000; // Set initial secondsSinceLastInstruction to 100
    let thoughts = {"stage": "grounding"};

    while (loopCount < this.maxIterations) {
      loopCount += 1;

      // Update time stats
      const currentTime = Date.now();
      this.elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
      this.secondsLeftInSession = Math.max(0, this.sessionDuration - this.elapsedSeconds);
      this.secondsSinceLastInstruction = Math.floor((currentTime - lastInstructionTime) / 1000);

      const timeStats = [
        "Time Stats:",
        `- elapsed_seconds: ${this.elapsedSeconds}`,
        `- seconds_left_in_session: ${this.secondsLeftInSession}`,
        `- seconds_since_last_instruction: ${this.secondsSinceLastInstruction}`
      ].join('\n');

      let userInput;
      if (this.secondsSinceLastInstruction < 60) {
        userInput = `${timeStats}\n\nWait before providing the next instruction. ${baseUserInput}`;
      } else {
        userInput = `${timeStats}\n\nNext instruction may be provided now. ${baseUserInput}`;
      }

      if (this.secondsLeftInSession < 60 && thoughts.stage !== "closure") {
        userInput = `${timeStats}\n\nTime to move to closure stage. ${baseUserInput}`;
      }

      const messages = await this.formatMessages(userInput);      
      const response = await this.chain.invoke({messages});

      const assistantReply = response.content;
      console.log(assistantReply);
      this.fullMessageHistory.push(new HumanMessage(userInput));
      this.fullMessageHistory.push(new AIMessage(assistantReply));

      const parsed = this.parseOutput(assistantReply);
      const action = parsed.command;
      thoughts = parsed.thoughts; 

      const tools = Object.fromEntries(this.tools.map(tool => [tool.name, tool]));

      if (action.name === FINISH_NAME) {
        return action.args.response;
      }

      let result: string;
      if (action.name in tools) {
        const tool = tools[action.name];
        try {
          const observation = await tool.invoke(action.args);
          result = `Command ${tool.name} returned: ${observation}`;

          if (tool.name.toLowerCase().includes("instruction")) {
            lastInstructionTime = currentTime;
            this.instructions.push({
              elapsedSeconds: this.elapsedSeconds,
              content: action.args.input
            });
          }          
        } catch (e) {
          result = `Error in args: ${e}`;
        }
      } else if (action.name === "ERROR") {
        result = `Error: ${action.args}. `;
      } else {
        result = `Unknown command '${action.name}'. Please refer to the 'COMMANDS' list for available commands and only respond in the specified JSON format.`;
      }

      const memoryToAdd = `Assistant Reply: ${assistantReply}\nResult: ${result} `;
      const documents = await this.textSplitter.createDocuments([memoryToAdd]);
      await this.memory.addDocuments(documents);
      this.fullMessageHistory.push(new SystemMessage(result));

      if (this.abortFlag) {
        console.log("AutoGPT execution aborted");
        return "Meditation session aborted";
      }      
    }

    return undefined;
  }

  private parseOutput(text: string): any {
    const preprocessJsonInput = (input: string): string => {
      const corrected = input.replace(/(?<!\\)\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");
      const match = corrected.match(/```(.*)(\r\n|\r|\n)(?<code>[\w\W\n]+)(\r\n|\r|\n)```/);
      return match?.groups?.code?.trim() || corrected;
    };
  
    try {
      return JSON.parse(text);
    } catch (error) {
      const preprocessedText = preprocessJsonInput(text);
      try {
        return JSON.parse(preprocessedText);
      } catch (error) {
        return {
          thoughts: {
            text: "Error parsing JSON",
            stage: "error"
          },
          command: {
            name: "ERROR",
            args: { error: `Could not parse invalid json: ${text}` }
          }
        };
      }
    }
  }

  public abort(): void {
    this.abortFlag = true;
  }
}