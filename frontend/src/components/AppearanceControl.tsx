import { useState } from "react";
import { useShortcut } from "../shortcuts/useShortcut";
import type { Choice } from "../theme/appearance";
import { useAppearance } from "../theme/useAppearance";
import { Popover } from "../ui/Popover";
import { SegmentedControl } from "../ui/SegmentedControl";

const OPTIONS: { value: Choice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * The toolbar's appearance setting (FR-6): Light, Dark or System, applied at once and kept
 * in this browser. The appearance shortcut (⌘, / Ctrl+,) opens it.
 */
export function AppearanceControl() {
  const { choice, resolved, setChoice } = useAppearance();
  const [open, setOpen] = useState(false);
  useShortcut("appearance", () => setOpen(true));

  return (
    <Popover
      label="Appearance"
      icon={resolved === "dark" ? "moon" : "sun"}
      open={open}
      onOpenChange={setOpen}
    >
      <SegmentedControl label="Appearance" value={choice} onChange={setChoice} options={OPTIONS} />
    </Popover>
  );
}
