# Handoff: Personal TODO Ledger (rolling three-week grid)

## Overview
A personal task manager that replaces a Google Sheet. The sheet's shape is preserved deliberately: **one row per task, one column per calendar day**, and a cell is either a completion ✓ or a `DUE` marker. The app adds what the sheet could not do: a bounded rolling window instead of thousands of hidden rows, an on-disk structured file that AI tools can read and write, a real (invisible) priority rank, light nesting, and per-day vacation state.

Primary interface is desktop web, spreadsheet-dense. Mobile is a secondary, single-day collapsed view.

## About the Design Files
`Todo App Mockups.dc.html` in this bundle is a **design reference created in HTML** — a prototype showing intended look and structure, not production code to copy. The task is to **recreate these designs in the target codebase's environment** (React/Vue/Svelte/etc.) using its established patterns, or — since no codebase exists yet — to choose an appropriate stack and implement there.

The mockup file is a design canvas: it contains four turns of exploration stacked newest-first (`#t4`, `#t3`, `#t2`, `#t1`). **Only turn 3 (`#3a`, `#3b`, `#3c`, `#3d`, `#3e`) plus the turn-4 decision below represents the current design.** Turns 1 and 2 are superseded history — do not build from them.

## Fidelity
**High fidelity** for the desktop grid (3a/3b): final colors, type, spacing, and cell geometry. The interaction detail cards (3c, 3d, 3e) and the mobile screen (1e in turn 1) are **mid-fidelity** — correct in structure and behavior, to be styled with the tokens below.

## Data model

One item per record. Suggested on-disk shape: one markdown file per ISO week plus an archive folder, or a single JSON/YAML ledger — the design assumes **plain-text-first so an agent can edit it directly**.

| field | type | notes |
|---|---|---|
| `id` | string | stable |
| `title` | string | may be long; wraps to multiple lines |
| `notes` | string (markdown) | bullet lists supported, rendered under the title |
| `parent_id` | string / null | one level of nesting only |
| `project` | string | display color assigned per project |
| `rank` | fractional number | **the single ordering spine — never displayed** |
| `due` | date / null | at most one due day per item |
| `done_on` | date / null | the ✓ cell |
| `links` | array of `{url, title, favicon_or_kind}` | title/icon fetched once on paste and **cached in the file** so chips render offline |
| `archived_week` | ISO week / null | set by week close-out |

**Rank.** Jira-agile-style fractional ranking: to move an item between two neighbors, set `rank = (prev + next) / 2`. Rebalance the whole list when precision degrades. The number is never shown in the UI — order is expressed only by row position and the drag grip. The **same rank governs both views**: dragging in Project view also changes global priority order.

**Window.** Exactly four week blocks are visible: last week (dimmed) plus this week and the two following. Anything older lives in the archive and is searchable but never loaded into the grid.

**Week close-out.** A past week is *closeable* only when every item in it is either done or has no due date. Closeable past weeks show a small `×` in their week header; it is inert (and rendered absent) otherwise. Closing archives that week's completed items and shifts the window forward. There is no separate close-out screen — earlier explorations had one (turn 2, `#2c`); it was cut.

**Vacation days.** Any single day can be marked vacation by clicking its date header. Vacation cells are hatched, refuse due dates and completions, and anything already due there shifts to the next working day. The week still closes normally.

## Screens / Views

### 1. Priority view — the working grid (`#3a`) — primary screen
Left-to-right: collapsed icon rail, then item column, then four week blocks.

