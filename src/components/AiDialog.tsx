import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { cancelPopulate, isTauri, populateBoard } from "../lib/tauri";
import {
  DEFAULT_MODELS,
  IMAGE_PROVIDERS,
  LLM_PROVIDERS,
  useAiPrefs
} from "../store/aiPrefs";
import type { AiProgress, GenerateRequest, PopulateResult } from "../types";

interface AiDialogProps {
  onClose: () => void;
  onDone: (result: PopulateResult) => void;
}

const PHASE_LABEL: Record<string, string> = {
  generating: "Researching the theme",
  resolving: "Finding and caching images",
  done: "Done"
};

export function AiDialog({ onClose, onDone }: AiDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AiProgress | null>(null);

  // These choices are persisted, so the dialog reopens with the provider and
  // model that were used last instead of resetting to the defaults.
  const count = useAiPrefs((state) => state.count);
  const setCount = useAiPrefs((state) => state.setCount);
  const provider = useAiPrefs((state) => state.provider);
  const setProvider = useAiPrefs((state) => state.setProvider);
  const model = useAiPrefs((state) => state.models[state.provider]);
  const setModel = useAiPrefs((state) => state.setModel);
  const imageProvider = useAiPrefs((state) => state.imageProvider);
  const setImageProvider = useAiPrefs((state) => state.setImageProvider);
  const safeSearch = useAiPrefs((state) => state.safeSearch);
  const setSafeSearch = useAiPrefs((state) => state.setSafeSearch);

  useEffect(() => {
    if (!isTauri) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<AiProgress>("ai://progress", (event) => {
      if (!disposed) setProgress(event.payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Closing the dialog (including with Escape) must not leave the backend
  // resolving images for a result nobody will see.
  useEffect(() => {
    return () => {
      if (isTauri) void cancelPopulate().catch(() => undefined);
    };
  }, []);

  async function generate() {
    const theme = prompt.trim();
    if (!theme || busy) return;

    setBusy(true);
    setError(null);
    setProgress({ phase: "generating", done: 0, total: count });

    const request: GenerateRequest = {
      prompt: theme,
      count,
      provider,
      imageProvider,
      safeSearch,
      model: model.trim() || null
    };

    try {
      const result = await populateBoard(request);
      onDone(result);
      onClose();
    } catch (cause) {
      const message = String(cause);
      if (!message.toLowerCase().includes("cancelled")) {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    try {
      await cancelPopulate();
    } catch {
      // The backend may already have finished.
    }
    setBusy(false);
    setProgress(null);
  }

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="AI populate">
        <div className="modal-heading">
          <div>
            <h2>AI populate</h2>
            <p>Describe a theme. TierForge builds the item list and resolves real images.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>

        <label className="field">
          <span>Theme or prompt</span>
          <textarea
            autoFocus
            rows={3}
            value={prompt}
            placeholder="e.g. Best 3D platformers of the 90s, or fast food menu items ranked"
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Items: {count}</span>
            <input
              type="range"
              min={4}
              max={48}
              step={2}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              disabled={busy}
            />
          </label>

          <label className="field">
            <span>LLM</span>
            <select
              value={provider}
              onChange={(event) =>
                setProvider(event.target.value as typeof provider)
              }
              disabled={busy}
            >
              {LLM_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Images</span>
            <select
              value={imageProvider}
              onChange={(event) =>
                setImageProvider(event.target.value as typeof imageProvider)
              }
              disabled={busy}
            >
              {IMAGE_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Model</span>
          <input
            type="text"
            value={model}
            placeholder={DEFAULT_MODELS[provider]}
            title={`Leave blank to use ${DEFAULT_MODELS[provider]}`}
            spellCheck={false}
            onChange={(event) => setModel(provider, event.target.value)}
            disabled={busy}
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={safeSearch}
            onChange={(event) => setSafeSearch(event.target.checked)}
            disabled={busy}
          />
          <span>Safe search and mature-content filtering</span>
        </label>

        {busy ? (
          <div className="progress-panel">
            <div className="progress-line">
              <span>{PHASE_LABEL[progress?.phase ?? ""] ?? "Working"}</span>
              <span>
                {progress?.done ?? 0}/{progress?.total ?? count}
              </span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="progress-detail">
              {progress?.item?.name
                ? `Resolved: ${progress.item.name}`
                : "Keys never leave the Rust backend."}
            </p>
          </div>
        ) : null}

        {error ? <div className="error-box">{error}</div> : null}

        <div className="modal-actions">
          {busy ? (
            <button type="button" className="ghost-button" onClick={() => void cancel()}>
              Cancel
            </button>
          ) : (
            <button type="button" className="ghost-button" onClick={onClose}>
              Close
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            onClick={() => void generate()}
            disabled={busy || prompt.trim().length === 0}
          >
            {busy ? "Generating…" : "Generate list"}
          </button>
        </div>
      </div>
    </div>
  );
}
