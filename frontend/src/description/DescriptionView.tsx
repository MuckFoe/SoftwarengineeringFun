import styles from "./DescriptionView.module.css";

/**
 * A problem description as the server rendered it (spec 002 FR2, FR3, FR6). The html comes
 * only from the server's renderer, which escapes raw HTML and allows only safe link and
 * image targets, so it is inserted as is: nothing is sanitised on the client. `dense` is the
 * smaller reading size for a side column (the session inspector).
 */
export function DescriptionView({ html, dense = false }: { html: string; dense?: boolean }) {
  return (
    <div
      className={dense ? `${styles.view} ${styles.dense}` : styles.view}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered Markdown with raw HTML disabled and URLs filtered (spec 002 plan, Descriptions — Rendering).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
