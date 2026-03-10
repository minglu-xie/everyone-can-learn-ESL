import {
  AppSettingsProviderContext,
  AISettingsProviderContext,
} from "@renderer/context";
import { useContext } from "react";
import {
  lookupCommand,
  extractStoryCommand,
  translateCommand,
  analyzeCommand,
  punctuateCommand,
  summarizeTopicCommand,
  refineCommand,
  chatSuggestionCommand,
} from "@commands";
import { md5 as md5Hash } from "js-md5";

export const useAiCommand = () => {
  const { EnjoyApp, webApi, nativeLanguage, learningLanguage } = useContext(
    AppSettingsProviderContext
  );
  const { currentGptEngine } = useContext(AISettingsProviderContext);

  const lookupWord = async (params: {
    word: string;
    context: string;
    sourceId?: string;
    sourceType?: string;
    cacheKey?: string;
    force?: boolean;
  }) => {
    const { context, sourceId, sourceType, cacheKey, force = false } = params;
    let { word } = params;
    word = word.trim();
    if (!word) return;

    // Try backend lookup; fall back to local-only when not logged in
    let lookup: any = null;
    try {
      lookup = await webApi.lookup({
        word,
        context,
        sourceId,
        sourceType,
        nativeLanguage,
      });
    } catch (err) {
      console.warn("webApi.lookup unavailable, using local-only mode:", err.message);
      // Check local cache first
      if (cacheKey && !force) {
        const cached = await EnjoyApp.cacheObjects.get(cacheKey);
        if (cached?.meaning) return cached;
      }
      lookup = { id: null, meaning: null, meaningOptions: [] };
    }

    if (lookup.meaning && !force) {
      return lookup;
    }

    const lookupModel =
      currentGptEngine.models.lookup || currentGptEngine.models.default;

    const callLookup = (model: string) =>
      lookupCommand(
        {
          word,
          context,
          meaningOptions: lookup.meaningOptions,
          nativeLanguage,
          learningLanguage,
        },
        {
          key: currentGptEngine.key,
          modelName: model,
          baseUrl: currentGptEngine.baseUrl,
        }
      );

    let res;
    try {
      res = await callLookup(lookupModel);
    } catch (err) {
      // If a custom lookup model fails (e.g. stale "4o-mini"), retry with default
      if (lookupModel !== currentGptEngine.models.default) {
        console.warn(`Lookup model "${lookupModel}" failed, retrying with default:`, err.message);
        res = await callLookup(currentGptEngine.models.default);
      } else {
        throw err;
      }
    }

    // Only sync back to backend if we have a real lookup record
    if (lookup.id) {
      webApi.updateLookup(lookup.id, {
        meaning: res,
        sourceId,
        sourceType,
      });
    }

    const result = Object.assign(lookup, {
      meaning: res,
    });

    if (cacheKey) {
      EnjoyApp.cacheObjects.set(cacheKey, result);
    }

    return result;
  };

  const extractStory = async (story: StoryType) => {
    const res = await extractStoryCommand(story.content, learningLanguage, {
      key: currentGptEngine.key,
      modelName:
        currentGptEngine.models.extractStory || currentGptEngine.models.default,
      baseUrl: currentGptEngine.baseUrl,
    });
    const { words = [], idioms = [] } = res;

    return webApi.extractVocabularyFromStory(story.id, {
      words,
      idioms,
    });
  };

  const translate = async (
    text: string,
    cacheKey?: string
  ): Promise<string> => {
    let translatedContent = "";
    const md5 = md5Hash(text.trim());
    const engine = currentGptEngine.key;
    const modelName =
      currentGptEngine.models.translate || currentGptEngine.models.default;

    try {
      const res = await webApi.translations({
        md5,
        translatedLanguage: nativeLanguage,
        engine: modelName,
      });

      if (res.translations.length > 0) {
        translatedContent = res.translations[0].translatedContent;
      }
    } catch (error) {
      console.error(error);
    }

    if (!translatedContent) {
      translatedContent = await translateCommand(text, nativeLanguage, {
        key: engine,
        modelName,
        baseUrl: currentGptEngine.baseUrl,
      });

      webApi.createTranslation({
        md5,
        content: text,
        translatedContent,
        language: learningLanguage,
        translatedLanguage: nativeLanguage,
        engine: modelName,
      });
    }

    if (cacheKey) {
      EnjoyApp.cacheObjects.set(cacheKey, translatedContent);
    }

    return translatedContent;
  };

  const analyzeText = async (text: string, cacheKey?: string) => {
    const res = await analyzeCommand(
      text,
      {
        learningLanguage,
        nativeLanguage,
      },
      {
        key: currentGptEngine.key,
        modelName:
          currentGptEngine.models.analyze || currentGptEngine.models.default,
        baseUrl: currentGptEngine.baseUrl,
      }
    );

    if (cacheKey) {
      EnjoyApp.cacheObjects.set(cacheKey, res);
    }
    return res;
  };

  const punctuateText = async (text: string) => {
    return punctuateCommand(text, {
      key: currentGptEngine.key,
      modelName: currentGptEngine.models.default,
      baseUrl: currentGptEngine.baseUrl,
    });
  };

  const summarizeTopic = async (text: string) => {
    return summarizeTopicCommand(text, learningLanguage, {
      key: currentGptEngine.key,
      modelName: currentGptEngine.models.default,
      baseUrl: currentGptEngine.baseUrl,
    });
  };

  const refine = async (
    text: string,
    options: {
      learningLanguage?: string;
      nativeLanguage?: string;
      context: string;
    }
  ) => {
    const { context } = options;
    return refineCommand(
      text,
      {
        learningLanguage: options.learningLanguage || learningLanguage,
        nativeLanguage: options.nativeLanguage || nativeLanguage,
        context,
      },
      {
        key: currentGptEngine.key,
        modelName: currentGptEngine.models.default,
        baseUrl: currentGptEngine.baseUrl,
      }
    );
  };

  const chatSuggestion = async (
    context: string,
    options?: {
      learningLanguage?: string;
      nativeLanguage?: string;
      cacheKey?: string;
    }
  ) => {
    const result = await chatSuggestionCommand(
      {
        context,
        learningLanguage: options?.learningLanguage || learningLanguage,
        nativeLanguage: options?.nativeLanguage || nativeLanguage,
      },
      {
        key: currentGptEngine.key,
        modelName: currentGptEngine.models.default,
        baseUrl: currentGptEngine.baseUrl,
      }
    );

    if (options.cacheKey) {
      EnjoyApp.cacheObjects.set(options.cacheKey, result);
    }

    return result;
  };

  return {
    lookupWord,
    extractStory,
    translate,
    analyzeText,
    punctuateText,
    summarizeTopic,
    refine,
    chatSuggestion,
  };
};
