import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { Board } from "./components/Board";
import { AiDialog } from "./components/AiDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import {
  assetUrl,
  importImage,
  isTauri,
  revealRecording,
  startRecording as beginCapture,
  stopRecording as endCapture
} from "./lib/tauri";
import { useBoard } from "./store/board";
import type {
  PopulateResult,
  RecordingStatePayload,
  TierItem
} from "./types";

type Toast = { kind: "info" | "error"; text: string; output?: string };

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, 240);
      });
    });
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "Image";
  return name.replace(/\.[^.]+$/, "") || "Image";
}

/**
 * Windows Graphics Capture only delivers frames when the target window
 * presents a new one. A static tier list would otherwise produce a video that
 * jumps forward between drags. This 2x2 pixel alternates between two
 * indistinguishable dark colors so the compositor keeps presenting frames at
 * display refresh rate for the whole recording.
 */
function CaptureTicker({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.display = active ? "block" : "none";

    if (!active) return;

    let frame = 0;
    let raf = 0;

    const tick = () => {
      frame = (frame + 1) & 1;
      if (ref.current) {
        ref.current.style.backgroundColor = frame ? "#0a0c10" : "#0a0c11";
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return <div ref={ref} className="capture-ticker" aria-hidden="true" />;
}

export default function App() {
  const [aiOpen, setAiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [fitMode, setFitMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [toolbarPeek, setToolbarPeek] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const startingRef = useRef(false);
  const fittingRef = useRef(false);
  const toolbarTimerRef = useRef<number | null>(null);

  const addItems = useBoard((state) => state.addItems);
  const addTier = useBoard((state) => state.addTier);
  const itemSize = useBoard((state) => state.itemSize);
  const boardStyle = useBoard((state) => state.boardStyle);
  const theme = useBoard((state) => state.theme);
  const setItemSize = useBoard((state) => state.setItemSize);
  const setTheme = useBoard((state) => state.setTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!isTauri) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<RecordingStatePayload>("recorder://state", (event) => {
      if (disposed) return;
      if (event.payload.recording) {
        setRecording(true);
      } else {
        setRecording(false);
        if (event.payload.error) {
          setToast({ kind: "error", text: `Recorder: ${event.payload.error}` });
        } else if (event.payload.output) {
          setToast({
            kind: "info",
            text: "Recording saved",
            output: event.payload.output
          });
        }
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isTauri) return;
    void getCurrentWindow()
      .isFullscreen()
      .then(setFullscreen)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function clearToolbarTimer() {
      if (toolbarTimerRef.current !== null) {
        window.clearTimeout(toolbarTimerRef.current);
        toolbarTimerRef.current = null;
      }
    }

    if (!fullscreen || recording) {
      clearToolbarTimer();
      setToolbarPeek(false);
      return;
    }

    function onMouseMove(event: MouseEvent) {
      if (event.clientY <= 12) {
        clearToolbarTimer();
        setToolbarPeek(true);
      } else if (event.clientY > 72) {
        clearToolbarTimer();
        toolbarTimerRef.current = window.setTimeout(() => {
          setToolbarPeek(false);
          toolbarTimerRef.current = null;
        }, 320);
      }
    }

    function onMouseLeave() {
      clearToolbarTimer();
      setToolbarPeek(false);
    }

    window.addEventListener("mousemove", onMouseMove);
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    return () => {
      clearToolbarTimer();
      window.removeEventListener("mousemove", onMouseMove);
      document.documentElement.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [fullscreen, recording]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (recording) void stopCapture();
      }
      if (event.key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
      }
      if (event.key === "Escape") {
        if (aiOpen) setAiOpen(false);
        if (settingsOpen) setSettingsOpen(false);
        if (!aiOpen && !settingsOpen && !recording && fullscreen) {
          void setFullscreenMode(false);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function startCapture() {
    if (recording || startingRef.current) return;

    // Hide app chrome first, then give the compositor time to present a clean frame.
    startingRef.current = true;
    setRecording(true);
    await nextPaint();

    try {
      await beginCapture({ fps: 30, bitrate: 8_000_000, includeCursor: true });
    } catch (cause) {
      setRecording(false);
      setToast({ kind: "error", text: `Recorder: ${String(cause)}` });
    } finally {
      startingRef.current = false;
    }
  }

  async function stopCapture() {
    if (startingRef.current) return;

    try {
      await endCapture();
    } catch (cause) {
      setToast({ kind: "error", text: `Recorder: ${String(cause)}` });
    } finally {
      setRecording(false);
    }
  }

  async function fitBoard() {
    if (fittingRef.current) return;

    const stage = document.querySelector<HTMLElement>(".stage");
    if (!stage) return;

    fittingRef.current = true;
    try {
      const minSize = 40;
      const tolerance = 2;
      const fitsStage = () =>
        stage.scrollHeight <= stage.clientHeight + tolerance &&
        stage.scrollWidth <= stage.clientWidth + tolerance;

      stage.scrollTop = 0;
      stage.scrollLeft = 0;

      // Tighten the fixed chrome first (stage padding, row gaps, pool padding)
      // before choosing a card size.
      setFitMode(true);
      await nextFrame();

      // Find the largest card size that still fits both dimensions. Searching
      // from the top means Fit also grows a board that was left smaller than
      // the available space, instead of preserving an empty margin.
      let target = minSize;
      for (let candidate = 160; candidate >= minSize; candidate -= 4) {
        setItemSize(candidate);
        await nextFrame();
        if (fitsStage()) {
          target = candidate;
          break;
        }
      }
      setItemSize(target);
      await nextFrame();
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
    } finally {
      fittingRef.current = false;
    }
  }

  function handleItemSize(size: number) {
    // A manual size change means the user is taking over the layout again.
    setFitMode(false);
    setItemSize(size);
  }

  async function setFullscreenMode(next: boolean) {
    setFullscreen(next);

    if (!isTauri) {
      try {
        if (next) await document.documentElement.requestFullscreen();
        else if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
        setFullscreen(!next);
      }
      return;
    }

    try {
      await getCurrentWindow().setFullscreen(next);
    } catch (cause) {
      setFullscreen(!next);
      setToast({ kind: "error", text: `Fullscreen: ${String(cause)}` });
    }
  }

  function toggleFullscreen() {
    void setFullscreenMode(!fullscreen);
  }

  function handleAiDone(result: PopulateResult) {
    const items: TierItem[] = result.items.map((resolved) => ({
      id: resolved.id,
      name: resolved.name,
      description: resolved.description,
      imageUrl: resolved.image ? assetUrl(resolved.image.path) : undefined,
      sourceUrl: resolved.image?.pageUrl ?? resolved.image?.sourceUrl,
      author: resolved.image?.author ?? undefined,
      license: resolved.image?.license ?? undefined
    }));

    addItems(items);
    const withImages = items.filter((item) => item.imageUrl).length;
    setToast({
      kind: "info",
      text: `Added ${items.length} items (${withImages} with images) to the pool`
    });
  }

  async function handleAddImage() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"]
          }
        ]
      });

      if (typeof selected !== "string") return;

      const cached = await importImage(selected);
      addItems([
        {
          id: `${cached.id}-${crypto.randomUUID()}`,
          name: fileStem(selected),
          imageUrl: assetUrl(cached.path),
          sourceUrl: cached.sourceUrl
        }
      ]);
    } catch (cause) {
      setToast({ kind: "error", text: `Import failed: ${String(cause)}` });
    }
  }

  return (
    <div
      className={`app${recording ? " recording" : ""}${fitMode ? " is-fit" : ""}${
        fullscreen ? " is-fullscreen" : ""
      }${fullscreen && toolbarPeek && !recording ? " show-toolbar" : ""}`}
    >
      <CaptureTicker active={recording} />
      <TitleBar />
      <Toolbar
        itemSize={itemSize}
        boardStyle={boardStyle}
        theme={theme}
        busy={aiOpen || settingsOpen}
        recording={recording}
        onItemSize={handleItemSize}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onFit={() => void fitBoard()}
        onAi={() => setAiOpen(true)}
        onAddImage={() => void handleAddImage()}
        onAddTier={addTier}
        onRecord={() => void startCapture()}
        onSettings={() => setSettingsOpen(true)}
        onFullscreen={toggleFullscreen}
        fullscreen={fullscreen}
      />

      <main className="stage">
        <Board onAddImage={() => void handleAddImage()} />
      </main>

      {aiOpen ? (
        <AiDialog onClose={() => setAiOpen(false)} onDone={handleAiDone} />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      ) : null}

      {toast ? (
        <div className={`toast ${toast.kind}`}>
          <span>{toast.text}</span>
          {toast.output ? (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                if (toast.output) void revealRecording(toast.output);
              }}
            >
              Show in folder
            </button>
          ) : null}
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