- **Icon rail** — 46px wide, `#f4f2ec`, 1px right border `rgba(0,0,0,.09)`. Collapsed by **default**; expands to a ~196px sidebar (project list, view links, sync status). Contains 26px/6px-radius square buttons: expand toggle (dark `#1c1b19`, white glyph), Grid (active, `#e4e0d6`), Today, Integrations. At the bottom: one 8px project color swatch per project and a 7px green sync dot.
- **Top bar** — 10px 16px padding, white, 1px bottom border. Left to right: **ledger file dropdown** (`personal.ledger ▾`, IBM Plex Mono 12px/500, 1px border `rgba(0,0,0,.14)`, 6px radius, `#faf9f6` fill) — this swaps between ledger files and creates new ones; then the **Priority / Project segmented toggle** (active = `#1c1b19` fill, white text, 11px/500; inactive = 1px border, `rgba(0,0,0,.55)`); then a `/` filter field (max 250px); then today's date right-aligned in mono 10.5px. **There is no “+ Item” button** — see Adding an item.
- **Week header row** — background `#f4f2ec`, 1px bottom border `rgba(0,0,0,.14)`. Item column is 360px (`box-sizing: border-box`). Each week block is **190px wide** with 1px left+right borders `rgba(0,0,0,.13)`; its label strip shows `W35` (mono 10px/600) plus the date range (sans 9.5px, `rgba(0,0,0,.45)`), and the `×` close affordance right-aligned when closeable (15px square, 4px radius, `#1c1b19`, white ×). Below: five 38px day columns.
  - Day cell: weekday letter (IBM Plex Sans 10px/600, `rgba(0,0,0,.72)`) stacked over the date (mono 9px, `rgba(0,0,0,.38)`).
  - **Today** is a 22px dark disc (`#1c1b19`) with white letter + date inside.
  - **Vacation** day is a 22px disc with a 1px dashed `rgba(0,0,0,.25)` border and muted text.
  - Last week's block is tinted `rgba(0,0,0,.028)` across header and body.
- **Weekend block** — a separate 40px column immediately **adjacent** to each week (no gap, no label): background `rgba(0,0,0,.035)`, 1px left+right borders `rgba(0,0,0,.07)`, a 19px spacer aligned to the week label strip, then two 19px day columns with muted S/S letters and dates. It belongs to neither the preceding nor the following week — that visual independence is the point.
- **Task rows** — `align-items: stretch`, 1px bottom border `rgba(0,0,0,.07)`, min row height 30px.
  - **Drag grip**: 24px column, mono 13px `⠿⠿` at `letter-spacing:-1px`, `rgba(0,0,0,.2)`. Wider than a single glyph on purpose — it is the primary reorder affordance.
  - **Project color bar**: 3px wide, full row height, project color at full opacity (Priority view) / 55% opacity (Project view).
  - **Title**: IBM Plex Sans, **12.5px/1.4 for open items, 11.5px for completed** (completed also gets `line-through` and `rgba(0,0,0,.4)`), `text-wrap: pretty`. **Wraps to multiple lines — never truncate or ellipsize.**
  - **Notes**: markdown bullets under the title, 11px/1.45, `rgba(0,0,0,.5)`, bullet glyph at `rgba(0,0,0,.28)`.
  - **Link chip**: inline-flex, 11px colored square + 10px title, 1px border `rgba(0,0,0,.13)`, 11px radius, white fill.
  - **Sub-items**: one level of indent, marked with a 16px L-shaped elbow drawn from 1px `rgba(0,0,0,.16)` borders.
  - Row vertical padding: 7px open / 4px completed (completed rows condense).
- **Grid cells** — 38px × min 30px, 1px left border `rgba(0,0,0,.06)`, 2.5px padding, `display:grid; align-items:center`. **The chip is vertically centered**, so a tall multiline row still reads as a grid rather than one ruled line over dead space.
  - `✓` chip: 25px tall, 5px radius, fill `oklch(.88 .07 155)`, glyph `oklch(.4 .09 155)` 11px/600.
  - `DUE` chip: 25px tall, 5px radius, fill `oklch(.89 .1 85)`, mono 8.5px/600 `oklch(.42 .11 70)`, `letter-spacing:.04em`.
  - Weekend cells use the same chips at 25px height with no glyph text and 4px radius.
  - Cell backgrounds: today's column `oklch(.97 .015 250)`; highlighted cell `oklch(.95 .05 95)`; selected cell `oklch(.96 .025 250)`; vacation `repeating-linear-gradient(45deg, rgba(0,0,0,.05) 0 3px, transparent 3px 6px)`; last-week block `rgba(0,0,0,.028)`.
  - **Selection**: clicking anywhere in a cell selects it and fills the whole cell with the soft blue. The 2px `oklch(.55 .13 250)` outline is drawn **only around the DUE/✓ chip**, never around the full cell.
