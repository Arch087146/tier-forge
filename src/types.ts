export interface TierItem {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  sourceUrl?: string;
  author?: string;
  license?: string;
}

export interface Tier {
  id: string;
  name: string;
  color: string;
  items: TierItem[];
}

export type BoardStyle = "forge" | "classic" | "basic";
export type Theme = "dark" | "light";

export interface BoardSnapshot {
  title: string;
  tiers: Tier[];
  pool: TierItem[];
  itemSize: number;
  boardStyle: BoardStyle;
  theme: Theme;
}

export interface CachedImage {
  id: string;
  path: string;
  width: number;
  height: number;
  provider: string;
  sourceUrl: string;
  pageUrl?: string | null;
  author?: string | null;
  license?: string | null;
}

export interface ResolvedItem {
  id: string;
  name: string;
  description: string;
  image: CachedImage | null;
}

export interface PopulateResult {
  theme: string;
  items: ResolvedItem[];
}

export type LlmProvider = "openai" | "gemini" | "openrouter";
export type ImageProviderKind = "auto" | "openverse" | "brave" | "wikimedia";

export interface GenerateRequest {
  prompt: string;
  count: number;
  provider: LlmProvider;
  model?: string | null;
  imageProvider: ImageProviderKind;
  safeSearch: boolean;
}

export interface AiProgress {
  phase: "generating" | "resolving" | "done" | string;
  done: number;
  total: number;
  item?: ResolvedItem | null;
}

export interface RecordingStarted {
  output: string;
  width: number;
  height: number;
}

export interface RecordingResult {
  output: string;
  durationMs: number;
  width: number;
  height: number;
}

export interface RecordingStatePayload {
  recording: boolean;
  output?: string | null;
  error?: string | null;
}

export interface RecordingStatus {
  recording: boolean;
  elapsedMs: number;
  output: string | null;
  width: number;
  height: number;
}
