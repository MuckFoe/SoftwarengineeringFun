// Spec 006 AC-30 (NFR-3) on the local hub stand-in (scripts/check-hub.sh, HUB=1): with three
// learning sessions of 5 participants each in progress, the app stays within its 1 GB budget
// and no container or process is started per learner.
//
// Memory is read the way deploy/hub/smoke.sh --sample-memory reads it on the hub: `docker
// stats` over every container of compose project `collab` plus every sandbox the runner
// started (label collab-coding.runner), summed per sample. Processes are `docker top` on the
// api container (the app; it has no healthcheck, so nothing else execs into it). Both come
// from the Docker the stack runs on, as hub-sandbox and hub-lifecycle reach it.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { REPO_ROOT, appUrl, expect, stackCompose, test } from "./fixtures";

const run = promisify(execFile);

const LESSON_KEY = "01-docker/01-basics";
const SESSIONS = 3;
const PARTICIPANTS = 5;
const BUDGET_MIB = 1024;
const SAMPLES = 5;
// runner/service.py CONTAINER_LABEL, as deploy/hub/smoke.sh filters sandboxes.
const SANDBOX_LABEL = "collab-coding.runner";
// lessons/01-docker/01-basics/lesson.toml: step 0 explanation, step 1 quiz (correct = [1, 3],
// 0-based on the wire), step 2 terminal.
const QUIZ_ANSWER = [0, 2];
const TERMINAL_COMMAND = "docker run -d --name web nginx";

test.describe.configure({ timeout: 3 * 60_000 });

type Frame = { type: string; [key: string]: unknown };
type Outline = { steps: Array<{ position: number; kind: string }> };
type Welcome = Frame & { record: { current_step: number; lesson: Outline } };

/** One participant's socket: every frame it received, and a wait for the next matching one. */
class Learner {
  private readonly frames: Frame[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed: { code: number } | null = null;
  welcome: Welcome | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.frames.push(JSON.parse(String(event.data)) as Frame);
      this.wake();
    });
    socket.addEventListener("close", (event) => {
      this.closed = { code: event.code };
      this.wake();
    });
  }

  static async join(url: string, name: string): Promise<Learner> {
    const socket = new WebSocket(`${url}?name=${encodeURIComponent(name)}`);
    const learner = new Learner(socket);
    learner.welcome = (await learner.next((f) => f.type === "welcome")) as Welcome;
    return learner;
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  /** The first frame received so far, or later, that matches; consumed so it's seen once. */
  async next(match: (frame: Frame) => boolean, timeout = 15_000): Promise<Frame> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const index = this.frames.findIndex(match);
      if (index >= 0) return this.frames.splice(index, 1)[0] as Frame;
      if (this.closed) throw new Error(`socket closed (${this.closed.code}) before the frame`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out waiting for a frame");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  send(frame: Frame): void {
    this.socket.send(JSON.stringify(frame));
  }

  close(): void {
    this.socket.close();
  }
}

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run("docker", args, { cwd: REPO_ROOT, timeout: 60_000 });
  return stdout.trim();
}

const lines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");

/** smoke.sh's to_mib: "45.3MiB" → 45.3 */
function toMib(usage: string): number {
  const match = /^([\d.]+)\s*([A-Za-z]*)$/.exec(usage.trim());
  if (!match) throw new Error(`unexpected docker stats memory ${usage}`);
  const value = Number(match[1]);
  const factor: Record<string, number> = {
    B: 1 / 1048576,
    KiB: 1 / 1024,
    kB: 1 / 1024,
    MiB: 1,
    MB: 1,
    GiB: 1024,
    GB: 1024,
  };
  const f = factor[match[2] ?? ""];
  if (f === undefined) throw new Error(`unexpected docker stats unit in ${usage}`);
  return value * f;
}

/** The containers smoke.sh samples: project collab's, plus every running sandbox. */
async function appContainers(): Promise<string[]> {
  const project = lines(
    await docker("ps", "-q", "--filter", "label=com.docker.compose.project=collab"),
  );
  const sandboxes = await sandboxContainers();
  return [...new Set([...project, ...sandboxes])];
}

async function sandboxContainers(): Promise<string[]> {
  return lines(await docker("ps", "-q", "--filter", `label=${SANDBOX_LABEL}`));
}

/** One smoke.sh sample: the app's containers' memory, summed, in MiB. */
async function appMemoryMib(): Promise<number> {
  const ids = await appContainers();
  if (ids.length === 0) throw new Error("no collab containers to sample");
  const usages = lines(await docker("stats", "--no-stream", "--format", "{{.MemUsage}}", ...ids));
  return usages.map((usage) => toMib(usage.split("/")[0] ?? "")).reduce((a, b) => a + b, 0);
}