- **Add row** — last row of the grid: 14px dashed-border square with `+`, the words “add item”, and the `N` shortcut hint, all at `rgba(0,0,0,.3)`.
- **Footer** — `#f4f2ec`, 1px top border, mono 10.5px `rgba(0,0,0,.5)`: shortcut legend (`D due`, `V done`, `X clear`, `⌥↑↓ reorder`, `⌥←→ move due`, `N new`) and a right-aligned close-out status line.

### 2. Project view (`#3b`)
Identical grid, identical cell geometry. Differences only:
- Toggle shows Project active.
- **Project divider rows**: disclosure `▾`, 7px project color square (2px radius), project name in sans 12px/600, then a meta string in mono 9.5px `rgba(0,0,0,.38)` (e.g. “3 done last week · 4 open”).
- Items sit one indent level in; their color bar drops to 55% opacity.
- Reordering inside a project writes the same global `rank`.

### 3. Adding an item (`#3c`) — three interactions, all wanted
This is the highest-frequency action, so there is no toolbar button.
- **A · Hover seam** — hovering the gap between two rows reveals a 1px `oklch(.55 .13 250)` line with a 15px round `+` at its left end. Click inserts a row there; the new item takes the rank midway between its neighbors and nothing else moves.
- **B · Enter splits the stack** — with a row selected, `⏎` inserts an editable row below (`⇧⏎` above, `⇥⇥` indents it as a sub-item, `esc` discards). The draft row shows a 2px blue inset outline and a text caret. Sheet muscle memory.
- **C · Quick capture** — `⌘K` overlay. Typed text is parsed inline with token highlighting (`thu` tinted amber = due day, `weymouth` tinted blue = project) and a resolved interpretation line beneath (“due Thu 27 Aug · Weymouth ground floor”). `⏎` adds at top, `⌥⏎` adds to backlog.

### 4. Cell menu & vacation (`#3d`)
Right-click / context menu is deliberately minimal — three entries only, each with a 13px color swatch matching the chip it produces: **Mark done (V)**, **Set due (D)**, **Clear (X)**. Menu: 190px wide, 7px radius, 1px border `rgba(0,0,0,.12)`, shadow `0 4px 14px rgba(0,0,0,.08)`.

Shortcut mnemonics matter: **V** because it looks like a checkmark, **D** for due. Everything else is expected to be keyboard-driven: `⌥↑ / ⌥↓` move the selected row up/down the rank, `⌥← / ⌥→` nudge its due day, `⌘C / ⌘V` copy and paste cell values, `N` new item. **Treat this set as provisional — the user intends to revise the bindings.**

### 5. Day/date header treatments (`#3e`)
Four candidates were explored; **treatment i (stacked letter over date, today as a dark disc) is the chosen one** and is what 3a/3b implement. The others (date-leads, banded tints, week-as-a-card) are recorded in the file for reference only.

### 6. Integrations / AI surface (`#1d`, turn 1 — structure still valid, restyle to current tokens)
- **File mirror** — the ledger rendered as editable markdown in a dark panel (`#1c1b19`, text `#e6e2d8`, mono 11px/1.75). Round-trip editable: whatever an agent writes here shows in the grid and vice versa. Footer line names the path, git-tracking, and last writer.
- **MCP server** — endpoint row, masked token with rotate, and the tool surface as chips: `list_items`, `add_item`, `complete_item`, `reschedule`, `close_out_week`.
- **Recent agent writes** — timestamped log of agent mutations.

### 7. Mobile (`#1e`, turn 1 — structure valid, restyle)
390px. Header shows the weekday + date and a compact `M T W TH F +2w` strip with today as a dark pill. Body is a single day's items grouped by project, 20px checkboxes (44px minimum touch target on the row), completed items struck through at 50% opacity. Bottom bar: “add an item…” field plus a 44px round dark `+`.

