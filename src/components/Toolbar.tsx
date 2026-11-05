import { itemHeightFor } from "../lib/itemSize";
import type { BoardStyle, Theme } from "../types";

interface ToolbarProps {
  itemSize: number;
  boardStyle: BoardStyle;
  theme: Theme;
  busy: boolean;
  recording: boolean;
  onItemSize: (size: number) => void;
  onToggleTheme: () => void;
  onFit: () => void;
  onAi: () => void;
  onAddImage: () => void;
  onAddTier: () => void;
  onRecord: () => void;
  onSettings: () => void;
  onFullscreen: () => void;
  fullscreen: boolean;
}

export function Toolbar({
  itemSize,
  boardStyle,
  theme,
  busy,
  recording,
  onItemSize,
  onToggleTheme,
  onFit,
  onAi,
  onAddImage,
  onAddTier,
  onRecord,
  onSettings,
  onFullscreen,
  fullscreen
}: ToolbarProps) {
  const itemHeight = itemHeightFor(itemSize, boardStyle);

  return (
    <div className="toolbar">
      <button type="button" className="primary-button" onClick={onAi} disabled={busy}>
        <span className="spark">✦</span> AI populate
      </button>
      <button type="button" className="ghost-button" onClick={onAddImage}>
        Add image
      </button>
      <button type="button" className="ghost-button" onClick={onAddTier}>
        Add tier
      </button>

      <div className="toolbar-divider" />

      <label
        className="size-control"
        title="One slider scales the board wider and taller together"
      >
        <span>Board size</span>
        <input
          type="range"
          min={40}
          max={160}
          step={4}
          value={itemSize}
          onChange={(event) => onItemSize(Number(event.target.value))}
        />
        <span className="size-value">
          {itemSize} × {itemHeight}px
        </span>
      </label>
      <button
        type="button"
        className="ghost-button fit-button"
        onClick={onFit}
        title="Shrink the board until it fits without scrolling"
      >
        Fit
      </button>

      <div className="toolbar-spacer" />

      <button
        type="button"
        className="ghost-button theme-button"
        onClick={onToggleTheme}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      </button>
      <button
        type="button"
        className="ghost-button"
        onClick={onFullscreen}
        title={
          fullscreen
            ? "Exit fullscreen (Esc or F11)"
            : "Hide the toolbar and fill the window (F11)"
        }
      >
        {fullscreen ? "Exit fullscreen" : "Fullscreen"}
      </button>
      <button type="button" className="ghost-button" onClick={onSettings}>
        Settings
      </button>
      <button
        type="button"
        className="record-button"
        onClick={onRecord}
        disabled={recording || busy}
        title="Record the board area (Ctrl+Shift+R stops)"
      >
        <span className="record-dot" /> Record
      </button>
    </div>
  );
}
