import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "../auth/useMe";
import { apiPath } from "../base";
import { AccountControl } from "../components/AccountControl";
import { AppearanceControl } from "../components/AppearanceControl";
import { AreaNav } from "../components/AreaNav";
import { StaleSessionsList } from "../components/StaleSessionsList";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { Sidebar } from "../ui/Sidebar";
import { Toolbar } from "../ui/Toolbar";
import { Window } from "../ui/Window";
import styles from "./LearnWindow.module.css";

/** `GET /api/learn/topics` (plan.md REST): current lessons, in folder order. */
interface LessonSummary {
  key: string;
  title: string;
  summary: string;
  step_count: number;
  minutes: number;
}

interface Topic {
  key: string;
  title: string;
  lessons: LessonSummary[];
}

async function learnRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(apiPath(path), init);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return (await res.json()) as T;
}

const steps = (n: number) => `${n} ${n === 1 ? "step" : "steps"}`;

/**
 * The Learn window (FR-2, FR-6): topics and their lessons, each with a *Start session*
 * that opens a new learning session. Admins also see the stale learning sessions (FR-27).
 */
export function LearnWindow() {
  const navigate = useNavigate();
  const me = useMe();
  const isAdmin = me.status === "ready" && me.me.roles.includes("admin");

  const [topics, setTopics] = useState<Topic[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    learnRequest<Topic[]>("GET", "/learn/topics").then(
      (found) => {
        if (!current) return;
        setTopics(found);
        setError(null);
      },
      () => {
        if (current) setError("Could not load lessons.");
      },
    );
    return () => {
      current = false;
    };
  }, []);

  async function start(lessonKey: string) {
    try {
      const { invite_id } = await learnRequest<{ invite_id: string }>("POST", "/learn/sessions", {
        lesson_key: lessonKey,
      });
      navigate(`/learn/s/${encodeURIComponent(invite_id)}`);
    } catch {
      setError("Could not start a session.");
    }
  }

  return (
    <Window
      sidebarOpen={sidebarOpen}
      sidebar={
        <Sidebar label="Sidebar">
          <AreaNav />
          {isAdmin && (
            <StaleSessionsList endpoint="/api/learn/sessions/stale" sessionPath="/learn/s/" />
          )}
        </Sidebar>
      }
      toolbar={
        <Toolbar label="Learn">
          <Button
            variant="plain"
            icon="sidebar"
            label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          />
          <h1 className={styles.title}>Learn</h1>
          <span className={styles.spacer} />
          <AppearanceControl />
          <AccountControl />
        </Toolbar>
      }
    >
      <div className={styles.content}>
        {error && <InlineMessage id="learn-error">{error}</InlineMessage>}
        {topics.map((topic) => (
          <section key={topic.key} className={styles.topic} aria-labelledby={`topic-${topic.key}`}>
            <h2 id={`topic-${topic.key}`} className={styles.topicTitle}>
              {topic.title}
            </h2>
            <ul className={styles.lessons}>
              {topic.lessons.map((lesson) => (
                <li key={lesson.key} className="anim-row-in">
                  <article className={styles.lesson} aria-labelledby={`lesson-${lesson.key}`}>
                    <div className={styles.text}>
                      <h3 id={`lesson-${lesson.key}`} className={styles.lessonTitle}>
                        {lesson.title}
                      </h3>
                      <p className={styles.summary}>{lesson.summary}</p>
                      <p className={styles.meta}>
                        {steps(lesson.step_count)} · {lesson.minutes} min
                      </p>
                    </div>
                    <Button
                      variant="bordered"
                      label={`Start session: ${lesson.title}`}
                      onClick={() => void start(lesson.key)}
                    >
                      Start session
                    </Button>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Window>
  );
}
