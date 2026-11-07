// The GIF search screen through the two matrix checks (shared look checks, keyboard sweep).
// It is the one matrix screen that resets and relies on the fake GIPHY, which gifs.spec.ts and
// gif.spec.ts also reset and switch off, so it runs with them in the playwright config's
// "giphy" project instead of with the parallel matrix specs.
import { SCREENS } from "./matrix";
import { defineKeyboardSweep, defineSharedChecks } from "./matrix-specs";

defineSharedChecks(SCREENS.filter((s) => s.giphy));
defineKeyboardSweep(SCREENS.filter((s) => s.giphy));
