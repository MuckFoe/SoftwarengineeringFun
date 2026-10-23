interface Props {
  message?: string;
}

/** A generic "not found" page, reused wherever nothing matches (e.g. FR-14). */
export function NotFound({ message = "Page not found" }: Props) {
  return (
    <section>
      <h2>{message}</h2>
    </section>
  );
}
