import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";

/**
 * The header's brand mark (spec 015 FR-11): the supplied logo, drawn by the `.brand-logo`
 * rule of the served `brand.css` as a CSS mask in the text colour (so it follows light and
 * dark), beside the app name; the whole mark links to the home screen. With no such rule (no logo was obtained) the mark is hidden,
 * so there is no broken image and no gap, and the name stands alone.
 */
export function BrandLogo({ appName }: { appName: string }) {
  const logo = useRef<HTMLSpanElement>(null);
  const [absent, setAbsent] = useState(false);

  useLayoutEffect(() => {
    // Probe a detached-from-layout copy: inside the flex `.brand` the real element is
    // blockified, so its own computed display says "block" even with no rule.
    const probe = document.createElement("span");
    probe.className = "brand-logo";
    probe.hidden = false;
    document.body.append(probe);
    const supplied = getComputedStyle(probe).display === "block";
    probe.remove();
    if (logo.current && !supplied) setAbsent(true);
  }, []);

  return (
    <Link to="/" className="brand" aria-label={`${appName} home`}>
      <span
        ref={logo}
        className="brand-logo"
        role="img"
        aria-label="Audi"
        hidden={absent || undefined}
      />
      <span className="brand-name">{appName}</span>
    </Link>
  );
}
