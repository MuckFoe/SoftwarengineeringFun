// Tears down what global-setup.ts brought up: the production stack, its .env and
// .keycloak-state.json (both hold generated credentials).
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

export default async function globalTeardown(): Promise<void> {
  try {
    execFileSync("docker", ["compose", "-f", "docker-compose.yml", "down", "-v"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  } finally {
    rmSync(path.join(REPO_ROOT, ".env"), { force: true });
    rmSync(path.join(import.meta.dirname, ".keycloak-state.json"), { force: true });
  }
}
