import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri, recordingStatus, stopRecording } from "../lib/tauri";
import type { RecordingStatePayload } from "../types";

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function RecorderHud() {
  const [seconds, setSeconds] = useState(0);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // The HUD window is created at startup and hidden until recording begins, so
  // reset the clock on the recorder state transition rather than on mount.
  useEffect(() => {
    if (!isTauri) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncFromBackend = () => {
      void recordingStatus()
        .then((status) => {
          if (!disposed && status.recording) {
            setSeconds(Math.floor(status.elapsedMs / 1000));
          }
        })
        .catch(() => undefined);
    };

    syncFromBackend();
    document.addEventListener("visibilitychange", syncFromBackend);
    window.addEventListener("focus", syncFromBackend);

    listen<RecordingStatePayload>("recorder://state", (event) => {
      if (disposed) return;
      if (event.payload.recording) setSeconds(0);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
      document.removeEventListener("visibilitychange", syncFromBackend);
      window.removeEventListener("focus", syncFromBackend);
    };
  }, []);

  async function stop() {
    if (stopping) return;
    setStopping(true);
    try {
      await stopRecording();
    } catch (cause) {
      console.error("Failed to stop recording", cause);
    } finally {
      if (isTauri) {
        try {
          await getCurrentWindow().hide();
        } catch {
          // Window may already be closing.
        }
      }
      setStopping(false);
    }
  }

  return (
    <div className="hud" data-tauri-drag-region>
      <span className="hud-dot" />
      <div className="hud-copy">
        <span className="hud-label">Recording board</span>
        <span className="hud-time">{formatDuration(seconds)}</span>
      </div>
      <button
        type="button"
        className="hud-stop"
        onClick={() => void stop()}
        disabled={stopping}
      >
        {stopping ? "Saving…" : "Stop"}
      </button>
    </div>
  );
}
