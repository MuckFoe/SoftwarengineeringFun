# Audi DS 3.0 Unified Web UI Kit 1.0 and Icons 4.12: design tokens and component inventory

Source (untouched): `261030_Audi_Figma_UI-Kit_and_Icons/` (`DS 3.0 (beta) Audi Unified Web UI Kit 1.0.fig`, `DS3 Audi Icons 4.12.fig`). The user confirmed we may use Audi's styleguide. Repo rule applies: this file records token VALUES and NAMES only. No icon SVGs, logos, fonts or image assets were copied.

## How it was decoded

Both `.fig` files are zips containing a `fig-kiwi` `canvas.fig`. Chunk 1 (kiwi binary schema) is raw deflate; chunk 2 (data message) is zstd. A small hand-written kiwi decoder (scratch only, not in the repo) parsed schema (410 defs for the kit, 671 for icons) and message fully: 71,065 nodes in the kit, 13,394 in the icons file. Nothing failed to decode. Variable aliases (about 1,100 of 1,237 kit variables) were resolved to final values by following alias chains; 0 unresolved.

Caveats:
- Variables whose set is a published library (names like `Cmp/...`, `Sys/...` with no local set) are included in the file as library copies. The local "Web" set is the authoritative one for web (modes `Web-Light`, `Web-Dark`).
- Text styles store a placeholder `fontSize` of 12 and odd letter-spacing numbers (130 or 105 "PIXELS") when size and line-height are bound to variables. Real sizes come from the variables below. Treat the letter-spacing numbers on `heading/*` styles as decoder or binding artefacts, not real tracking; the variable `Sys/LetterSpacing/None` = 0 is the real value. The `Copy/*` and `Button labels/*` styles carry about 0.02 and 0.015 (percent-unit field); exact unit semantics not verified, effectively tracking about 0.
- Component padding and sizes below come from the variant frames' auto-layout properties. Some outer variant frames report hug widths (for example Button SM "180x48" is a demo width), so only heights, paddings and gaps are meaningful.
- Fonts are proprietary: `Audi Type Variable` (also seen as `Audi Type Wide`/`Extended`). Not in this repo and must not be added. Use a system or web fallback stack. The DOC styles use Source Sans Pro / Source Code Pro (documentation only, not product tokens).

## Variables vs styles

| Kind | What it is in this kit |
|---|---|
| Variables (Figma) | 1,237 total. Sets: `Web` (Light/Dark, 537 vars: colour 314, float 216, string 7), `Breakpoints` (XS 320, SM 375, MD 768, LG 1024, XL 1440, 2XL 1920), `App` (Light/Dark), `InCar` (Dark/Light), `Theme`, `Device`, `Doc`, plus library copies. Tiering is `Sys/` (system primitives) -> `Sem/` (semantic) -> `Cmp/` (component). |
| Text styles | 1,902 (many are per-breakpoint/mode duplicates): `heading/{display_1,display_2,order_1..4}/{xs,s,m,l,xl,xxl}/{Regular,Bold}`, `copy_1..3/{Regular,Bold}`, `Copy/Copy 1..3`, `Button labels/*`, `Sem/Typography/*`, `Cmp/Typography/*`, `core/{ExtendedBold,ExtendedNormal,...}/<px>`, `_old.*` (deprecated), `DOC/*`. |
| Effect styles | 76: elevation shadows, action indicator inner-shadows, card shadow. Light and Dark copies. |
| Grid styles | 8: `Utilities/Space XXS..` (spacing overlays, documentation helpers). |
| Fill (colour) styles | about 2,900 fill-style nodes, mostly mirrors of the variable colours (not enumerated separately; the variables are the source of truth). |

## Typography

Family: `Audi Type Variable` for everything (Display, Headline, Copy). Weights are variable-font named instances:

| Token | Value |
|---|---|
| Sys/FontFamilies/AudiFont | Audi Type Variable |
| Sys/FontWeights/Copy/Normal, Copy/Bold | Wide Normal, Wide Bold |
| Sys/FontWeights/Display/*, Headline/* | Extended Normal, Extended Bold |
| Sys/LetterSpacing/None | 0 |

Responsive type scale (variables, `Breakpoints` set), size / line-height in px:

| Role | XS 320 | SM 375 | MD 768 | LG 1024 | XL 1440 | 2XL 1920 |
|---|---|---|---|---|---|---|
| Display 1 | 40 / 60 | 40 / 60 | 48 / 68 | 60 / 84 | 72 / 100 | 84 / 112 |
| Display 2 | 36 / 52 | 36 / 52 | 36 / 52 | 44 / 64 | 52 / 76 | 60 / 84 |
| Headline 1 | 28 / 40 | 28 / 40 | 28 / 40 | 36 / 52 | 40 / 60 | 44 / 64 |
| Headline 2 | 24 / 36 | 24 / 36 | 24 / 36 | 28 / 40 | 32 / 44 | 36 / 52 |
| Headline 3 | 20 / 32 | 20 / 32 | 20 / 32 | 20 / 32 | 24 / 36 | 24 / 36 |
| Headline 4 | 16 / 24 | 16 / 24 | 16 / 24 | 16 / 24 | 18 / 28 | 20 / 32 |

Note: the older `heading/*` text styles carry slightly different line-heights (for example display_1 xl 72 / 100 matches, order_1 xs 28 / 44 vs variable 28 / 40). Prefer the variables.

Copy (fixed, no breakpoints): Copy 1 = 16 / 24 (short 16 / 20), Copy 2 = 12 / 20 (short 12 / 16), Copy 3 = 10 / 16 (short 10 / 12). Weights Wide Normal / Wide Bold.

Component text styles (all Audi Type Variable, Wide Normal unless noted):

| Style | Size / line-height |
|---|---|
| Sem/Typography/Action/SM/Label | 12 / 16 |
| Sem/Typography/Action/MD/Label and LG/Label | 16 / 20 |
| Button labels (Button Label M / S) | 16 / 24 and 12 / 20 |
| Sem/Typography/Forms/Label, Input, Extension | 16 / 20 |
| Sem/Typography/Forms/LabelSmall, Appendix, Caption, Range | 12 / 16 |
| Sem/Typography/Feedback/Label, Range | 12 / 16 |
| Sem/Typography/Feedback/Value, BadgeInfo | 16 / 20 |
| Sem/Typography/Feedback/Headline (Bold), Copy | 12 / 20 |
| Sem/Typography/UI/MD/Label, Navigation/MD/Label | 16 / 20 |
| Sem/Typography/UI/MD/Headline (Bold) | 16 / 24 |
| Sem/Typography/UI/XS/Label | 10 / 12 |
| Navigation/SM/Label | 12 / 16 |
| Cmp/Typography/Navigation/TextLink XS / SM / MD | 10/16, 12/20, 16/24 (Normal and Bold) |

Other primitive font sizes available (`Sys/FontSizes/Relative/*`): 10, 12, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 52, 60, 72, 84. Primitive line heights: 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 60, 64, 68, 76, 84, 100, 112.

## Colour: Web set (variables; Light / Dark)

Audi's web UI is essentially monochrome (black / white / greys) with one red highlight and signal colours. Dark mode swaps the grey ramp.

### Core system colours (`Sys/Color/...`, `Web` set)

| Token | Light | Dark |
|---|---|---|
| Canvas/Default | #FFFFFF | #000000 |
| Canvas/Inverted | #000000 | #FFFFFF |
| Surface/Elevation/Level1 | #FFFFFF | #1A1A1A |
| Surface/Elevation/Level2 | #FFFFFF | #333333 |
| Surface/Elevation/Level3 | #FFFFFF | #4D4D4D |
| Surface/Elevation/Level4 | #F2F2F2 | #666666 |
| Surface/Highlight/Primary (Audi red) | #EB0D3F | #FD2C4E |
| Surface/Highlight/Secondary | #000000 | #FFFFFF |
| Surface/Neutral/100 (strong) | #000000 | #FFFFFF |
| Surface/Neutral/200 | #333333 | #E6E6E6 |
| Surface/Neutral/300 | #666666 | #B3B3B3 |
| Surface/Neutral/400 | #B3B3B3 | #666666 |
| Surface/Neutral/500 (dividers) | #D9D9D9 | #4D4D4D |
| Surface/Neutral/600 | #E6E6E6 | #333333 |
| Surface/Neutral/700 (subtle tint) | #0000000D | #FFFFFF26 |
| Surface/Neutral/800 | #FFFFFF | #000000 |
| Foreground/Neutral/100..800 | same ramp as Surface/Neutral | same |
| Surface/Interactive/Primary/100 (default) | #000000 | #FFFFFF |
| Surface/Interactive/Primary/200 (hover/pressed) | #4D4D4D | #B3B3B3 |
| Surface/Interactive/Primary/300 (disabled) | #B3B3B3 | #666666 |
| Surface/Interactive/Secondary/100 (control stroke) | #666666 | #B3B3B3 |
| Surface/Interactive/Secondary/200 (active) | #000000 | #FFFFFF |
| Surface/Interactive/Secondary/300 (filled) | #333333 | #E6E6E6 |
| Surface/Interactive/Secondary/400 (disabled) | #B3B3B3 | #666666 |
| Surface/Interactive/Tertiary/100 (read-only / pressed fill) | #D9D9D9 | #4D4D4D |
| Surface/Interactive/Tertiary/300 (overlay press) | #0000001A | #FFFFFF33 |
| Foreground/OnHighlight/100 | #FFFFFF | #000000 |
| Foreground/OnSignal/100 | #FFFFFF | #FFFFFF |
| Surface/Scrim/Default | #000000B2 | #000000B2 |
| Surface/Signal/Focus (focus ring) | #0989FF | #0989FF |
| Surface/Signal/Negative (error), Foreground/Signal/Negative | #EB0D3F | #FD2C4E |
| Surface/Signal/Success/100, Foreground/Signal/Positve/100 (sic) | #0DA20D | #15DA15 |
| Surface/Signal/Success/200 (50% alpha) | #0DA20D80 | #15DA1580 |
| Surface/Signal/Pending, Notice | #FFAA00 | #FFAA00 |
| Surface/Signal/Intelligent/Default | #007579 | #13E0C1 |
| Surface/Signal/Charging/NeonBlue | #2526FE | #556EFE |
| Surface/Signal/Charging/NeonGreen | #0DA20D | #15DA15 |
| Surface/Signal/Indicator/{Red, Green, Blue, Yellow, Turquoise} | #FD2C4E, #15DA15, #556EFE, #FFAA00, #13E0C1 | same |

Icons-file colour set (Light/Dark theme, library): grey ramp #FFFFFF, #E5E5E5, #D9D9D9, #CCCCCC, #B3B3B3, #666666, #4C4C4C, #333333, #000000; red #EB0D3F (light) / #FD2C4E (dark); green #0DA20D; yellow #FFAA00; dark card level `#262626`, divider dark `#4C4C4C`. These differ slightly from the web set (E5E5E5 vs E6E6E6, 4C4C4C vs 4D4D4D); use the Web set.

Global/Doc tokens (`Global/Color/*`) mirror the above: Typography Display #000/#FFF, Headline and Copy #333333 / #E6E6E6 (so body text is not pure black in light mode), Elevation/Interactive #D9D9D9 / #4D4D4D, Focus #0989FF.

### Semantic roles (`Sem/Color/...`, 105 vars, all aliases of the above)

| Role | Light | Dark |
|---|---|---|
| Action/Primary: fill (default) / hover, pressed / disabled | #000000 / #4D4D4D / #B3B3B3 | #FFFFFF / #B3B3B3 / #666666 |
| Action/Primary: text and icon (all states) | #FFFFFF | #000000 |
| Action/Secondary: stroke default / hover, pressed / disabled | #000000 / #4D4D4D / #B3B3B3 | #FFFFFF / #B3B3B3 / #666666 |
| Action/Secondary: fill default, hover | transparent | transparent |
| Action/Secondary: fill pressed | #D9D9D9 | #4D4D4D |
| Action/Secondary and Tertiary: text and icon default / hover / disabled | #000000 / #4D4D4D / #B3B3B3 | #FFFFFF / #B3B3B3 / #666666 |
| Action/Tertiary: stroke | transparent | transparent |
| Action/Tertiary: fill pressed | #D9D9D9 | #4D4D4D |
| Forms: control stroke default / interactive / error / disabled / read-only | #666666 / #000000 / #EB0D3F / #B3B3B3 / #D9D9D9 | #B3B3B3 / #FFFFFF / #FD2C4E / #666666 / #4D4D4D |
| Forms: underline stroke default / interactive / error / disabled | #333333 / #000000 / #EB0D3F / #B3B3B3 | #E6E6E6 / #FFFFFF / #FD2C4E / #666666 |
| Forms: text default / caption / interactive / error / disabled | #333333 / #666666 / #000000 / #EB0D3F / #B3B3B3 | #E6E6E6 / #B3B3B3 / #FFFFFF / #FD2C4E / #666666 |
| Forms: read-only fill | #D9D9D9 | #4D4D4D |
| Feedback surface: default / error / success / notice / informative | #FFFFFF / #EB0D3F / #0DA20D / #FFAA00 / #EB0D3F | #000000 / #FD2C4E / #15DA15 / #FFAA00 / #FD2C4E |
| Navigation text/icon: active / idle / disabled | #000000 / #666666 / #B3B3B3 | #FFFFFF / #B3B3B3 / #666666 |
| Navigation: pressed fill | #0000001A | #FFFFFF33 |
| UI divider | #D9D9D9 | #4D4D4D |
| UI stroke default / hover / disabled | #666666 / #000000 / #B3B3B3 | #B3B3B3 / #FFFFFF / #666666 |
| UI text default / interactive / disabled | #333333 / #000000 / #B3B3B3 | #E6E6E6 / #FFFFFF / #666666 |
| UI scrim | #000000B2 | #000000B2 |

`Cmp/Color/*` (126 vars) carry per-component overrides (IconButton, ToggleButton, Slider, Toggle, Tag 27, Avatar 10, ProgressIndicator, Infobox, MediaControl, ExtendedSelection, ProductTile, and so on); mostly the same ramp values.

## Radius, border, opacity

| Token | Value |
|---|---|
| Sys/BorderRadius None / XS / SM / MD / Max | 0 / 2 / 4 / 8 / 999 |
| Sem/BorderRadius Action, Forms, UI: Default | 0 (everything is square by default) |
| Sem/BorderRadius ...Max | 999 (pill/circle, opt-in) |
| Cmp/BorderRadius/UI/Drawer | 8 |
| Sys/BorderWidth 100 / 200 / 300 / Focus | 1 / 2 / 3 / 4 |
| Sem/BorderWidth Action, Forms default, Navigation, UI | 1 |
| Sem/BorderWidth Forms active | 2 |
| Spinner border SM / MD / LG | 1 / 2 / 3 |
| Divider MD / LG thickness | 1 / 2 |
| Sys/Opacity | 0, 20, 70, 90, 100 (percent) |

Radii seen on actual component internals: checkbox control 2, select dropdown 4, radio and toggle switch 999 (circle/pill), slider handle/track 6 and 12, text area input box 0 with 1 stroke. Buttons, inputs, cards, dialogs: 0. Take-away: Audi style is sharp-cornered, flat, hairline-bordered.

## Spacing, size, layout

- Fixed spacing (`Sys/Space/Fixed/*`, name = value x 10 / 8 roughly): 2, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128, 160, 176, 208.
- Relative spacing tokens per breakpoint: 2XS 4, XS 8, SM 12, MD 16, LG 24, XL 28 (32 at XL breakpoint, 40 at 2XL), 2XL 36 to 72, up to 8XL 120 to 248 (grows with breakpoint).
- Size scale (`Sys/Size/Fixed/*`): 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 84, 96, 104, 108, 120, 128, 136, 144, 192, 240, 320.
- Page margins: XS 16, SM 28, MD 40, LG 60, XL 96, 2XL 96. Max content width 1920.
- Breakpoints: 320, 375, 768, 1024, 1440, 1920.
- Icon sizes: SM 16 (XS in icon file), MD 24 (S), XL 48 (L).

## Effect styles (shadows / elevation)

| Style | Layers (x, y, blur, spread, colour) |
|---|---|
| Sys/Elevation/Level1 | 0 2 4 0 #000 @14%; 0 0 2 0 #000 @12% |
| Level2 | 0 4 8 0 #000 @14%; 0 0 2 0 #000 @12% |
| Level3 | 0 8 16 0 #000 @14%; 0 0 2 0 #000 @12% |
| Level4 | 0 12 24 0 #000 @16%; 0 0 6 0 #000 @12% |
| Background/Card | 0 1 2 0 #000 @10%; 0 2 6 0 #000 @20% |
| Divider Top | 0 4 4 0 #000 @25% (two identical layers) |
| Action/ShadowIndicator (focus-like double ring, inner) | spread 4 white + spread 2 inner ring: Rest #000000, Hover and Pressed #4D4D4D, Disabled #B3B3B3 |

Light and Dark styles are identical drop shadows; in Dark mode elevation is mostly expressed through the lighter surface colours (Level1 #1A1A1A up to Level4 #666666) rather than shadow.

## Component specs (from variants)

Variant axes noted where relevant. All text is Audi Type Variable Wide.

| Component | Key measurements |
|---|---|
| Button | Sizes XS / SM / MD / LG. Emphasis Primary (filled black), Secondary (1px outline), Tertiary (text only). States Idle, Hover, Pressed, Focus, Disabled, Loading. Min height XS 32, SM 48, MD 56; content gap XS 8, SM 12, MD 12; SM padding 24 h x 12 v (label 12/16), MD padding 32 h x 16 v (label 16/20); icon slot 24x24; radius 0. Icon button sizes XS 32, SM 48, MD 56, LG 120 (with label width 64 / 80 / 80). |
| Button Group, Toggle Button, Toggle Button Group | Same size family (32 / 48 / 56). |
| Text Input | Underline style, not boxed: field row 56 high (20 top padding), 2px underline, caption row 20 to 28 (12 top padding, 12/16 caption text), label and extension gap 8. States Idle, Hover, Focus, ReadOnly, Disabled; Error and FocusVisible flags. Width demo 340. |
| Text Area | Boxed: 1px stroke, padding 12 all round, label 16/20 plus appendix 12/16, caption row 28, character counter, resize handle 12x12. |
| Select Field | Underline style like text input (56 high row, 2px underline, 20 top padding, icon gap 12), dropdown panel option radius 4; error row gap 4 with 16px icon. |
| Checkbox | 20x20 control (radius 2), label gap 12, caption padding-left 32, row stack gap 8. |
| Radio Button | circle (radius 999), control box 32 at LG, indicator 16 on / 1 off; content row gap 16. |
| Toggle Switch | track 56x32 pill (999), label gap 12, caption indented 64. |
| Search Field, Slider, Extended Selection | Present; slider handle radius 12, track 6. |
| Tabs / Navigation Bar | Row height 56 (MD), 48 icon buttons at edges; sizes SM / MD; 2 to 10 units. |
| Card | 320 x 192 demo, no border; elevation effect instance; slot padding 16; no inner radius. |
| Dialog | Breakpoint variants (BPXS-320 up); modes "Focus Large" etc.; content slot padding 16, 32 top spacer, close button 48x48 top, elevation instance; scrim #000000B2. |
| Notification, Infobox | Bar with icon + headline/copy (12/20) + optional close and button; surface from Feedback colours. |
| Tag | Sizes (MD etc.); selectable mode; 27 colour vars. |
| Badge | Modes Without value / Count / Alert. |
| Popover | Tips Horizontal and Vertical, content slot. |
| Progress Indicator | Bar (track 2, fill 4) and Spinner (stroke 1 / 2 / 3). |
| Divider | 1px (MD) or 2px (LG). |

Focus: 4px focus width token plus blue #0989FF focus colour.

## Pages (kit, 63 canvases)

Cover, Tokens / Styleguide, Getting started, RTL Translation, Internal Only Canvas, section dividers (New Components, Global, UI, Navigation, Forms, Feedback, Action), then one page per component:

- Action: Button, Button Group, Toggle Button, Toggle Button Group, Text Link
- Forms: Checkbox, Checkbox Group, Radio Button, Radio Button Group, Text Input, Text Area, Search Field, Select Field, Slider, Toggle Switch, Extended Selection
- Feedback: Notification, Infobox, Progress Indicator, Badge, Skeleton
- Navigation: Navigation Bar, Tabs, Pagination, Page Indicator, Breadcrumb, Media Control
- UI: Card, Accordion, Avatar, Carousel, Dialog, Divider, Favicon, Icon, List Item (WIP), Motion (WIP), AI Color (WIP), Popover, Product Tile, Rich Text, Tag, Text List

Top-level component names also include internals prefixed with a dot (for example `.Tab Unit`, `.Navigation Bar Unit`, `.SelectField-Option`, `.ToggleSwitchControl`, `.Radio Control`, `.Checkbox-Control`, `.Page Number`, `.Directional Button`) and Global primitives `Underline`, `ImageContainer`, `ExchangeableSlot`, `Elevation`.

## Icons file (DS3 Audi Icons 4.12)

- Pages: Cover + Release Notes, Internal Only Canvas, Icons, Social Media Icons.
- 409 UI/automotive icons (one component set each, 409 unique names) + 20 social icons.
- Each icon set has variants on axes Dark (false/true), Size (XS 16, S 24, L 48) and sometimes Active (false/true). About 1,745 24px, 940 48px, 843 16px component variants in the file.
- Style: monoline outline glyphs on a pixel grid, themed by the Dark axis (no colour of its own; they take the interaction colours).
- Social set: facebook, feed, google-plus, instagram, line-me, linkedin, napster, pinterest, snapchat, tiktok, vimeo, wechat, weibo, whatsapp, x, xing, yelp, youku, youtube, zhihu (Dark x Size S, L).
- Names in the main set (all 409; names only, no artwork copied): 3d, accomondation (sic), adblue, adblue-alert, add, add-circle, address-book, air-filter, air-filter-inlet, air-suspension, amazon-music, announcements, anti-theft-alarm-system, anti-theft-alarm-system-alert, apple-carplay, apps, arrow-back, arrow-down, arrow-left-light, arrow-left-normal, arrow-left-sharp, arrow-left-u-turn, arrow-right-light, arrow-right-normal, arrow-right-sharp, arrow-right-u-turn, arrow-straight-down, arrow-straight-up, arrow-up, assistant-input, audio-description, audio-volume, audio-volume-off, aupeo, back, back-door-left, back-door-right, battery, battery-12v, battery-at-destination, battery-at-start, battery-charge, battery-price, benefits, bicycle, blog-post, bluetooth, bonnet-closed, bonnet-open, bookmark, brake-fluid, brake-pad, brake-pad-alert, break, brush, business-address, business-customer, calculator, calendar-events, camera, camera-off, cancel, car, car-connect, car-dimensions, car-handover, car-insurance, car-search, car-search-info, car-settings, car-wash, catalogue, caution, charge-level, charging, charging-plate, charging-station, city, climate, climate-auto, climate-electric, closed-caption, clothing, co2-emission, code, collapsed-tabs, commute, compare, compass, compass-north, connect-key, consumption, content-activities, copy, country, credit-card, cross-traffic-assist-rear, cubic-capacity, damper, dashboard, dealer-request, dealer-search, delivery, destination, diagnostics, direct-mail, discussion, display, distance, document-pdf, document-pricelist-dollar, document-pricelist-euro, document-taxation, documents, dog-park, doors-closed, doors-open-all, doors-open-front, download, drive-belt, eco-cycle, eco-friendly, edit, editorial, electric-range, energy-green, engine, erase, extended-warranty, external-link, eye, eye-crossed, factory, favorite, feature-on-demand, filter, financial-services, first-aid, flashlight, follow, forward, front-door-left, front-door-right, fuel-range, fuel-station, gas-station, geofence, geofence-alert, gift, gps, gps-info, grab, groceries, group-discussion, groups, handshake, height, help-circle, history, home, honk, honk-and-flash, hotline, idea, indicators, info-circle, inside-loading, inspection, intelligent, intelligent-search, interior-configuration, keyboard, languages, laptop, light-technology, lights-crossed, lights-day, lights-dim, lights-full-beam, lights-led, lights-xenon, line, list, lock, lock-unlock, logbook, login, logout, loose-wheel-indicator, main-user, maintenance, maintenance-schedule, maneuvering-assist, map-layer, merchandise, microphone-off, microphone-on, mileage, mmi, mobile-phone, more, motorway, my-dealer, myaudi-destinations, network, news, nfc, nfc-inactive, notepad, occupant-detection, off-canvas, offline-maps, oil-change, online-radio, options, order-reverse, over-the-air, over-the-air-car, package, paragraph-circle, parking, parking-garage, parking-in/out-* (12), pause, payment, payment-cash, payment-free, phone-helpline, photo, photo-none, piloted-parking, plan-route, play, playground, plug-* (12 connector types), poi, poi-* (8), pois, polls, power, power-solar, power-water, power-wind, pre-heating, print, privacy-mode, private-customer, profile, projects, public-transport, quattro, rating, rating-50, raw-materials, receive-e-mail-notification, recommended-destination, recreation, refresh, remove, remove-circle, replay, resize-decrease, resize-increase, restaurant, restroom, results-list, rim, roof-open, rotate-device, rotate-device-up, rotate-image-left, rotate-image-right, rotate-left, rotate-right, roundabout-* (7), search, select, select-all, select-circle, send, send-to-vehicle, service-package, settings, share, share-android, shopping-basket, shopping-basket-selected, shuffle, side-assist, signal, skip-next, skip-previous, slider, slider-vertical, smartwatch, smiley-happy/neutral/unhappy, snow, social-reader, spark-plug, special-circumstances, special-offer, split, spring, status-update, stock-market, stop, sync, sync-off, tag, test-drive, thumbs-down, thumbs-up, time, time-climate1/2, time-long/middle/short, tire, tire-battery, tire-sealant, toilet, top-speed, torque, tour, traffic, traffic-lights, traffic-sign-recognition(-alert), trailer-maneuver, trailer-parking, train, training, transmission, trophy, trunk-closed/open, tube, upload, used-car-search, used-cars, user, user-whole-body, valet-parking, vehicle-signal, vehicle-wi-fi-1..4, velocity, velocity-alert, video, video-call(-disabled), view-360, voice-call(-1..3), walk, wallbox, warranty, web, weblink, width, window-closed/downlifting/lift/uplifting/ventilate, windshield, windshield-fluid, work, zero-microplastic, zero-plastic.
- The UI-relevant subset for a web app: add, remove, close-like (cancel, remove-circle), search, settings, user, profile, home, edit, erase, copy, download, upload, play, pause, stop, refresh, sync, eye, eye-crossed, filter, list, more, info-circle, help-circle, caution, lock, login, logout, send, share, external-link, arrow-*, back, forward, favorite, time, history, calendar-events, code, keyboard, chat equivalents (discussion, group-discussion), thumbs-up/down, smiley-*.

## Visuals

- `thumbnail.png` (kit): black cover, white Audi rings logo, "Unified Web UI Kit 1.0 / DS 3.0 (beta)" in a light wide grotesque (Audi Type). Icons thumbnail: red cover "Audi Icons" plus sample web layouts (black/white, large photography, minimal white buttons).
- `images/` (91 in the kit, 6 in the icons file) are Figma-tutorial screenshots and documentation photos/mock imagery, not components; they carry no design tokens. Not copied.
- Visual language summary: pure black/white canvas, wide extended type, sharp 90 degree corners, 1px hairline strokes, underline form fields, red (#EB0D3F light / #FD2C4E dark) used sparingly for highlight/error, grey ramp for hierarchy, soft low-alpha shadows only for elevated surfaces.

## Not decoded / gaps

- Fill-style colours (~2,900) were not tabulated separately; variables cover the same ground.
- Per-state geometry for every component variant was not exhaustively dumped, only representative variants (Idle/default). Hover/Focus differ mainly in colour and the 2px/4px indicator ring.
- Vector icon geometry was deliberately not decoded or exported (brand-asset rule).
- Letter-spacing on heading text styles: see caveat in "How it was decoded".
- `App` and `InCar` mode sets (mobile app and in-car HMI) exist but are out of scope and not tabulated.
