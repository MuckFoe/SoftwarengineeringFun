# Research: an Audi-inspired UI concept, with the Nuvolari as design input

Status: research notes, not a spec. Nothing here is approved. If we pursue it, it goes through
`/sdd-specify` first (WHAT/WHY), and tokens and components belong in a plan, not here.

## Scope and how reliable this is

- **Asked:** look at Audi's UI design language (the `styleguide.audi.com` "UI Introduction" document,
  `/document/2865`) and use the Nuvolari car as a design input.
- **The styleguide page could not be read.** It is a Frontify single-page app: a plain HTTP fetch
  returns only an empty shell (title "Introduction - User Interface (SP)", no body). The matching
  public pages under `audi.com/ci/en/guides/user-interface/...` returned 404 to a scripted fetch.
  Everything below comes from web-search excerpts of those pages plus third-party coverage.
  **Open the styleguide in a browser before relying on any detail marked "unverified".**
- Colour hex values were not obtainable from any source I trust. None are given here.

## What Audi's UI guidance says (from search excerpts of the official pages)

| Point | Source | Confidence |
|---|---|---|
| UI components exist to guide users through an app, give visual orientation between two views, and give feedback on interaction. | UI Introduction (audi.com/ci) | Excerpt of official page |
| A UI Kit and icons are published for Figma; changes are documented in a changelog. | UI Introduction | Excerpt of official page |
| Experience principle "contrast and reduction": as few divisions as possible; variety comes from flexible arrangement, not extra chrome. | Experience Principles | Excerpt of official page |
| A consistent set of familiar components strengthens recognition and brand loyalty. | Experience Principles | Excerpt of official page |
| Theming starts from the user ("the user is our benchmark"); themes shape the UI around user behaviour. | Theming | Excerpt of official page |
| Elevations establish clear hierarchy and help the user find their way. | Theming | Excerpt of official page |
| Layouts: clearly structured, concise, reduced to essentials, never fragmented; type and icons stay legible at all times. | Audi brand guide (communication media) | Excerpt of official page |
| Icons come in two sizes, 24 px and 48 px, black or white. | Brand guide | Excerpt of official page |
| Palette is restrained: black, white, one red accent used sparingly; a light "tron" blue exists for electric/clean-energy messaging. | Third-party summaries | Unverified |
| Typeface is the proprietary neo-grotesque Audi Type (cuts include Screen and Extended), not publicly licensed. Inter is the usual free stand-in. | Third-party summaries | Unverified |
| Web, app and in-car share one language: rounded buttons, smooth transitions, generous negative space. | Third-party commentary | Unverified |

## The Nuvolari as a design input

"Nuvolari" is two different cars. The concept to pick matters, so decide before designing.

**2003 Nuvolari quattro (Geneva concept, named for racing driver Tazio Nuvolari).**
- Presented as a preview of Audi's exterior and interior direction; two-door 2+2 GT coupe,
  classic proportions, "evolutionary" take on Audi styling.
- Aluminium Audi Space Frame; one of the first cars shown with LED headlights; keyless entry and a
  fingerprint-opened glove box.
- Design reading: a *human-scale, tactile, grand-touring* mood. Technology present but quiet.

**2026 Nuvolari (production hypercar, built from Audi Concept C).**
- First production Audi in the new design language of design chief Massimo Frascella.
- Slab-sided, simple surfaces; a stark, upright grille that may become Audi's new face.
- New signature paint **Titanium** (shared with Concept C and the Audi F1 car).
- Mostly carbon fibre over a spaceframe; front splitter, intakes, vented nose and rear diffuser
  work as one aero system; carbon-ceramic brakes, "quattro predictive ride".
- Design reading: *reduced, monolithic, functional*. Every visible element has a job, and the
  surface is calm.

Spec and performance figures differ between sources, so none are quoted here. For the 2026 car use
Audi MediaCenter and Car Magazine as the reference, not aggregator sites.

## Where the car and the UI guidance line up

The 2026 car and Audi's "contrast and reduction" principle say the same thing in different
materials. That alignment is the useful design input:

| Car trait | UI translation to explore |
|---|---|
| Single monolithic, slab-sided surfaces | Few, large panels; fewer borders and dividers; separate regions by tone and elevation, not lines |
| Aero parts that are visible because they work | Chrome only where it carries function (run, session state); nothing purely decorative |
| Titanium: a cool, metallic neutral | A graphite/titanium neutral ramp for surfaces, with one accent; test it against our existing theme tokens |
| One stark grille as the "face" | One strong identity element per screen (the editor), everything else recedes |
| Predictive ride, F1 telemetry | Status that is live and quiet: the run output and session state update in place with no modal interruptions (fits spec 011's live panel) |
| 2003 car: tactile, human, GT-calm | Generous spacing, unhurried motion, legible type at all sizes |

## What this would mean in this repo

- **Where it lands:** theme tokens and component styling in `frontend/` and `keycloak-theme/`.
  `scripts/check-theme-tokens.sh` requires the Keycloak theme tokens to match the app's, so any
  palette change must change both together.
- **No brand assets.** We already enforce "no Apple assets"; the same discipline applies to Audi.
  Do not ship Audi logos, the four rings, or the Audi Type font files. Reference fonts by family
  name only, with a free fallback (Inter). "Inspired by" a design language is fine; presenting the
  product as Audi's is not. Confirm trademark and licence terms for the styleguide before reuse,
  since it is Audi-internal tooling by the look of the URL.
- **Accessibility holds the line.** Spec 003 sets WCAG AA; a dark, low-contrast titanium palette
  must still pass it, including the stderr colour-plus-marker rule in spec 011.
- **Size.** This is a cross-cutting re-theme, so it should be its own feature spec (one folder, not
  folded into an existing one), with a visual-regression or screenshot approach decided in the plan.

## Decisions (from the user, 2026-11-06)

1. **Design input: the 2026 Nuvolari hypercar** (reduced, monolithic, functional).
2. **Scope: a full re-theme**, not an optional theme beside the current one.
3. **Reuse of the Audi styleguide is allowed.**
4. **Sources are now read.** The styleguide was read with Playwright
   (`audi-styleguide-notes.md`) and the Figma kit was decoded
   (`audi-figma-kit-tokens.md`), so the "unverified" markers above are superseded by those files.

## What the real sources say (summary)

- **Shape:** square corners by default (radius 0; 2/4/8 exist, 999 for pills). 1 px borders,
  2 px active, 4 px focus. Inputs are underline-style, not boxed. Matches the car's slab-sided
  surfaces.
- **Colour:** white, black and one red. Neutrals are a grey ramp; body text is `#333333` (light)
  / `#E6E6E6` (dark), not pure black or white. Separate light and dark sets exist. Focus blue
  `#0989FF`.
- **Elevation:** expressed by surface tone, not shadow, in dark mode (black up through lighter
  greys). In light mode surfaces are white with `#F2F2F2` at the top levels.
- **Type:** Audi Type Variable (proprietary, wide display cuts). Not usable here; Inter is the
  fallback, so the wide, sharp look must come from scale, weight and spacing.
- **Motion:** one published easing, `cubic-bezier(0.75, 0.02, 0.5, 1)`; no durations published.
- **Components:** buttons 32/48/56 px high; tabs, nav bar, card, dialog, select, checkbox, radio,
  toggle all catalogued in the Figma note.
- **Icons:** 1 px contour, 16/24/48 sizes. The icon artwork is Audi's; use our own or an open set
  drawn to the same rules, never the Audi files.

## Conflicts between the sources (resolve in the spec)

| Item | Styleguide page (screenshot) | Figma Web variables |
|---|---|---|
| Red | Progressive Red `#F50537` | `#EB0D3F` light / `#FD2C4E` dark |
| Dark elevation L2 | `#262626` | `#333333` |
| Dark elevation top | L3 `#333333` | L4 `#666666` |
| Breakpoint L/XL | L ends 1339, XL starts 1440 (probable typo) | 320 to 1920 scale |

Prefer the Figma `Web` variables (the machine-readable, current source) and check each red and
grey against WCAG AA on our real surfaces before locking tokens.

## Next step

Write the spec with `/sdd-specify` as its own feature (one folder). It states WHAT and WHY only:
a full Audi-inspired re-theme of the app and the Keycloak login theme, AA contrast kept, no Audi
brand assets, light and dark. The token values above go in `plan.md`, not the spec.

## Sources

- [Audi UI Introduction](https://audi.com/ci/en/guides/user-interface/introduction.html)
- [Experience Principles](https://audi.com/ci/en/guides/user-interface/experience-principles.html)
- [Theming](https://audi.com/ci/en/guides/user-interface/theming.html)
- [Audi design system overview (UXPin)](https://adele.uxpin.com/audi-audi-ui)
- [How Audi's digital-first identity aims to be accessible (Design Week)](https://www.designweek.co.uk/issues/5-11-march-2018/audi-rebrands-taking-digital-first-identity/)
- [Audi Nuvolari quattro (Wikipedia)](https://en.wikipedia.org/wiki/Audi_Nuvolari_quattro)
- [Audi Nuvolari quattro (Audi MediaCenter)](https://www.audi-mediacenter.com/en/audi-nuvolari-quattro-2942/audi-nuvolari-quattro-2951)
- [Audi Nuvolari promises a bright future for Audi design (GTspirit)](https://gtspirit.com/2026/06/04/audi-nuvolari-promises-a-bright-future-for-audi-design/)
- [New Audi Nuvolari hypercar revealed (Car Magazine)](https://www.carmagazine.co.uk/car-news/first-official-pictures/audi/2027-nuvolari/)
- [Audi's Nuvolari hybrid supercar is going into production (Irish Times)](https://www.irishtimes.com/motors/2026/06/05/audis-stunning-nuvolari-hybrid-supercar-is-going-into-production/)
