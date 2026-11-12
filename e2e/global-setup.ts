// Brings up the production stack (docker-compose.yml) against the test Keycloak
// (docker-compose.test.yml's `keycloak` service, already running). Mirrors
// backend/tests/integration/keycloak_fixtures.py in TypeScript: rotates the test
// client's secret and creates the test users with random passwords, then writes
// both docker compose's .env and e2e/.keycloak-state.json (read by fixtures.ts).
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REALM = "collab-test";
const CLIENT_ID = "collab-coding";
const KEYCLOAK_URL = (process.env.TEST_KEYCLOAK_URL ?? "http://127.0.0.1:58180").replace(
  /\/$/,
  "",
);
const ADMIN_USER = process.env.TEST_KEYCLOAK_ADMIN_USER ?? "admin";
const ADMIN_PASSWORD = process.env.TEST_KEYCLOAK_ADMIN_PASSWORD;

const TEST_USERS: Record<string, string[]> = {
  editor1: ["editor"],
  editor2: ["editor"],
  plain1: [],
  admin1: ["admin"],
  // Spec 012: accounts with no app role (task 4's test realm users).
  newuser: [],
  other: [],
  // Per-worker accounts for specs that reset or read stored preferences (look0..look9; the
  // worker picks look<parallelIndex>) and one for profile-prefs.spec.ts, so none of them
  // can see another's preference rows when files run in parallel.
  prefsuser: [],
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`look${i}`, [] as string[]])),
};

function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

async function adminToken(): Promise<string> {
  const response = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: ADMIN_USER,
      password: ADMIN_PASSWORD ?? "",
    }),
  });
  if (!response.ok) {
    throw new Error(`Keycloak admin login failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

async function adminFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  return response;
}

async function deleteUserIfPresent(token: string, username: string): Promise<void> {
  const found = await adminFetch(token, `/users?username=${username}&exact=true`);
  const users = (await found.json()) as Array<{ id: string }>;
  for (const user of users) {
    await adminFetch(token, `/users/${user.id}`, { method: "DELETE" });
  }
}

async function createUser(token: string, username: string, password: string): Promise<void> {
  await deleteUserIfPresent(token, username);
  const created = await adminFetch(token, "/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      enabled: true,
      email: `${username}@example.test`,
      emailVerified: true,
      firstName: username,
      lastName: "Test",
      credentials: [{ type: "password", value: password, temporary: false }],
    }),
  });
  if (!created.ok) {
    throw new Error(`could not create ${username}: ${created.status} ${await created.text()}`);
  }
  const location = created.headers.get("location") ?? "";
  const userId = location.split("/").pop();
  // Client roles on the app's own client: the app reads no others (spec 005 FR3).
  const roleNames = TEST_USERS[username] ?? [];
  if (roleNames.length > 0 && userId) {
    const client = await clientUuid(token);
    const roles = await Promise.all(
      roleNames.map(async (name) => {
        const r = await adminFetch(token, `/clients/${client}/roles/${name}`);
        return r.json();
      }),
    );
    const mapped = await adminFetch(token, `/users/${userId}/role-mappings/clients/${client}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(roles),
    });
    if (!mapped.ok) {
      throw new Error(`could not give ${username} ${roleNames}: ${mapped.status}`);
    }
  }
}

async function clientUuid(token: string): Promise<string> {
  const clients = await adminFetch(token, `/clients?clientId=${CLIENT_ID}`);
  const [client] = (await clients.json()) as Array<{ id: string }>;
  if (!client) {
    throw new Error(`no Keycloak client with clientId ${CLIENT_ID}`);
  }
  return client.id;
}

async function rotateClientSecret(token: string): Promise<string> {
  const client = await clientUuid(token);
  const rotated = await adminFetch(token, `/clients/${client}/client-secret`, {
    method: "POST",
  });
  const body = (await rotated.json()) as { value: string };
  return body.value;
}

