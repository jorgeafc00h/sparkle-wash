import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design/tokens.css";
// Plates are A–Z and 0–9: the Latin subset of the monospace face is enough.
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "./styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
