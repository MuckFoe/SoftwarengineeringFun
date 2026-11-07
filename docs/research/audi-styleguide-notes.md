# Audi UI styleguide - research notes

Source: https://styleguide.audi.com (Frontify SPA), read 2026-11-06 with headless Playwright. Pages last modified Jan 2026 per the site. Paraphrased; short quotes only. No assets downloaded into the repo.

Sidebar structure of the UI document (https://styleguide.audi.com/document/2865#/-/ui-introduction): Introduction > UI Introduction; User Interface > UI Animation (Functional Animation, Transitions), Experience Principles, UX Paradigms, Responsive UI, Themes, Form Tool, Browser Support; Icon Library; UI Components > Buttons, Card, Drag & Drop, Input Fields, Loader, Navigation, Notifications, Overlays, Pagination, Player, Selection controls, Slider, Slideshow, Table, Text Styles. The "Brand Basics" hub (https://styleguide.audi.com/hub/271, document 1811) holds Colours, Typography, Layout Structure, Animation, Icons.

IMPORTANT LIMIT: the written pages give almost no numeric type scale, radius or spacing scale. Those live in images, the React library (@oneaudi/unified-web-*, GitHub token required) and the Figma UI Kit (29 MB ZIP, not downloaded). Items marked NOT PUBLISHED / NOT READ below are gaps.

## 1. Introduction / layout principles
URL: https://styleguide.audi.com/document/2865#/-/ui-introduction
- Design for small viewports first.
- Layout is generously split into blocks, vertically and horizontally. Content sits in rectangular tiles in brand colours, separated by narrow padding. Tiles with a function are "cards" (brand colours or grey scale).
- Separate elements with spacing; where compact, use a fine line placed BETWEEN elements.
- Hierarchy through size and placement; active/important elements contrast starkly with background, inactive ones less.
- Shadow guidance (on this page): "as subtle as possible", always two shadows (short + long), no offset (same on all four sides). Basic CSS: `box-shadow: 0 0 [2-4px] 0 rgba(0,0,0,[0.03-0.1]), 0 0 [20-80px] 0 rgba(0,0,0,[0.03-0.15])`. Examples: `0 0 2px 0 rgba(0,0,0,.05), 0 0 40px 0 rgba(0,0,0,.05)`; `0 0 4px 0 rgba(0,0,0,.03), 0 0 60px 0 rgba(0,0,0,.09)`; `0 0 2px 0 rgba(0,0,0,.05), 0 0 20px 0 rgba(0,0,0,.05)`.
- Cut-out image gradient: 90deg top to bottom; light example #ffffff -> #f2f2f2, dark example #000000 -> #1a1a1a.

## 2. Experience principles and UX paradigms
URLs: https://styleguide.audi.com/document/2440#/-/experience-principles , .../2440#/-/ux-paradigms
- Four principles: Sophisticated quality (clean, minimalistic, refined; high contrast, limited type styles, flat design), Progressive performance, Intelligent guidance (reduced and relevant, natural feedback), Spirited mood (subtle animation, engaging).
- UX paradigms: Personalization, Context, Consistency (same names, same animations everywhere), Clarity (clear feedback on input), Reliability (communicate system states, notify problems immediately), Details.

## 3. Themes (light/dark) and elevation
URL: https://styleguide.audi.com/document/2440#/-/themes
- Two themes, light and dark. Light is the default. Brand-communication surfaces mainly light with dark accents; functional/tool UIs let the user switch.
- Both themes use a reduced palette and are "rich in contrast".
- Signal and charging colours have per-theme values (section 4). Progressive Red is NOT used in UI components and does not change with theme.
- Elevation (read from the diagram image, zoomed):

| Level | Light theme | Dark theme |
|---|---|---|
| Level 0 (page) | #ffffff solid | #000000 solid |
| Card | #ffffff solid (thin grey outline) | #ffffff at 10% alpha (outlined) |
| Level 1 | #ffffff solid | #1a1a1a solid |
| Level 2 | #ffffff solid | #262626 solid |
| Level 3 | #f2f2f2 solid | #333333 solid |

  In light theme depth is carried by shadow (section 1) and hairline outlines, only Level 3 is tinted; in dark theme depth is carried by lighter greys.
- Illustrations have a lighter-on-white light variant and a dark variant with less white; photography is unchanged between themes.

## 4. Colours
URL: https://styleguide.audi.com/document/1811#/-/colours
- Brand colours (full tone only, never tinted/transparent): White #ffffff; Black #000000; Progressive Red #f50537 (RGB 245/5/55).
- Functional greys (digital): #1a1a1a, #333333, #4c4c4c, #666666, #808080, #999999, #b3b3b3, #cccccc, #d9d9d9, #e5e5e5, #f2f2f2.
- Signal colours (notifications/status only; red may be used in blocks, yellow and green only for type/icons):
  - Green: light #0da20d, dark #15da15
  - Yellow: light #ffaa00, dark #ffaa00
  - Red: light #eb0d3f, dark #fd2c4e
- Charging colours (EV context only, sparingly): Neon Blue light #2526fe, dark #556efe; Neon Green light #0da20d, dark #15da15.

## 5. Typography
URLs: https://styleguide.audi.com/document/1811#/-/typography , https://styleguide.audi.com/document/2442#/-/text-styles
- Typeface: Audi Type (proprietary, exclusive to AUDI AG; licence terms in the download; fonts NOT fetched). Variants: Audi Type (normal width), Wide, Extended; Audi Type Variable is continuously variable in weight and width. Extended (headlines) has font width 130, may be reduced to min 120; optional optical width -15 for headlines.
- Role mapping: headlines/sublines Extended Normal to Bold; body Wide and/or normal Audi Type; buttons, text links, form fields, nav = Wide; emphasis = Bold; footnotes = Audi Type.
- Rules: ragged, flush left/right, mixed case, never uppercase, never outlined/underlaid/vertical, only black or white (greys allowed in digital for function).
- Fallback if Audi Type unusable: Verdana.
- Sub/superscript CSS: `sub, sup { font-size: 53.8%; font-variation-settings: "wdth" 108, "wght" 660; position: relative; vertical-align: baseline; bottom: -0.275em } sup { top: -0.68em }`.
- Type sizes: "adaptable modular scale" tied to viewport; NOT PUBLISHED as numbers in the text (predefined heading/body/highlight/list styles are shown only as images/Figma). Button base sizes below (16/18/20 px) are the only explicit sizes.

## 6. Layout, breakpoints, spacing, grid
URLs: https://styleguide.audi.com/document/2440#/-/responsive-ui , https://styleguide.audi.com/document/1811#/-/layout-structure
- Max content width 1920 px. Page margins:

| Breakpoint | Range (px) | Page margin |
|---|---|---|
| XS | 320-374 | 16 px |
| S | 375-767 | 28 px |
| M | 768-1023 | 40 px |
| L | 1024-1339 | 60 px |
| XL | 1440-1919 | 96 px |
| XXL | 1920 | 96 px |

  (The site lists L as ending 1339 and XL starting 1440; likely a typo, a gap of 1340-1439.)
- Terms: content area, layout region, spacing system (responsive spacers, dynamic per breakpoint). Detailed spacing values live in the Audi React Library: NOT PUBLISHED on the site.
- Base unit for narrow gaps: 0.25 rem (one quarter of base type size), used for button groups and card grids.
- Component-level "element queries" preferred over global breakpoints; all UI must be touch-optimised; no function removed on small screens.
- Layout structure: straight, rectangular, edge-bled blocks; no frames, transparencies, diagonals or boxes.

## 7. Shape / radius
No radius token is stated anywhere. All screenshots show square-cornered buttons, tiles, cards and modals; layout rules forbid "boxes and other geometrical shapes"; icons mix right angles with rounded corners. Practical reading: radius 0 for UI blocks (inference, not a stated rule). Badge small is a filled circle.

## 8. Iconography
URLs: https://styleguide.audi.com/document/2853#/-/icon-library , https://styleguide.audi.com/document/1811#/-/icons
- Technical-drawing style, 1 px constant contour, no filled blocks, right angles alternating with rounded corners, black or white. Each icon in three sizes (names end -s / -l, plus intermediate), placed in an invisible square; SVG and icon font. Icon files NOT downloaded.

## 9. Components (https://styleguide.audi.com/document/2442#/-/<slug>)
- Buttons (/buttons): sizes follow base font 16 / 18 / 20 px (small phone / tablet / wide web). Min width of primary and secondary = 9 x base font (144 px at 16). Label in Audi Type Wide Normal. Types: primary (filled, black or white, one per view), secondary (transparent with thin border), text button (text + arrow), system icon button, floating button, stretched and sticky primary (max 767 px viewports). Group gap 0.25 rem. Don'ts: no text buttons mixed with primary/secondary, no disabled buttons or forms on red, no generic labels.
- Input fields (/input-fields): text field = label + underline (label floats up and shrinks on focus), search field, multi-line (thin frame), selection dropdown, datepicker (numeric inputs + month select, native on mobile). Mark "(optional)" fields. Validation: red line, red label, red message (signal red per theme). Available in black and white. Sizes scale with base font.
- Card (/card): block with one topic, hover effect only if the whole card is the single interactive block; image cards bleed to edge, darken image by up to 30% for legibility; card grid gap 0.25 rem.
- Navigation (/navigation): navigation bar (active = underline + strong contrast, Audi Type Extended Normal), tab navigation (active = block in content background colour), sidebar (off-canvas, full-screen on small), list navigation (fine separator lines), tab bar for native apps (active = bottom line, white or black background), flyover, breadcrumb. Dark and light versions; dropdown on small viewports.
- Notifications (/notifications): global alert (full width), container alert, overlay toast (corner of right margin), badges (generic badge in signal red; small = filled circle). Wide-area notifications use brand colours/greys only, not signal colours.
- Overlays (/overlays): modal with background darkened 90% black, centred dialogue tile, scrollable modal full height, full-screen on narrow; popovers and tooltips; overlay colour from brand colours and greys.
- Loader (/loader): spinner (determinate), continuous spinner, progress bar, continuous progress bar; dark and light.
- Selection controls (/selection-controls): radio, checkbox, switch (label left/right/both).
- Table (/table): horizontal lines only, interrupted between columns, thicker lines on header, grey highlights, sortable columns with arrow icon.
- Pagination, Slider, Slideshow, Drag & Drop, Player: read; behaviour only, no tokens (indicator for fewer than 7 slides; sliders black/white; dropzone highlight).
- Form Tool, Browser Support: NOT READ.

## 10. Motion
URLs: https://styleguide.audi.com/document/1811#/-/animation , https://styleguide.audi.com/document/2440#/ui-animation/functional-animation , .../ui-animation/transitions
- Easing curve (the one concrete token): `transition-timing-function: cubic-bezier(0.75, 0.02, 0.5, 1)` (strong acceleration at start, fast deceleration at end). iOS control points 0.75/0.02/0.5/1.0; After Effects: outgoing velocity 75%, incoming 95%.
- Move only horizontally or vertically, never diagonally; scale and opacity for state change; rotation only on small elements and not combined; as few simultaneous animations as possible. Duration depends on element size and distance (no ms values published: NOT PUBLISHED).
- Functional roles: feedback, highlight, meaning, position. Transitions: show/hide (bottom-to-top with slight delay, animate once, fade-out to hide), transform, shift (push/slide), superimposing.

## Not readable / blocked
- No login wall hit. All pages above loaded anonymously.
- Not published as text: type-size scale, line heights, radius, spacing scale values, durations. Behind GitHub-token React packages or the Figma ZIP.
- Predefined text-style specimens and Specifications of some components appear only as images; not transcribed.
- Form Tool, Browser Support, Player/Slideshow details skimmed or not read.
