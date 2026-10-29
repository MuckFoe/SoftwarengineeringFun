// Where the app is served from (spec 005 FR1): "/" locally, "/collab/" on the project hub.
// Vite sets BASE_URL from vite.config.ts's `base`, which comes from APP_BASE_PATH at build.
export const BASE: string = import.meta.env.BASE_URL;

/** `apiPath("/me")` is "/api/me" at the root and "/collab/api/me" under "/collab/". */
export const apiPath = (p: string): string => `${BASE}api${p}`;

export const routerBasename: string = BASE.replace(/\/$/, "") || "/";
