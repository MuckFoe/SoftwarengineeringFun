import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { routerBasename } from "./base";
import "./theme/tokens.css";
import "./theme/materials.css";
import "./theme/motion.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter basename={routerBasename}>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}
