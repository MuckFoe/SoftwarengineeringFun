import type { ReactNode } from "react";
import { BrandLogo } from "../brand/BrandLogo";
import { AccountControl } from "../components/AccountControl";
import { useAnyLive } from "../pages/useAnyLive";
import { JumpBar } from "../shell/JumpBar";
import { AppearanceToggle } from "./AppearanceToggle";
import { Toolbar } from "./Toolbar";
import "./appHeader.css";

/**
 * The one header of every screen (spec 015 FR-6, FR-7, FR-11): logo and app name, the screen's own
 * controls (`children`, in the toolbar's arrow-key stop), then the
 * appearance toggle and the account entry. 56 px, padded by the page margin.
 */
export function AppHeader({
  appName = "Collab",
  label,
  actions,
  stackNarrow = false,
  children,
}: {
  appName?: string;
  /** Accessible name of the screen's toolbar. */
  label: string;
  /** Screen-specific controls placed right beside the jump bar and appearance toggle. */
  actions?: ReactNode;
  /** At narrow width (about 390 px), put `children` on a second row of their own, as icons:
   * for screens with more controls than fit beside the logo and account. */
  stackNarrow?: boolean;
  children?: ReactNode;
}) {
  const live = useAnyLive();

  return (
    <div
      className={["app-header", live && "is-live", stackNarrow && "is-stacked"]
        .filter(Boolean)
        .join(" ")}
    >
      <BrandLogo appName={appName} />
      <Toolbar label={label} variant="bare">
        <div className="app-header-start">{children}</div>
        <span className="app-header-spacer" />
        <JumpBar />
        <span className="app-header-spacer" />
        <div className="app-header-end">
          {actions}
          <AppearanceToggle />
          <AccountControl />
        </div>
      </Toolbar>
      <div className="app-header-line" aria-hidden="true">
        <span className="app-header-sweep" />
      </div>
    </div>
  );
}
