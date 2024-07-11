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
  private memory: VectorStoreRetrieverInterface;
  private fullMessageHistory: BaseMessage[] = [];
  private chain: RunnableSequence;
  private tools: ObjectTool[];
  private maxIterations: number;
  private textSplitter: TokenTextSplitter;
  private sendTokenLimit: number;
  private encoding: any = null;
  private abortFlag: boolean = false;

  constructor(
    meditationId: number,
    comments: string,
    llm: BaseChatModel,
    tools: ObjectTool[],
    { memory, maxIterations = 1000, sendTokenLimit = 4096 }: AutoGPTInput & { sendTokenLimit?: number }
  ) {
    this.meditationId = meditationId;
    this.comments = comments;
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
  You are a meditation coach who conducts guided meditation sessions based on the biometric stats of the user.
  Conduct the session in three stages: grounding, immersion and closure. Instructions for each stage is provided below.
  Think step by step. At each step, decide whether to provide an instruction to the user based on the stage and biometric stats or keep monitoring.
  Start by checking the time left in the session. Keep track of it and make sure to plan each stage accordingly.
  Your decisions must always be made independently without seeking user assistance.
  Play to your strengths as an LLM and pursue simple strategies with no legal complications.
  
  Goals: {goals}

  User Comments: 
  ${this.comments}

  Grouding Stage:
  - Provide instructions to adopt a comfortable posture.
  - Ask the user to set an intention to sit as still as possible.
  - Ask the user to take a few deep breathing, feel the body sensations and relax. 
  - Move to the next stage when breathing stablizes.

  Immersion Stage:
  - Provide instructions to focus on the object of meditation and return if distracted. 
  - Monitor the heart rate, breathing rate and movements continously.
  - Give ample time in between instructions to allow the user to keep the focus.
  - Interrupt only if there's any major change in the biometric stats.
  - Move to the next stage when a time left nears 1 minute or so.

  Clousure Stage:
  - Ask the user to stop focusing on the object of meditation.
  - Provide intructions on reflect on the session and current mental state.
  - Ask user to rub the hands together, place the palms on the eyes and slide downward towards the neck.
  - Suggest to do a namaste gesture to express gratitude.
  - Provide instruction to try and keep practicing it for the rest of the day. 
  
  Constraints:
  1. If you are unsure how you previously did something or want to recall past events, thinking about similar events will help you remember.
  2. No user assistance
  3. Exclusively use the commands listed in double quotes e.g. "command name"
  
  Commands:
  ${this.tools.map((tool, i) => `${i + 1}. ${this.generateCommandString(tool)}`).join('\n')}
  ${this.tools.length + 1}. "${FINISH_NAME}": use this to signal that you have finished all your objectives, args: "response": "final response to let people know you have finished your objectives"
    
  Performance Evaluation:
  1. Continuously review and analyze your actions to ensure you are performing to the best of your abilities.
  2. Constructively self-criticize your big-picture behavior constantly.
  3. Reflect on past decisions and strategies to refine your approach.
  4. Every command has a cost, so be smart and efficient. Aim to complete tasks in the least number of steps.
  
  You should only respond in JSON format as described below:
  
  Response Format:
  {
    "thoughts": {
      "meditation_id": ${this.meditationId},
      "seconds_left": "time left for the session",
      "stage": "meditation stage",
      "text": "thought",
      "reasoning": "reasoning",
      "plan": ["short list", "that conveys", "long-term plan"],
      "criticism": "constructive self-criticism",
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

  private async formatMessages(goals: string[], userInput: string): Promise<BaseMessage[]> {
    const basePrompt = new SystemMessage(this.constructPrompt());
    const timePrompt = new SystemMessage(
      `The current time and date is ${new Date().toLocaleString()}`
    );
  
    const usedTokens =
      await this.countTokens(basePrompt.content as string) +
      await this.countTokens(timePrompt.content as string);
  
    const relevantDocs = await this.memory.getRelevantDocuments(
      JSON.stringify(this.fullMessageHistory.slice(-10))
    );
    
    const relevantMemory = relevantDocs.map(d => d.pageContent);
    let relevantMemoryTokens = await relevantMemory.reduce(
      async (acc: Promise<number>, doc: string) => (await acc) + await this.countTokens(doc),
      Promise.resolve(0)
    );
  
    while (usedTokens + relevantMemoryTokens > 2500) {
      relevantMemory.pop();
      relevantMemoryTokens = await relevantMemory.reduce(
        async (acc: Promise<number>, doc: string) => (await acc) + await this.countTokens(doc),
        Promise.resolve(0)
      );
    }
  
    const contentFormat = `This reminds you of these events from your past:\n${relevantMemory.join("\n")}\n\n`;
    const memoryMessage = new SystemMessage(contentFormat);
  
    const usedTokensWithMemory =
      usedTokens + await this.countTokens(memoryMessage.content as string);
  
    const historicalMessages: BaseMessage[] = [];
    for (const message of this.fullMessageHistory.slice(-10).reverse()) {
      const messageTokens = await this.countTokens(message.content as string);
      if (usedTokensWithMemory + messageTokens > this.sendTokenLimit - 1000) {
        break;
      }
      historicalMessages.unshift(message);
    }
  
    const inputMessage = new HumanMessage(userInput);
    
    return [
      basePrompt,
      timePrompt,
      memoryMessage,
      ...historicalMessages,
      inputMessage,
    ];
  }

  async run(goals: string[]): Promise<string | undefined> {
    const userInput = "Determine which next command to use, and respond using the format specified above:";
    let loopCount = 0;
    while (loopCount < this.maxIterations) {
      loopCount += 1;

      const messages = await this.formatMessages(goals, userInput);
      
      const response = await this.chain.invoke({
        messages,
        goals,
      });

      const assistantReply = response.content;
      console.log(assistantReply);
      this.fullMessageHistory.push(new HumanMessage(userInput));
      this.fullMessageHistory.push(new AIMessage(assistantReply));

      const action = await this.parseOutput(assistantReply);
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

  private async parseOutput(text: string): Promise<AutoGPTAction> {
    const preprocessJsonInput = (input: string): string => {
      const corrected = input.replace(/(?<!\\)\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");
      const match = corrected.match(/```(.*)(\r\n|\r|\n)(?<code>[\w\W\n]+)(\r\n|\r|\n)```/);
      return match?.groups?.code?.trim() || corrected;
    };

    try {
      const parsed = JSON.parse(text);
      return {
        name: parsed.command.name,
        args: parsed.command.args,
      };
    } catch (error) {
      const preprocessedText = preprocessJsonInput(text);
      try {
        const parsed = JSON.parse(preprocessedText);
        return {
          name: parsed.command.name,
          args: parsed.command.args,
        };
      } catch (error) {
        return {
          name: "ERROR",
          args: { error: `Could not parse invalid json: ${text}` },
        };
      }
    }
  }

  public abort(): void {
    this.abortFlag = true;
  }
}