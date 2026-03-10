import { ChatPromptTemplate } from "@langchain/core/prompts";
import { textCommand } from "./text.command";
import { LANGUAGES } from "@/constants";

export const analyzeCommand = async (
  text: string,
  params: {
    learningLanguage: string;
    nativeLanguage: string;
  },
  options: {
    key: string;
    modelName?: string;
    temperature?: number;
    baseUrl?: string;
  }
): Promise<string> => {
  if (!text) throw new Error("Text is required");

  const { learningLanguage, nativeLanguage } = params;

  // Build language-specific hints only when needed (saves tokens for English)
  const langHint = LANGUAGE_HINTS[learningLanguage.slice(0, 2)] || "";

  const prompt = await ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT + langHint],
    ["human", text],
  ]).format({
    learning_language: LANGUAGES.find((l) => l.code === learningLanguage).name,
    native_language: LANGUAGES.find((l) => l.code === nativeLanguage).name,
  });

  return textCommand(prompt, options);
};

// Language-specific analysis hints keyed by ISO 639-1 prefix.
// Only added to prompt when relevant — zero cost for other languages.
const LANGUAGE_HINTS: Record<string, string> = {
  sv: `\n\n### Additional Focus for Svenska\n(Also cover: en/ett noun genders, V2 word order rule, and any Swedish-specific idioms or false friends)`,
};

const SYSTEM_PROMPT = `I speak {native_language}. You're my {learning_language} coach, I'll provide {learning_language} text, you'll help me analyze the sentence structure, grammar, and vocabulary/phrases, and provide a detailed explanation of the text. Please return the results in the following format(but in {native_language}):

### Sentence Structure
(Explain each element of the sentence)

### Grammar
(Explain the grammar of the sentence)

### Vocabulary/Phrases
(Explain the key vocabulary and phrases used)`;
