import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@qed/tokens/tokens.css";
import "@qed/ui/ui.css";
import "./console.css";

import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from the document");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
