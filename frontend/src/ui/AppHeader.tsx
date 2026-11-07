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
  children,
}: {
  appName?: string;
  /** Accessible name of the screen's toolbar. */
  label: string;
  children?: ReactNode;
}) {
  const live = useAnyLive();

  return (
    <div className={live ? "app-header is-live" : "app-header"}>
      <BrandLogo appName={appName} />
      <Toolbar label={label} variant="bare">
        {children}
        <span className="app-header-spacer" />
        <JumpBar />
        <AppearanceToggle />
        <AccountControl />
      </Toolbar>
      <div className="app-header-line" aria-hidden="true">
        <span className="app-header-sweep" />
      </div>
    </div>
  );
}