/** Every container running on the stack's Docker, the hub's own and other apps' included. */
async function allContainers(): Promise<number> {
  return lines(await docker("ps", "-q")).length;
}

async function apiContainer(): Promise<string> {
  const id = await run("docker", [...stackCompose(), "ps", "-q", "api"], { cwd: REPO_ROOT });
  const trimmed = id.stdout.trim();
  if (!trimmed) throw new Error("no api container");
  return trimmed;
}

/** Processes in the api container, from `docker top` (minus its header line). */
async function apiProcesses(id: string): Promise<number> {
  return lines(await docker("top", id)).length - 1;
}

/** ws(s)://…/collab/api/learn/sessions/{invite}/ws from the hub's baseURL. */
function socketUrl(baseURL: string, invite: string): string {
  const url = new URL(appUrl(`/api/learn/sessions/${invite}/ws`), baseURL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** Takes the session from its welcome to the terminal step; returns that step's position. */
async function toTerminalStep(lead: Learner, welcome: Welcome, all: Learner[]): Promise<number> {
  const steps = welcome.record.lesson.steps;
  let step = welcome.record.current_step;
  for (;;) {
    const kind = steps[step]?.kind;
    if (kind === "terminal") return step;
    if (kind === "explanation") lead.send({ type: "continue", step });
    else if (kind === "quiz") lead.send({ type: "submit_choice", step, selected: QUIZ_ANSWER });
    else
      throw new Error(`step ${step} of ${LESSON_KEY} is ${kind}, not the lesson this spec drives`);
    const passing = step;
    await Promise.all(
      all.map((l) => l.next((f) => f.type === "step_passed" && f.step === passing)),
    );
    step += 1;
  }
}

test("AC-30 (NFR-3): three learning sessions of 5 stay within 1 GB, with no container or process per learner", async ({
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("no baseURL");
  const api = await apiContainer();
  const containersBefore = await allContainers();
  const processesBefore = await apiProcesses(api);
  expect(await sandboxContainers()).toEqual([]);

  const learners: Learner[] = [];
  try {
    for (let s = 0; s < SESSIONS; s++) {
      const started = await request.post(appUrl("/api/learn/sessions"), {
        data: { lesson_key: LESSON_KEY },
      });
      expect(started.status()).toBe(201);
      const { invite_id: invite } = (await started.json()) as { invite_id: string };
      const url = socketUrl(baseURL, invite);

      const session: Learner[] = [];
      for (let p = 0; p < PARTICIPANTS; p++) {
        const learner = await Learner.join(url, `S${s + 1} learner ${p + 1}`);
        session.push(learner);
        learners.push(learner);
      }
      // Everyone sees the full room of 5.
      for (const learner of session) {
        await learner.next(
          (f) =>
            f.type === "presence" &&
            Array.isArray(f.participants) &&
            f.participants.length === PARTICIPANTS,
        );
      }
      const lead = session[0];
      if (!lead?.welcome) throw new Error("no lead learner");
      const terminal = await toTerminalStep(lead, lead.welcome, session);

      // Every participant types a command on the simulated terminal; everyone sees each attempt.
      for (const learner of session) {
        learner.send({ type: "submit_command", step: terminal, command: "docker ps" });
        for (const other of session) {
          await other.next((f) => f.type === "attempt" && f.step === terminal);
        }
      }
      lead.send({ type: "submit_command", step: terminal, command: TERMINAL_COMMAND });
      await Promise.all(
        session.map((l) => l.next((f) => f.type === "step_passed" && f.step === terminal)),
      );
    }

    // All 15 sockets still open, every session mid-lesson: measure as smoke.sh does.
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i++) samples.push(await appMemoryMib());
    const peak = Math.max(...samples);
    test.info().annotations.push({
      type: "memory",
      description: `peak ${peak.toFixed(1)} MiB over ${samples.length} samples, limit ${BUDGET_MIB} MiB`,
    });
    expect(peak).toBeLessThanOrEqual(BUDGET_MIB);

    // Nothing ran per learner: no sandbox, no new container anywhere, no new api process.
    expect(await sandboxContainers()).toEqual([]);
    expect(await allContainers()).toBe(containersBefore);
    expect(await apiContainer()).toBe(api);
    expect(await apiProcesses(api)).toBe(processesBefore);
  } finally {
    for (const learner of learners) learner.close();
  }
});
