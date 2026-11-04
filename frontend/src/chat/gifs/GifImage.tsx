import { useState } from "react";
import type { GifResult } from "../../api/types";
import styles from "./GifImage.module.css";

/**
 * One GIF, loaded straight from GIPHY's CDN (spec 007). Reduced motion gets the
 * still frame (NFR-6); no referrer leaves with the request, so the invite in the
 * page URL never reaches GIPHY (NFR-1); a failed load becomes a same-size
 * placeholder (FR-12).
 */
export function GifImage({ gif }: { gif: GifResult }) {
  const [failed, setFailed] = useState(false);
  const size = { width: gif.width, height: gif.height };

  if (failed) {
    return (
      <span className={styles.placeholder} style={size}>
        GIF no longer available
      </span>
    );
  }

  return (
    <picture className={styles.picture}>
      <source media="(prefers-reduced-motion: reduce)" srcSet={gif.still_url} />
      {/* referrerPolicy before src: React sets attributes in this order, and a cached image
          can start loading as soon as src is set, with the default policy (NFR-1). */}
      <img
        className={styles.img}
        referrerPolicy="no-referrer"
        src={gif.url}
        alt={gif.title || "GIF"}
        width={gif.width}
        height={gif.height}
        onError={() => setFailed(true)}
      />
    </picture>
  );
}
