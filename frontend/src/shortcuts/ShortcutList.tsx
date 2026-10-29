import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { isMac, label } from "./keys";
import { SHORTCUTS } from "./registry";
import styles from "./ShortcutList.module.css";
import { ShortcutScope } from "./useShortcut";

interface Props {
  open: boolean;
  onClose(): void;
}

/** Every shortcut with this platform's keys (FR-19), read from the registry. */
export function ShortcutList({ open, onClose }: Props) {
  const mac = isMac();
  return (
    <Sheet open={open} onClose={onClose} title="Keyboard shortcuts" defaultAction={onClose}>
      <ShortcutScope scope="sheet" />
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Keys</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.id}>
              <td>{s.label}</td>
              <td>
                <kbd className={styles.keys}>{label(mac ? s.mac : s.other, mac)}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.actions}>
        <Button variant="primary" type="submit">
          Done
        </Button>
      </div>
    </Sheet>
  );
}
