import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  GenerateRequest,
  PopulateResult,
  RecordingResult,
  RecordingStarted,
  RecordingStatus
} from "../types";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function assetUrl(path: string): string {
  if (!isTauri) return path;
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

export async function populateBoard(req: GenerateRequest): Promise<PopulateResult> {
  return invoke<PopulateResult>("populate_board", { req });
}

export async function cancelPopulate(): Promise<boolean> {
  return invoke<boolean>("cancel_populate");
}

export async function startRecording(options: {
  fps?: number;
  bitrate?: number;
  includeCursor?: boolean;
}): Promise<RecordingStarted> {
  return invoke<RecordingStarted>("start_recording", { req: options });
}

export async function stopRecording(): Promise<RecordingResult> {
  return invoke<RecordingResult>("stop_recording");
}

export async function recordingStatus(): Promise<RecordingStatus> {
  return invoke<RecordingStatus>("recording_status");
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  return invoke("set_api_key", { provider, key });
}

export async function hasApiKey(provider: string): Promise<boolean> {
  return invoke<boolean>("has_api_key", { provider });
}

export async function clearApiKey(provider: string): Promise<void> {
  return invoke("clear_api_key", { provider });
}

export async function importImage(path: string) {
  return invoke<{
    id: string;
    path: string;
    width: number;
    height: number;
    sourceUrl: string;
    provider: string;
  }>("import_image", { path });
}

export async function revealRecording(path: string): Promise<void> {
  return invoke("reveal_recording", { path });
}
