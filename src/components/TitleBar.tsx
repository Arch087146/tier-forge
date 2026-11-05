import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/tauri";

export function TitleBar() {
  const appWindow = isTauri ? getCurrentWindow() : null;

  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={() => void appWindow?.toggleMaximize()}
    >
      <div className="brand" data-tauri-drag-region>
        <span className="brand-mark">TF</span>
        <span className="brand-name">TierForge</span>
      </div>
      <div className="titlebar-spacer" data-tauri-drag-region />
      <div className="window-controls">
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => void appWindow?.minimize()}
        >
          –
        </button>
        <button
          type="button"
          aria-label="Maximize"
          title="Maximize"
          onClick={() => void appWindow?.toggleMaximize()}
        >
          ▢
        </button>
        <button
          type="button"
          className="close"
          aria-label="Close"
          title="Close"
          onClick={() => void appWindow?.close()}
        >
          ×
        </button>
      </div>
    </header>
  );
}
