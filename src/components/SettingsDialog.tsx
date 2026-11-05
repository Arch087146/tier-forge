import { useEffect, useState } from "react";
import { clearApiKey, hasApiKey, setApiKey } from "../lib/tauri";
import { itemHeightFor } from "../lib/itemSize";
import { useBoard } from "../store/board";
import type { BoardStyle } from "../types";

interface SettingsDialogProps {
  onClose: () => void;
}

const BOARD_STYLES: {
  id: BoardStyle;
  name: string;
  description: string;
}[] = [
  {
    id: "forge",
    name: "Forge",
    description: "Rounded panels, soft glow, and the original TierForge look."
  },
  {
    id: "classic",
    name: "Classic",
    description: "Plain square boxes, flat tier colors, and no placeholder text."
  },
  {
    id: "basic",
    name: "Basic",
    description: "Flat, minimal rows with a clean accent bar and no glow."
  }
];

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    hint: "Used for structured item generation. Default model: gpt-4.1-mini.",
    env: "OPENAI_API_KEY"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    hint: "Alternative LLM provider. Default model: gemini-2.5-flash.",
    env: "GEMINI_API_KEY"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    hint: "One key for many models. Default model: openai/gpt-4.1-mini.",
    env: "OPENROUTER_API_KEY"
  },
  {
    id: "brave",
    name: "Brave Image Search",
    hint: "Optional. Higher-quality image results. Free tier available.",
    env: "BRAVE_API_KEY"
  }
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const boardStyle = useBoard((state) => state.boardStyle);
  const setBoardStyle = useBoard((state) => state.setBoardStyle);
  const itemSize = useBoard((state) => state.itemSize);
  const setItemSize = useBoard((state) => state.setItemSize);
  const theme = useBoard((state) => state.theme);
  const setTheme = useBoard((state) => state.setTheme);
  const itemHeight = itemHeightFor(itemSize, boardStyle);

  const [values, setValues] = useState<Record<ProviderId, string>>({
    openai: "",
    gemini: "",
    openrouter: "",
    brave: ""
  });
  const [configured, setConfigured] = useState<Record<ProviderId, boolean>>({
    openai: false,
    gemini: false,
    openrouter: false,
    brave: false
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    Promise.all(
      PROVIDERS.map(async (provider) => {
        try {
          return [provider.id, await hasApiKey(provider.id)] as const;
        } catch {
          return [provider.id, false] as const;
        }
      })
    ).then((entries) => {
      if (disposed) return;
      setConfigured(Object.fromEntries(entries) as Record<ProviderId, boolean>);
    });

    return () => {
      disposed = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      for (const provider of PROVIDERS) {
        const value = values[provider.id].trim();
        if (value) await setApiKey(provider.id, value);
      }
      const entries = await Promise.all(
        PROVIDERS.map(async (provider) => {
          try {
            return [provider.id, await hasApiKey(provider.id)] as const;
          } catch {
            return [provider.id, false] as const;
          }
        })
      );
      setConfigured(Object.fromEntries(entries) as Record<ProviderId, boolean>);
      setValues({ openai: "", gemini: "", openrouter: "", brave: "" });
      setMessage("Saved to the OS credential vault.");
    } catch (cause) {
      setMessage(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: ProviderId) {
    setBusy(true);
    setMessage(null);
    try {
      await clearApiKey(id);
      setConfigured((current) => ({ ...current, [id]: false }));
      setMessage(`${id} key removed.`);
    } catch (cause) {
      setMessage(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal-heading">
          <div>
            <h2>Settings</h2>
            <p>
              Tune the board and connect AI providers. API keys stay in the OS
              credential vault and never reach the webview.
            </p>
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

        <section className="settings-section">
          <div className="settings-section-head">
            <h3>Board appearance</h3>
            <p>
              Pick the look that fits your list. The style is saved with the
              board and included in recordings.
            </p>
          </div>

          <div className="style-options" role="radiogroup" aria-label="Board style">
            {BOARD_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                className={`style-option${boardStyle === style.id ? " is-active" : ""}`}
                aria-pressed={boardStyle === style.id}
                onClick={() => setBoardStyle(style.id)}
              >
                <span
                  className={`style-swatch style-swatch-${style.id}`}
                  aria-hidden="true"
                >
                  <span className="style-swatch-label">S</span>
                  <span className="style-swatch-items">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="style-option-copy">
                  <strong>{style.name}</strong>
                  <small>{style.description}</small>
                </span>
                {boardStyle === style.id ? <span className="style-check">✓</span> : null}
              </button>
            ))}
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <strong>Board size</strong>
              <p>Scales the whole board wider and taller together, including cards and rows. Use Fit in the toolbar to shrink everything to the window.</p>
            </div>
            <div className="settings-input range-setting">
              <input
                type="range"
                min={40}
                max={160}
                step={4}
                value={itemSize}
                aria-label="Board size"
                title="One slider scales the board wider and taller together"
                onChange={(event) => setItemSize(Number(event.target.value))}
              />
              <span className="range-value">
                {itemSize} × {itemHeight}px
              </span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <strong>Theme</strong>
              <p>Light mode is for editing and sharing. Recording and fullscreen keep their clean black presentation.</p>
            </div>
            <div className="theme-options" role="group" aria-label="Theme">
              <button
                type="button"
                className={`theme-option${theme === "dark" ? " is-active" : ""}`}
                aria-pressed={theme === "dark"}
                onClick={() => setTheme("dark")}
              >
                <span aria-hidden="true">☾</span> Dark
              </button>
              <button
                type="button"
                className={`theme-option${theme === "light" ? " is-active" : ""}`}
                aria-pressed={theme === "light"}
                onClick={() => setTheme("light")}
              >
                <span aria-hidden="true">☀</span> Light
              </button>
            </div>
          </div>
        </section>

        <div className="settings-divider" />

        <section className="settings-section">
          <div className="settings-section-head">
            <h3>AI providers</h3>
            <p>Bring your own key. OpenAI, Gemini, OpenRouter, and Brave are optional.</p>
          </div>

          <div className="settings-list">
            {PROVIDERS.map((provider) => (
            <div className="settings-row" key={provider.id}>
              <div className="settings-label">
                <div>
                  <strong>{provider.name}</strong>
                  {configured[provider.id] ? (
                    <span className="badge">configured</span>
                  ) : null}
                </div>
                <p>{provider.hint}</p>
                <code>{provider.env}</code>
              </div>
              <div className="settings-input">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={configured[provider.id] ? "•••••••• (saved)" : "Paste key"}
                  value={values[provider.id]}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [provider.id]: event.target.value
                    }))
                  }
                  disabled={busy}
                />
                {configured[provider.id] ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void remove(provider.id)}
                    disabled={busy}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          </div>
        </section>

        {message ? <div className="info-box">{message}</div> : null}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy ? "Saving…" : "Save keys"}
          </button>
        </div>
      </div>
    </div>
  );
}
