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

  constructor(
    meditationId: number,
    technique: string,
    comments: string,
    llm: BaseChatModel,
    tools: ObjectTool[],
    { memory, maxIterations = 1000, sendTokenLimit = 100000 }: AutoGPTInput & { sendTokenLimit?: number }
  ) {
    this.meditationId = meditationId;
    this.comments = comments;
    this.technique = technique;
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
  As an expert meditation coach, your job is to conduct a ${this.technique} meditation sessions using the biometric and time stats to as a guide. 
  Conduct the session in three stages: grounding, immersion and closure. Instructions for each stage is detailed below.
  Think step by step. Base your decisions on primarily on the biometric and time stats. Continiously monitor those throughout the session.
  The biometrics stats are estimated from the live video feed using rPPG algorithm. They may indicate the mental/physical state of the user.
  Go into the monitoring mode for after providing any instruction. Alternate between checking the time and biometric stats in this mode.
  Biometrics are collected every 2.5 seconds. If any data points are missing, it may indicate wrong posture. Instruct the user to sit up and look straight.
  Instructions MUST be spaced at least 45-60 seconds apart. Check time stats and wait before providing the next instruction.
  Keep the instructions brief. Encourage and reassure the user whenever possible. Be creative. 
  Keep track of the time left in the meditation session. Plan each stage accordingly.
  When all stages are complete, use the "${FINISH_NAME}" command (without any args) to exit. 
  
  User Comments: 
  ${this.comments}

  Grouding Stage Instructions:
  - Greet the user and provide instructions sit in a comfortable posture, look straight, take few deep breaths and close the eyes.
  - Ask the user to set an intention to sit still.
  - Start monitoring the biometrics. 
  - Move to the next stage when biometrics settle down.

  Immersion Stage Instructions:
  - Start by providing instructions for ${this.technique} meditation technique.
  - Go into monitoring mode. Alternate between time stats and biometric stats.
  - Changes to the stats may indicate the user has lost focus. Instruct the user to return.
  - Instruct the user to correct posture and look straight on missing points in biometric stats.
  - Move to the next stage ONLY when less than 60 seconds are left in the session.

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
  1. Continuously review and analyze your actions, biometrics and time stats to ensure you are performing to the best of your abilities.
  2. Constructively self-criticize your big-picture behavior constantly.
  3. Reflect on past decisions and strategies to refine your approach.
  4. Think about how frequently did you check the biometrics and time stats.
  
  You should only respond in JSON format as described below:
  
  Response Format:
  {
    "thoughts": {
      "meditation_id": ${this.meditationId},
      "elapsed_seconds": 0,
      "seconds_left_in_session": 0,
      "seconds_since_last_instruction": 0,
      "stage": "meditation stage",
      "text": "thought",
      "biometrics": "analysis of the biometric data",
      "reasoning": "reasoning for the chosen action",
      "plan": ["short list", "that conveys", "long-term plan"],
      "criticism": "constructive self-criticism of the plan",
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
  
    while (usedTokens + relevantMemoryTokens > 50000) {
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

  async run(): Promise<string | undefined> {
    const userInput = "Determine which next command to use, and respond using the format specified above:";
    let loopCount = 0;
    while (loopCount < this.maxIterations) {
      loopCount += 1;

      const messages = await this.formatMessages(userInput);      
      const response = await this.chain.invoke({messages});

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