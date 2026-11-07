export interface JumpItem {
  kind: "area" | "session" | "problem";
  id: string;
  label: string;
  to: string;
}

const RANK: Record<JumpItem["kind"], number> = { area: 0, session: 1, problem: 2 };

/**
 * The jump bar's matches (FR-15): case-insensitive substring on the label, areas first, then
 * sessions, then problems, each group keeping the order it came in.
 */
export function filterJump(items: JumpItem[], query: string): JumpItem[] {
  const q = query.trim().toLowerCase();
  const hits = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  return hits
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[a.item.kind] - RANK[b.item.kind] || a.index - b.index)
    .map((x) => x.item);
}