## Interactions & Behavior
- Click a cell → select (whole-cell soft fill). `D` sets due, `V` marks done, `X` clears, `H` highlights.
- Drag the grip → reorder; drag a chip horizontally → move the due day. Multi-cell drag moves a whole row's schedule (dashed insertion edge marks the drop column).
- Paste a URL into a title → chip resolves title + icon once, then caches; the raw URL stays in the file so it degrades to plain markdown for agents.
- Priority ⇄ Project toggle is a view switch only; no data changes.
- Week `×` is present only on past weeks, enabled only when closeable.
- Vacation toggling reschedules affected due dates forward.
- Undo window on close-out: 7 days.

## State
`viewMode` (priority|project) · `selectedCell {itemId, date}` · `expandedSidebar` · `activeLedgerFile` · `windowStartWeek` · `draftItem` · `captureOpen` · `highlights[]` · `vacationDays[]`.

### 8. Theme picker (`#5d`)
Three themes ship: **Paper** (light), **Solarized dark**, **Warm dark**, plus a **Match system** option. The picker is a compact pill at the right end of the top bar, immediately left of the date: 9px round color swatch + theme name (sans 10.5px/500) + `▾`, 1px border, 6px radius, `subtle` fill. Open, it is a menu of rows — 11px swatch, name, `✓` on the active one — with the system option showing a split light/dark swatch. Theme choice is **per-device and stored outside the ledger file**, so it never syncs and never appears in the markdown an agent reads.

Every theme keeps structure, hierarchy, type scale and all measurements identical. Only surface, ink, hairline, chip and accent values change. Implement as a token set swapped at the root (CSS custom properties or equivalent); `Grid Theme.dc.html` in this bundle is the themable grid, parameterized by exactly the token names below.

## Design Tokens
Fonts: **IBM Plex Sans** (400/500/600/700) UI, **IBM Plex Mono** (400/500/600) for dates, paths, shortcuts, metadata.

```
canvas        #efece5      page background (canvas only)
surface       #faf9f6      app background
panel         #ffffff      top bar, cards
subtle        #f4f2ec      header strips, footer, rail
ink           #1c1b19      primary text, today disc, primary button
ink-70        rgba(0,0,0,.72)
ink-50        rgba(0,0,0,.5)
ink-38        rgba(0,0,0,.38)
hairline      rgba(0,0,0,.06 / .07 / .09 / .13 / .14)
done fill     oklch(.88 .07 155)   done text  oklch(.4 .09 155)
due fill      oklch(.89 .1 85)     due text   oklch(.42 .11 70)
select        oklch(.55 .13 250)   select fill oklch(.96 .025 250)
today tint    oklch(.97 .015 250)
highlight     oklch(.95 .05 95)   (+ red / blue / green variants in the palette)
project blue  oklch(.62 .1 210)    purple oklch(.6 .11 300)   green oklch(.63 .09 140)
radius        3 / 4 / 5 / 6 / 7 / 8px   chips 5px, buttons 6px, menus 7px
day column    38px      weekend column 19px (block 40px)
week block    190px     item column 360px     rail 46px
row height    30px min  chip height 25px
```

### Theme token table
Token names match the props on `Grid Theme.dc.html`. Geometry is shared by all three.

