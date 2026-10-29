import { EmptyStateWindow } from "./NotFound";

/** A signed-in user without the role a screen needs (FR-2a, FR-13). */
export function Forbidden({ missingRole }: { missingRole: string }) {
  return (
    <EmptyStateWindow icon="person" title="You can't do this">
      You lack the {missingRole} role, so you can't do this.
    </EmptyStateWindow>
  );
}
