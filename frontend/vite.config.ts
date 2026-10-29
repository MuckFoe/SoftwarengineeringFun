/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  // Spec 005: "/collab/" on the project hub, passed in as a build arg; "/" everywhere else.
  // loadEnv also picks APP_-prefixed variables up from the process environment.
  base: loadEnv(mode, ".", "APP_").APP_BASE_PATH || "/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Real CSS for theme tokens and ui modules, so tests can read their source with ?raw.
    css: { include: [/\/theme\/.*\.css/, /\/ui\/.*\.css/] },
  },
}));
