import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { BrandLogo } from "../brand/BrandLogo";
import { AccountControl } from "../components/AccountControl";
import { AREAS, currentArea } from "../components/AreaNav";
import { AppearanceToggle } from "./AppearanceToggle";
import { Tabs } from "./Tabs";
import { Toolbar } from "./Toolbar";
import "./appHeader.css";

/**
 * The one header of every screen (spec 015 FR-6, FR-7, FR-11): logo and app name, the area
 * tabs, the screen's own controls (`children`, in the toolbar's arrow-key stop), then the
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
  const navigate = useNavigate();
  const current = currentArea(useLocation().pathname);

  return (
    <div className="app-header">
      <BrandLogo appName={appName} />
      <Tabs
        label="Areas"
        tabs={AREAS.map((a) => ({ id: a.to, label: a.title }))}
        value={current}
        onChange={(to) => navigate(to)}
      />
      <Toolbar label={label} variant="bare">
        {children}
        <span className="app-header-spacer" />
        <AppearanceToggle />
        <AccountControl />
      </Toolbar>
    </div>
  );
}