export interface KeycloakState {
  issuer: string;
  clientId: string;
  users: Record<string, { username: string; password: string; roles: string[] }>;
}

// PW_KEEP_STACK=1 support. The api container bakes the rotated client secret and the db
// volume bakes the db password, so rotation cannot be combined with a kept stack. Design:
// reuse (no rotation, no user re-creation) only when .env + .keycloak-state.json exist, the
// api answers, Keycloak's current client secret equals the one in .env and every test user
// exists; then build/up only if the fingerprint of the compose inputs changed. Otherwise
// `down -v` and do the full plain setup (and still skip the build when the fingerprint
// is unchanged and the images exist).
const FINGERPRINT_FILE = path.join(import.meta.dirname, ".stack-fingerprint");
const FINGERPRINT_DIRS = ["backend", "frontend", "runner", "sandbox", "brand-assets"];
const SKIP_DIRS = new Set(["node_modules", "dist", "__pycache__", ".pytest_cache", ".venv", ".git", "tests", "e2e"]);

function hashTree(hash: ReturnType<typeof createHash>, dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name) || name.endsWith(".pyc") || name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) hashTree(hash, full);
    else hash.update(full + "\0").update(readFileSync(full));
  }
}

function composeFingerprint(): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path.join(REPO_ROOT, "docker-compose.yml")));
  for (const d of FINGERPRINT_DIRS) hashTree(hash, path.join(REPO_ROOT, d));
  return hash.digest("hex");
}

function readFingerprint(): string | null {
  return existsSync(FINGERPRINT_FILE) ? readFileSync(FINGERPRINT_FILE, "utf8").trim() : null;
}

async function canReuseStack(token: string): Promise<boolean> {
  try {
    const envPath = path.join(REPO_ROOT, ".env");
    const statePath = path.join(import.meta.dirname, ".keycloak-state.json");
    if (!existsSync(envPath) || !existsSync(statePath)) return false;
    // An .env from before the shortened host grace: rebuild from scratch once.
    if (!readFileSync(envPath, "utf8").includes("PRESENT_HOST_GRACE_SECONDS=")) return false;
    // An .env from before hints (spec 020): rebuild once so the api gets HINTS_LLM_*.
    if (!readFileSync(envPath, "utf8").includes("HINTS_LLM_BASE_URL=")) return false;
    const envSecret = /^OIDC_CLIENT_SECRET=(.*)$/m.exec(readFileSync(envPath, "utf8"))?.[1];
    const client = await clientUuid(token);
    const current = (await (await adminFetch(token, `/clients/${client}/client-secret`)).json()) as {
      value: string;
    };
    if (!envSecret || current.value !== envSecret) return false;
    for (const username of Object.keys(TEST_USERS)) {
      const found = (await (await adminFetch(token, `/users?username=${username}&exact=true`)).json()) as unknown[];
      if (found.length === 0) return false;
    }
    const state = JSON.parse(readFileSync(statePath, "utf8")) as KeycloakState;
    if (!Object.keys(TEST_USERS).every((u) => state.users[u])) return false;
    return (await fetch("http://127.0.0.1:8000/api/me")).ok;
  } catch {
    return false;
  }
}

/** `down -v` needs the compose file's required variables, which .env may no longer hold. */
function downStack(): void {
  const placeholders = Object.fromEntries(
    ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "DATABASE_URL", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "SESSION_COOKIE_KEY"].map((k) => [k, "x"]),
  );
  execFileSync("docker", ["compose", "-f", "docker-compose.yml", "down", "-v"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...placeholders, ...process.env },
  });
}

