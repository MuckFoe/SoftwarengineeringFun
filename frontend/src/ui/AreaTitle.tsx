import { DOCK_ITEMS } from "./Dock";
import { Icon, type IconName } from "./Icon";
import "./appHeader.css";

const ICONS: Record<string, IconName> = {
  ...Object.fromEntries(DOCK_ITEMS.map((item) => [item.label, item.icon])),
  Profile: "person",
};

/**
 * A screen's title in the header, shown as its area's icon (the same one the dock uses). The
 * title stays the heading's accessible name and shows as a tooltip.
 */
export function AreaTitle({ title, icon }: { title: string; icon?: IconName }) {
  const name = icon ?? ICONS[title] ?? "doc";
  return (
    <h1 className="app-header-area" title={title}>
      <Icon name={name} size={20} />
      <span className="app-header-area-text">{title}</span>
    </h1>
  );
}
