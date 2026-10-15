import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Placeholder shell; routing replaces it in task 36.
export function Shell() {
  return <h1>Collaborative coding</h1>;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
}
