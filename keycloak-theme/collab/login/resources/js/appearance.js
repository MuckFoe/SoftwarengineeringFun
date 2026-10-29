// Spec 003 FR-18: show the sign-in page in the app's appearance.
// The app passes ?appearance=light|dark on the first login page; later pages (errors,
// OTP) on this origin reuse it from sessionStorage. Without either, follow the OS.
// Sets <html data-appearance> before first paint (collab.css keys off it) and keeps
// PatternFly's dark class in step, which keycloak.v2's own script sets from the OS only.
(() => {
  const KEY = "appearance";
  const DARK_CLASS = "pf-v5-theme-dark";
  const valid = (value) => value === "light" || value === "dark";

  let chosen = null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(KEY);
    if (valid(fromUrl)) sessionStorage.setItem(KEY, fromUrl);
    const stored = sessionStorage.getItem(KEY);
    if (valid(stored)) chosen = stored;
  } catch {
    // Storage blocked: fall back to the OS setting.
  }

  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const resolved = () => chosen ?? (media?.matches ? "dark" : "light");
  const root = document.documentElement;

  const apply = () => {
    const dark = resolved() === "dark";
    if (root.getAttribute("data-appearance") !== resolved()) {
      root.setAttribute("data-appearance", resolved());
    }
    if (root.classList.contains(DARK_CLASS) !== dark) root.classList.toggle(DARK_CLASS, dark);
  };

  apply();
  media?.addEventListener("change", apply);
  // keycloak.v2's module script runs after this one and on OS changes; re-assert ours.
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["class"] });
})();
