import { CONTROL_COPY, type SceneLang } from "./copy";
import "./scene-base.css";

export interface SceneToggleProps {
  lang: SceneLang;
  paused: boolean;
  /** A play-once scene that has finished: the button replays it instead. */
  ended?: boolean;
  onToggle: () => void;
  onReplay?: () => void;
  className?: string;
}

/** Pause / resume (and replay for play-once scenes). Real text, 44 px minimum, keyboard operable as a native button. */
export function SceneToggle({ lang, paused, ended = false, onToggle, onReplay, className }: SceneToggleProps) {
  const t = CONTROL_COPY[lang];
  const mode = ended && onReplay ? "replay" : paused ? "resume" : "pause";
  const label = mode === "replay" ? t.replay : mode === "resume" ? t.resume : t.pause;
  return (
    <button
      type="button"
      className={["cs-m-toggle", className].filter(Boolean).join(" ")}
      data-mode={mode}
      onClick={mode === "replay" ? onReplay : onToggle}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        {mode === "pause" && <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />}
        {mode === "resume" && <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />}
        {mode === "replay" && (
          <path
            d="M8 3a5 5 0 1 1-4.6 3.1M3.2 2.6v3.6h3.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <span>{label}</span>
    </button>
  );
}
