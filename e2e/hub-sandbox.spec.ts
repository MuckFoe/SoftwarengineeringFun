// Spec 005 FR6 / Isolation NFR on the local hub stand-in (scripts/check-hub.sh, HUB=1): a
// participant's solution, run in the sandbox on the hub's Docker, can open no connection to
// this app's api or to the hub's identity provider, by name or by address.
import { execFileSync } from "node:child_process";
import { REPO_ROOT, appUrl, createSession, expect, stackCompose, test } from "./fixtures";

/** The api container's address on the hub network, so the check doesn't rest on DNS alone. */
function apiAddress(): string {
  const id = execFileSync("docker", [...stackCompose(), "ps", "-q", "api"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  }).trim();
  const address = execFileSync(
    "docker",
    ["inspect", "-f", "{{(index .NetworkSettings.Networks \"hub\").IPAddress}}", id],
    { encoding: "utf-8" },
  ).trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) throw new Error(`no hub address for api: ${address}`);
  return address;
}

function solution(targets: Array<[string, number]>): string {
  return [
    "import socket",
    "",
    "def add(a: int, b: int) -> int:",
    "    seen = []",
    `    for host, port in ${JSON.stringify(targets)}:`,
    "        try:",
    "            socket.create_connection((host, port), timeout=3).close()",
    "            seen.append(f'{host}:{port} CONNECTED')",
    "        except OSError as e:",
    "            seen.append(f'{host}:{port} refused {type(e).__name__}')",
    "    raise RuntimeError('; '.join(seen))",
    "",
  ].join("\n");
}

test("FR6 / Isolation: a solution's sockets to collab-api and auth fail to connect", async ({
  page,
  request,
}) => {
  const targets: Array<[string, number]> = [
    ["collab-api", 8000],
    ["auth", 8080],
    [apiAddress(), 8000],
  ];
  const invite = await createSession(request);
  await page.goto(appUrl(`/s/${invite}`));
  await page.getByLabel("Your name").fill("Mallory");
  await page.getByRole("button", { name: "Join" }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("pass");

  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(solution(targets));
  await expect(editor).toContainText("socket.create_connection");
  await page.getByRole("toolbar", { name: "Session" }).getByRole("button", { name: "Run", exact: true }).click();

  const result = page.getByRole("region", { name: "Run results" }).getByText(/^Test 1: /);
  await expect(result).toBeVisible({ timeout: 30_000 });
  const output = (await page.getByRole("region", { name: "Run results" }).textContent()) ?? "";
  for (const [host, port] of targets) expect(output).toContain(`${host}:${port} refused`);
  expect(output).not.toContain("CONNECTED");
});
