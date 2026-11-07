export interface Greeting {
  salutation: string;
  summary: string;
}

export interface NamedUser {
  first_name?: string | null;
  display_name?: string | null;
  username: string;
}

/** First name, else display name, else username. */
export function displayName(user: NamedUser): string {
  return user.first_name || user.display_name || user.username;
}

function timeOfDay(hour: number): string {
  if (hour >= 5 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 17) return "afternoon";
  return "evening";
}

export function greetingFor(now: Date, name: string, liveCount: number | null): Greeting {
  const salutation = `Good ${timeOfDay(now.getHours())}, ${name}`;
  let summary = "Nobody is live right now";
  if (liveCount !== null && liveCount >= 1) {
    summary =
      liveCount === 1 ? "1 person is coding right now" : `${liveCount} people are coding right now`;
  }
  return { salutation, summary };
}
