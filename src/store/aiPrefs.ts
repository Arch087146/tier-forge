import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ImageProviderKind, LlmProvider } from "../types";

export const LLM_PROVIDERS: { id: LlmProvider; name: string }[] = [
  { id: "openai", name: "OpenAI" },
  { id: "gemini", name: "Gemini" },
  { id: "openrouter", name: "OpenRouter" }
];

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
  openrouter: "openai/gpt-4.1-mini"
};

export const IMAGE_PROVIDERS: { id: ImageProviderKind; name: string }[] = [
  { id: "auto", name: "Auto (best available)" },
  { id: "openverse", name: "Openverse" },
  { id: "brave", name: "Brave Images" },
  { id: "wikimedia", name: "Wikimedia Commons" }
];

interface AiPrefsStore {
  provider: LlmProvider;
  /** Last model used per provider, so switching back keeps the choice. */
  models: Record<LlmProvider, string>;
  imageProvider: ImageProviderKind;
  safeSearch: boolean;
  count: number;
  setProvider: (provider: LlmProvider) => void;
  setModel: (provider: LlmProvider, model: string) => void;
  setImageProvider: (imageProvider: ImageProviderKind) => void;
  setSafeSearch: (safeSearch: boolean) => void;
  setCount: (count: number) => void;
}

export const useAiPrefs = create<AiPrefsStore>()(
  persist(
    (set) => ({
      provider: "openai",
      models: { openai: "", gemini: "", openrouter: "" },
      imageProvider: "auto",
      safeSearch: true,
      count: 24,

      setProvider: (provider) => set({ provider }),

      setModel: (provider, model) =>
        set((state) => ({ models: { ...state.models, [provider]: model } })),

      setImageProvider: (imageProvider) => set({ imageProvider }),

      setSafeSearch: (safeSearch) => set({ safeSearch }),

      setCount: (count) => set({ count: Math.min(48, Math.max(4, count)) })
    }),
    {
      name: "tierforge.ai.v1",
      version: 1,
      partialize: (state) => ({
        provider: state.provider,
        models: state.models,
        imageProvider: state.imageProvider,
        safeSearch: state.safeSearch,
        count: state.count
      })
    }
  )
);
