/// <reference lib="dom" />
// Spec 015 task 36 (Accessibility NFR): tab through every focusable element on each FR-5 screen
// and assert the focused element itself shows a visible indicator: a non-none box-shadow or
// a real outline.
import { SCREENS } from "./matrix";
import { defineKeyboardSweep } from "./matrix-specs";

defineKeyboardSweep(SCREENS.filter((s) => !s.giphy));
