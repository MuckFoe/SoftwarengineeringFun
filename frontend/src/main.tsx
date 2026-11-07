import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { routerBasename } from "./base";
import "./brand/fonts-fallback.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/type.css";
import "./styles/motion.css";

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
