import React from "react";
import { createRoot } from "react-dom/client";
import "../design/tokens.css";
import "./manual.css";
import { Manual } from "./Manual";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Manual />
  </React.StrictMode>,
);
