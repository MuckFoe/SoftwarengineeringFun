// Brings up the production stack (docker-compose.yml) against the test Keycloak
// (docker-compose.test.yml's `keycloak` service, already running). Mirrors
// backend/tests/integration/keycloak_fixtures.py in TypeScript: rotates the test
// client's secret and creates the test users with random passwords, then writes
// both docker compose's .env and e2e/.keycloak-state.json (read by fixtures.ts).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
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

export default async function globalSetup(): Promise<void> {
  if (!ADMIN_PASSWORD) {
    throw new Error("set TEST_KEYCLOAK_ADMIN_PASSWORD (the running test Keycloak's admin password)");
  }
  const token = await adminToken();
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
    "",
  ].join("\n");
  writeFileSync(path.join(REPO_ROOT, ".env"), env);

  // `sandbox` is excluded from the default profile (it only builds and tags an image,
  // it is never started), so build it explicitly before `up --wait`.
  execFileSync("docker", ["compose", "-f", "docker-compose.yml", "build", "sandbox"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  execFileSync(
    "docker",
    ["compose", "-f", "docker-compose.yml", "up", "-d", "--build", "--wait"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );

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