| token | Paper (light) | Solarized dark | Warm dark |
|---|---|---|---|
| `surface` | `#faf9f6` | `#002b36` | `#1c1a17` |
| `panel` | `#ffffff` | `#04303c` | `#232019` |
| `subtle` | `#f4f2ec` | `#073642` | `#2a2621` |
| `ink` | `rgba(0,0,0,.88)` | `#c3ccc8` | `#e8e2d6` |
| `ink2` | `rgba(0,0,0,.72)` | `#93a1a1` | `#c6bdac` |
| `ink3` | `rgba(0,0,0,.45)` | `#6d8189` | `#948b7c` |
| `ink4` | `rgba(0,0,0,.28)` | `#4e646c` | `#665e51` |
| `hair` | `rgba(0,0,0,.07)` | `rgba(147,161,161,.12)` | `rgba(255,255,255,.07)` |
| `hairStrong` | `rgba(0,0,0,.14)` | `rgba(147,161,161,.24)` | `rgba(255,255,255,.16)` |
| `doneBg` | `oklch(.88 .07 155)` | `oklch(.38 .08 126)` | `oklch(.42 .08 158)` |
| `doneFg` | `oklch(.4 .09 155)` | `oklch(.87 .14 122)` | `oklch(.89 .12 158)` |
| `dueBg` | `oklch(.89 .1 85)` | `oklch(.42 .1 82)` | `oklch(.45 .1 76)` |
| `dueFg` | `oklch(.42 .11 70)` | `oklch(.91 .12 88)` | `oklch(.93 .1 86)` |
| `todayBg` / `todayFg` | `#1c1b19` / `#fff` | `#268bd2` / `#002b36` | `#e8e2d6` / `#1c1a17` |
| `activeBg` / `activeFg` | `#1c1b19` / `#fff` | `#93a1a1` / `#002b36` | `#e8e2d6` / `#1c1a17` |
| `weekendBg` | `rgba(0,0,0,.035)` | `rgba(147,161,161,.055)` | `rgba(255,255,255,.035)` |
| `pastTint` | `rgba(0,0,0,.028)` | `rgba(0,0,0,.22)` | `rgba(0,0,0,.24)` |
| `todayTint` | `oklch(.97 .015 250)` | `rgba(38,139,210,.11)` | `rgba(232,226,214,.06)` |
| `selBg` | `oklch(.96 .025 250)` | `rgba(38,139,210,.2)` | `rgba(126,178,235,.15)` |
| `selRing` | `oklch(.55 .13 250)` | `#268bd2` | `oklch(.7 .12 240)` |
| `hlBg` | `oklch(.95 .05 95)` | `rgba(181,137,0,.22)` | `rgba(230,190,80,.16)` |
| `chipBg` | `#ffffff` | `#073642` | `#2a2621` |
| `linkDot` | `oklch(.72 .11 250)` | `#268bd2` | `oklch(.7 .1 240)` |
| `barA` / `barB` / `barC` | `oklch(.62 .1 210)` / `oklch(.6 .11 300)` / `oklch(.63 .09 140)` | `#268bd2` / `#2aa198` / `#859900` | `oklch(.68 .09 210)` / `oklch(.7 .1 45)` / `oklch(.68 .08 140)` |
| `doneFgRow` | `rgba(0,0,0,.4)` | `rgba(195,204,200,.42)` | `rgba(232,226,214,.42)` |
| `vacBg` (hatch stroke) | `rgba(0,0,0,.05)` | `rgba(147,161,161,.1)` | `rgba(255,255,255,.09)` |

Project bar colors are assigned per project from `barA/B/C…`; extend the ramp as projects are added, keeping hue separation and equal lightness within a theme.

## Assets
None. No images or icon fonts — every mark is text or CSS. Link-chip favicons are fetched at runtime and cached per item.

## Files
- `screenshots/` — rendered captures of each design, named by option id:
  - `01-3a-priority-grid.png` — primary screen
  - `02-3b-project-view.png`
  - `03-3c-add-item.png`
  - `04-3d-cell-menu-vacation.png`
  - `05-3e-day-headers.png`
  - `06-1d-integrations-ai.png`
  - `07-1e-mobile.png`
  - `08-5a-theme-paper.png`, `09-5b-theme-solarized-dark.png`, `10-5c-theme-warm-dark.png`, `11-5d-theme-picker.png`
  Captures are viewport-sized, so a card wider or taller than the viewport may be partly cropped — the HTML file is the authority.
- `Grid Theme.dc.html` — the themable grid used by turn 5; its props are the canonical token names.
- `Todo App Mockups.dc.html` — the design canvas. Build from turn 3 (`#3a` primary, `#3b`, `#3c`, `#3d`, `#3e`) with turn 4's decision (`#4b`, centered chips) already applied to 3a/3b. `#1d` and `#1e` in turn 1 are the integrations and mobile references. Turn 2 and the rest of turn 1 are superseded.
- `support.js` — runtime for the mockup file only. Not part of the product.
- `sheet-original.png` — screenshot of the Google Sheet this replaces, for context.
