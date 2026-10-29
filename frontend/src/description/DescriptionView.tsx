import styles from "./DescriptionView.module.css";

/**
 * A problem description as the server rendered it (spec 002 FR2, FR3, FR6). The html comes
 * only from the server's renderer, which escapes raw HTML and allows only safe link and
 * image targets, so it is inserted as is: nothing is sanitised on the client.
 */
export function DescriptionView({ html }: { html: string }) {
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered Markdown with raw HTML disabled and URLs filtered (spec 002 plan, Descriptions — Rendering).
    <div className={styles.view} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