function compose(...args: string[]): void {
  execFileSync("docker", ["compose", "-f", "docker-compose.yml", ...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

export default async function globalSetup(): Promise<void> {
  if (!ADMIN_PASSWORD) {
    throw new Error("set TEST_KEYCLOAK_ADMIN_PASSWORD (the running test Keycloak's admin password)");
  }
  const token = await adminToken();
  const keep = process.env.PW_KEEP_STACK === "1";
  let skipBuild = false;
  if (!keep && existsSync(FINGERPRINT_FILE)) {
    // A plain run after a PW_KEEP_STACK run: the kept db volume holds the old password.
    downStack();
    rmSync(FINGERPRINT_FILE, { force: true });
  }
  if (keep) {
    const fingerprint = composeFingerprint();
    const unchanged = readFingerprint() === fingerprint;
    if (await canReuseStack(token)) {
      if (!unchanged) {
        compose("build", "sandbox");
        compose("up", "-d", "--build", "--wait");
        writeFileSync(FINGERPRINT_FILE, fingerprint);
      }
      await waitForApi();
      return;
    }
    // Cannot reuse: rotation below would desync the db volume password and the api's secret.
    downStack();
    skipBuild = unchanged;
    writeFileSync(FINGERPRINT_FILE, fingerprint);
  }
  const clientSecret = await rotateClientSecret(token);
  const users: KeycloakState["users"] = {};
  for (const [username, roles] of Object.entries(TEST_USERS)) {
    const password = randomToken();
    await createUser(token, username, password);
    users[username] = { username, password, roles };
  }

  const state: KeycloakState = {
    issuer: `${KEYCLOAK_URL}/realms/${REALM}`,
    clientId: CLIENT_ID,
    users,
  };
  writeFileSync(path.join(import.meta.dirname, ".keycloak-state.json"), JSON.stringify(state));

  // From inside the api container, the test Keycloak (on the host) is reached via
  // host.docker.internal, not 127.0.0.1.
  const issuerForApi = state.issuer.replace("127.0.0.1", "host.docker.internal");
  const dbPassword = randomToken();
  const env = [
    `POSTGRES_USER=postgres`,
    `POSTGRES_PASSWORD=${dbPassword}`,
    `POSTGRES_DB=collab`,
    `DATABASE_URL=postgresql://postgres:${dbPassword}@db:5432/collab`,
    `OIDC_ISSUER=${issuerForApi}`,
    `OIDC_CLIENT_ID=${CLIENT_ID}`,
    `OIDC_CLIENT_SECRET=${clientSecret}`,
    `ROLE_EDITOR=editor`,
    `ROLE_ADMIN=admin`,
    `SESSION_COOKIE_KEY=${randomToken()}`,
    `RUNNER_URL=http://runner:8080`,
    `SANDBOX_IMAGE=collab-sandbox:e2e`,
    `SANDBOX_RUNTIME=`,
    // Spec 007: docker-compose.test.yml's fake GIPHY, on the host. The key is a dummy.
    // Present host grace: 10 s instead of 60 s; present-hosting.spec.ts reads it back from .env.
    `PRESENT_HOST_GRACE_SECONDS=10`,
    `GIPHY_API_KEY=test-key-not-secret`,
    `GIPHY_BASE_URL=http://host.docker.internal:${process.env.TEST_GIPHY_PORT ?? "58280"}`,
    // Spec 020: docker-compose.test.yml's fake model, on the host. Short timeouts so the
    // slow and cold cases finish fast; the cold deadline stays at its code default.
    `HINTS_LLM_BASE_URL=http://host.docker.internal:${process.env.TEST_LLM_PORT ?? "58380"}/v1`,
    `HINTS_LLM_MODEL=fake-model`,
    `HINTS_LLM_TIMEOUT_SECONDS=3`,
    `HINTS_LLM_COLD_TIMEOUT_SECONDS=6`,
    "",
  ].join("\n");
  writeFileSync(path.join(REPO_ROOT, ".env"), env);

  // `sandbox` is excluded from the default profile (it only builds and tags an image,
  // it is never started), so build it explicitly before `up --wait`.
  if (!skipBuild) compose("build", "sandbox");
  compose("up", "-d", ...(skipBuild ? [] : ["--build"]), "--wait");

  await waitForApi();
}

async function waitForApi(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8000/api/me");
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("api did not become ready at http://127.0.0.1:8000 within 60s");
}
