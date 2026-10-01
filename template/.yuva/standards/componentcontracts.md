# Component Contract Standards

The behaviour half of the design system.

| File | Answers | Decided |
|------|---------|---------|
| `.yuva/standards/designsystem.md` | What should this *look* like? (the rules) | shipped |
| `docs/design-brief.md` (`B1-B8`) | the answers, for THIS project | once per project, by the Design agent |
| **this file** | How must this *behave*? | once per component, binding on every later agent |
| `frontendstandards.md` | Where does the code live? | once per project |

Taste is per-project and negotiable. **Contracts are per-component and are not.**
A component that looks right and behaves inconsistently is worse than one that
looks plain and behaves predictably, because the second can be trusted.

---

## 1. The Component Contract

Every component in `docs/components/` gets one file with all twelve sections,
numbered `C1-C12`.
No component is "done" until its contract is written, and the contract is written
**before** the implementation — it is the spec, not the documentation.

```markdown
# <ComponentName>

## C1. Purpose
One sentence. What job does this do that no existing component does?
If you cannot answer the second half, you are duplicating something.

## C2. Anatomy
Named parts, outermost first. These names are binding — they become the
class names, the slot names, and the test selectors.
e.g. root > leading > label > trailing > indicator

## C3. API
| Prop | Type | Default | Required | Notes |
Every prop. Include the escape hatches (className, ...rest) explicitly or
state that there are none.

## C4. Variants and sizes
The closed set. Not "primary | secondary | ..." — the actual list.
State which combinations are INVALID and what happens if asked for one.

## C5. States
The full set from section 6. For each: what changes visually, and what
changes behaviourally.

## C6. Interaction contract
Pointer, keyboard, touch. What is idempotent. What is debounced.
What happens on double-activation. What happens offline.

## C7. Keyboard contract
Every key this component handles, and what it does. Table form.
If it handles none, say so explicitly — that is a claim, not an omission.

## C8. Accessibility contract
Role, accessible name source, ARIA attributes and when they change,
focus behaviour, what is announced and when.

## C9. Responsive contract
What changes at which breakpoint, and WHY. "Nothing" is a valid answer
and must be stated. Include 320px and 200% zoom behaviour.

## C10. Content rules
Max/min lengths, truncation behaviour, what happens with no content,
what happens with 10x expected content, RTL behaviour, number/date
formatting ownership.

## C11. Composition
What this may contain. What may contain this. What it must never be
nested inside.

## C12. Do not
The three or four misuses you expect, named, so reviewers can point at
this section instead of re-arguing.
```

**Why C12 exists:** the same misuse gets re-litigated in every review
until it is written down once. Naming it converts a recurring argument into a
link.

---

## 2. Component Inventory

A project's inventory is declared in the design brief at **B7**
(`docs/design-brief.md`), NOT in the standard - §7 of
`.yuva/standards/designsystem.md` is Motion. Brief sections are numbered `B1-B8`
and contract sections `C1-C12` precisely so a cross-reference cannot land in the
wrong file. These tiers decide *where a thing belongs*, which is the decision
people get wrong.

### Tier 0 — Primitives

No business logic. No data fetching. No knowledge of the domain. Fully
controlled or fully uncontrolled by explicit choice (§5.2).

`Button` `IconButton` `Link` `Input` `Textarea` `Select` `Checkbox` `Radio`
`Switch` `Slider` `Label` `FieldError` `Text` `Heading` `Icon` `Avatar` `Badge`
`Tag` `Spinner` `Skeleton` `Divider` `Kbd` `Code`

### Tier 1 — Compositions

Compose primitives. Still domain-free. Own their interaction and keyboard
contracts, which is why they are not primitives.

`Field` (label + control + hint + error) `Form` `Dialog` `Drawer` `Popover`
`Tooltip` `DropdownMenu` `ContextMenu` `Tabs` `Accordion` `Breadcrumb`
`Pagination` `Toast` `Banner` `Card` `Table` `DataTable` `EmptyState`
`ErrorState` `LoadingState` `Command` `Combobox` `DatePicker` `FileUpload`

### Tier 2 — Patterns

Domain-aware. Compose Tier 1. **These are the only components that may fetch
data or know about your API.**

Named from the product brief's core objects (§1.0 of `designsystem.md`) — e.g.
`TaskQueue`, `AgentRoster`, `SessionTimeline`, `GateResultPanel`.

### The tier rules

1. **A component may only depend on lower tiers.** A primitive importing a
   pattern is a circular design, not just a circular import.
2. **Only Tier 2 touches the network.** If a Tier 1 component needs data, it
   takes it as a prop. This is what makes Tier 0 and 1 testable and reusable.
3. **Only Tier 0 and 1 go in the design system.** Tier 2 lives in the feature
   that owns it.
4. **A pattern used by three features is probably a Tier 1 composition.**
   Promote it, strip the domain knowledge out, and give it a contract.

---

## 3. Naming Conventions

Not preferences. Pick-once-and-never-argue rules.

### Components and files

| Thing | Convention | Example |
|-------|------------|---------|
| Component | `PascalCase`, noun | `DataTable` |
| Sub-component | parent `.` child | `DataTable.Row` |
| File | matches the component | `DataTable.tsx` |
| Contract | matches, in `docs/components/` | `DataTable.md` |
| Hook | `use` + noun/verb | `useDisclosure` |
| Type | `PascalCase`, no `I` prefix | `DataTableProps` |

Components are named for **what they are**, never for where they appear or how
they look: `Banner`, not `TopBanner`; `Badge`, not `GreenPill`. A name that
encodes position or colour is wrong the first time either changes.

### Props

| Kind | Convention | Example | Never |
|------|------------|---------|-------|
| Boolean | positive adjective, no prefix | `disabled`, `loading` | `isDisabled`, `notEnabled` |
| Variant | the axis name | `variant`, `size`, `tone` | `type`, `kind`, `style` |
| Handler | `on` + past-tense event | `onSelect`, `onDismiss` | `handleClick`, `onClickHandler` |
| Render slot | noun | `leading`, `trailing`, `footer` | `renderIcon`, `iconComponent` |
| Controlled value | `value` + `onValueChange` | `open` / `onOpenChange` | `value` / `setValue` |
| Uncontrolled seed | `default` + the prop | `defaultOpen` | `initialOpen` |

**Never negate a boolean.** `disabled` not `enabled`, and never both. A
`notDisabled` prop is how you get `notDisabled={false}` in a code review.

**Handlers report, they do not command.** `onSelect` says what happened;
`onSelectItem` leaks the implementation. The parent decides what to do.

### CSS and test hooks

| Thing | Convention | Example |
|-------|------------|---------|
| Part class | `component` + `__` + anatomy name | `datatable__row` |
| State | `data-` attribute, never a class | `data-state="open"` |
| Variant | `data-` attribute | `data-variant="ghost"` |
| Test hook | `data-testid`, anatomy name | `data-testid="datatable-row"` |

**State goes on `data-` attributes, not class names.** It makes the state
inspectable in devtools, selectable in CSS (`[data-state="open"]`), and
assertable in tests without coupling to styling. A `.is-open` class gives you
none of that.

### Tokens

See §7. Three tiers, and the naming encodes the tier.

---

## 4. Variant Discipline

Variants are where design systems rot. The rot is combinatorial: four axes with
four values each is 256 states nobody tested.

### Variant, prop, or new component?

| Situation | Answer |
|-----------|--------|
| Same anatomy, same behaviour, different emphasis | **variant** |
| Same anatomy, different behaviour | **separate component** |
| Different anatomy | **separate component** |
| One-off visual change for one screen | **neither** — style at the call site |
| Boolean that only ever pairs with one variant | **fold it into the variant** |

If a variant's implementation is a large conditional branch, it is a different
component wearing the same name. `Button variant="link"` that renders an `<a>`
is the classic example — different element, different semantics, different
keyboard behaviour. Make it `Link`.

### Rules

1. **Variants are a closed set.** A union type, never `string`. An unknown
   variant is a type error, and at runtime falls back to the default rather
   than rendering unstyled.
2. **Maximum three variant axes per component** (typically `variant`, `size`,
   and one more). A fourth means the component is doing two jobs.
3. **Document invalid combinations and make them unrepresentable** where the
   type system allows. Where it does not, the contract's §4 states what happens.
4. **Every variant appears in the visual snapshot test.** An untested variant
   will drift.
5. **No variant may change semantics.** Same role, same keyboard contract,
   same accessible-name source across every variant. Appearance only.

---

## 5. State Contracts

### 5.1 The state machine every interactive component implements

```
                 ┌──────────────┐
    ┌───────────►│     idle     │◄──────────┐
    │            └──────┬───────┘           │
    │                   │ activate          │
    │            ┌──────▼───────┐           │
    │            │   pending    │           │ reset
    │            └──┬────────┬──┘           │
    │       success │        │ failure      │
    │        ┌──────▼──┐  ┌──▼───────┐      │
    └────────┤ settled │  │  error   ├──────┘
      reset  └─────────┘  └────┬─────┘
                               │ retry
                               └──────► pending
```

Non-negotiable consequences:

- **`pending` must be visually distinct and must block re-entry.** A button that
  can be clicked twice during an in-flight request is a defect, not a race the
  backend should handle.
- **`error` must be recoverable from the component.** An error state with no
  retry and no way back to `idle` is a dead end.
- **`settled` is not always a state.** For an idempotent toggle it collapses
  back into `idle`. Say which in the contract.

### 5.2 Controlled, uncontrolled, or both

Pick **one** per component and write it in the contract. The bug this prevents
is the component that is sometimes both and silently loses updates.

| Mode | Shape | Use when |
|------|-------|----------|
| Uncontrolled | `defaultOpen`, internal state | consumer never needs to know |
| Controlled | `open` + `onOpenChange`, no internal state | consumer owns the truth |
| Dual | both, `open !== undefined` selects controlled | a design-system primitive |

Dual-mode rules, if you choose it:

1. The controlled/uncontrolled decision is made **once, on first render**, and
   never re-evaluated. Switching mid-life is a bug — warn in development.
2. In controlled mode the component **never** writes its own state. It calls the
   handler and re-renders from the prop. A component that does both will fight
   its parent.
3. `onOpenChange` fires for **every** change, including ones the component
   initiated itself (Escape key, outside click). Otherwise the parent desyncs.

### 5.3 Data-surface states

Every component that displays fetched data implements all five from
`designsystem.md` §8 — `loading`, `empty`, `error`, `partial`, `populated` — and
the contract names which component renders each. The common failure is each
feature hand-rolling its own empty state; that is what Tier 1 `EmptyState`,
`ErrorState` and `LoadingState` exist to prevent.

`empty` is not one state. Distinguish, because the right action differs
(`designsystem.md` §8):

| Flavour | Action offered |
|---------|----------------|
| Never had data | create |
| Filtered to zero | clear filters |
| Permission denied | request access |
| Legitimately finished | none |
| Read-only and empty | none |

---

## 6. Interaction Contracts

### 6.1 Universal requirements

Every interactive component:

- responds to **pointer and keyboard equally** — no pointer-only affordance
- has a **44x44px minimum touch target** on touch-reachable controls, via
  padding or a pseudo-element, not by inflating the visual size
- shows `:focus-visible` (never suppressed — `designsystem.md` §8)
- is **idempotent under double-activation**, or blocks it during `pending`
- has **no hover-only disclosure of essential information** — hover does not
  exist on touch, and does not exist for keyboard users

### 6.2 Timing

| Behaviour | Rule |
|-----------|------|
| Search-as-you-type | debounce 250-300ms, trailing |
| Autosave | debounce 1000ms, plus flush on blur and on unmount |
| Scroll/resize handlers | throttle to one frame (`requestAnimationFrame`) |
| Tooltip open | 500ms delay in, 0ms out within the same group |
| Optimistic update | apply immediately, reconcile on response, **always** show the rollback |
| Double-submit guard | disable on first activation, re-enable on settle |

Flushing a debounced autosave on unmount is the one people forget, and it loses
user data.

### 6.3 Destructive actions

Driven by **P7** of the product brief (`designsystem.md` §1.0). Any action that
is irreversible or expensive to reverse:

1. **Visually distinct from safe actions** — not merely the same button in a
   different colour. Colour alone fails for colour-blind users and in
   forced-colors mode.
2. **Never the default focus target** in a dialog, and never adjacent to the
   safe action without separation.
3. **Confirmation proportional to consequence**:
   - trivially undoable → no confirmation, offer undo in a toast
   - reversible with effort → confirm dialog naming the object
   - irreversible → confirm dialog requiring the object's name typed
4. **The confirm button states the action**, never "OK". "Delete 12 tasks" tells
   the user what they are about to do; "OK" asks them to remember.
5. **Undo beats confirmation** wherever it is implementable. A confirm dialog
   taxes every correct action to prevent a rare incorrect one.

---

## 7. Token Governance

Tokens rot the way variants do: by accretion. Governance is the difference
between a token system and a pile of CSS variables.

### 7.1 Three tiers

| Tier | Example | Who may add | Components may use |
|------|---------|-------------|--------------------|
| **Primitive** | `--n-500`, `--space-4` | Design agent only, from the brief | **never** |
| **Semantic** | `--text-muted`, `--border` | Design agent only | **always — this tier only** |
| **Component** | `--button-height-sm` | the component's owner | only its own component |

**A component referencing a primitive token is a defect.** `color: var(--n-500)`
hard-codes a ramp position; `color: var(--text-muted)` states intent. Only the
second survives a palette change — which is the entire point of having tokens.

### 7.2 Adding a token

1. Can an existing semantic token express the intent? Use it. Most "we need a
   new token" is "I did not read the list."
2. Is this specific to one component? Make it a **component** token, named
   `--<component>-<property>-<variant>`, defined in that component's file.
3. Is it genuinely a new system-wide concept? It needs a **semantic** token,
   which means a brief update and a note in Rejected Alternatives explaining
   why the existing set was insufficient.
4. New primitives (a new ramp, a new scale step) are a **design change**, not an
   implementation detail. They go back through the Design agent.

### 7.3 Removing a token

Never delete in place. Tokens are a public API of the design system:

1. Mark deprecated in `tokens.css` with the replacement and the removal version.
2. Keep it working, aliased to the replacement, for one minor version.
3. Remove it in the next **major**.

```css
/* @deprecated since 2.5 — use --text-muted. Removed in 3.0. */
--text-secondary: var(--text-muted);
```

### 7.4 What is checkable today

The `visual` gate's `generic-accent` rule catches banned accent values at
runtime. It does **not** yet catch a colour literal outside `tokens.css`, nor a
component reaching for a primitive token. Both are source-lintable and both are
on the enforcement list — until then they are review items, and §12 of each
contract is where you point.

---

## 8. Responsive Contracts

`designsystem.md` §5.3 covers intrinsic, breakpoint-free layout. That is the
right default and it does not cover everything. Each of these needs an explicit
per-component decision, recorded in contract §9:

| Decision | Why CSS cannot infer it |
|----------|-------------------------|
| **Sidebar**: persistent, collapsed-to-rail, or overlay | depends which navigation is essential to the job |
| **Table**: scroll, stack into cards, or hide columns | which columns are essential is product knowledge |
| **Action priority**: which actions survive into the overflow menu | ranking is a product decision |
| **Modal sizing**: centred, full-screen below X, or bottom sheet | depends whether the task is interruptible |
| **Primary navigation**: top, bottom bar, or drawer | platform convention plus reachability |
| **Viewport height**: `dvh` vs `svh` vs `lvh` | mobile browser chrome behaviour differs per case |
| **Landscape phone**: short-and-wide breaks vertical assumptions | height, not width, is the constraint |

### Required coverage

Every component contract states behaviour at:

- **320px width** — the real floor. Not 375. If it breaks here it is broken.
- **200% browser zoom** — a WCAG requirement, and distinct from a small
  viewport: text reflows but `px`-based layout does not scale with it.
- **landscape phone**, where vertical space, not horizontal, runs out.
- **touch**, including that hover does not exist.

"No change at any breakpoint" is a perfectly good answer. It must be *written*,
because then it is a claim someone can test rather than an oversight.

---

## 9. Accessibility Contracts

### 9.1 Target

**WCAG 2.2 Level AA**, including the 2.2 additions that are easy to miss:
`2.4.11` focus not obscured, `2.5.7` dragging movements have a non-drag
alternative, `2.5.8` 24x24 minimum target size, `3.2.6` consistent help
location, `3.3.7` no redundant entry.

AAA is not the target. Where a component cannot reach AA, that is recorded in
its contract §8 with the reason and the mitigation — not silently shipped.

### 9.2 Per-component requirements

Contract §8 declares all of:

| Item | Must state |
|------|------------|
| **Role** | the semantic element or explicit `role`, and why |
| **Accessible name** | where it comes from: content, `aria-label`, or `aria-labelledby` |
| **Icon-only controls** | the `aria-label` is **mandatory** — this is the single most common real-world failure |
| **ARIA state** | which attributes change, and on what |
| **Focus** | where focus goes on open, on close, on item removal |
| **Announcements** | what is announced, via which live region, at which politeness |

### 9.3 Dialog semantics

Any overlay that takes focus:

- `role="dialog"` with `aria-modal="true"`, or a native `<dialog>`
- labelled by its own heading via `aria-labelledby`
- focus moves **into** the dialog on open — to the first interactive element, or
  the heading if the first control is destructive
- focus is **trapped** while open: Tab from the last element returns to the first
- `Escape` closes, unless there is unsaved work, in which case it prompts
- focus is **restored to the trigger** on close. If the trigger is gone (it was
  the delete button for the row just deleted), focus moves to the nearest stable
  ancestor, never to `<body>`
- the rest of the page is inert — `inert` attribute, not just a visual scrim

Focus restoration is the step that gets dropped, and dropping it strands
keyboard users at the top of the document after every interaction.

### 9.4 Live regions

| Change | Region | Politeness |
|--------|--------|-----------|
| Form validation error | the field's own error element, `aria-describedby` | — |
| Save succeeded / toast | status region | `polite` |
| Async results loaded | status region, with the count | `polite` |
| Session expiring, operation failed | alert region | `assertive` |
| Progress | `role="progressbar"` with `aria-valuenow` | — |

Rules: the live region exists in the DOM **before** the content changes — a
region inserted together with its message is not announced. Never put an
`assertive` region on anything routine; it interrupts mid-sentence. Never
announce the same thing twice (a visible error plus an alert region reading it
again is noise).

### 9.5 Tables and grids

- real `<table>` with `<caption>`, `<thead>`, and `<th scope>`; ARIA grid roles
  only for an actually-interactive grid
- sortable column: `aria-sort` on the active header, and the control is the
  `<th>`'s button, not the `<th>`
- row selection: a real checkbox per row with an accessible name naming the
  **row**, not "select row"
- a `DataTable` with keyboard navigation implements the full grid pattern —
  arrows, Home/End, PageUp/PageDown — or it implements none and relies on Tab.
  Half of it is worse than neither.

### 9.6 Charts

A chart is not accessible because it renders. Every chart needs:

- a text alternative stating the **conclusion**, not the shape: "Throughput fell
  38% after the 14:00 deploy", not "a line chart trending down"
- the underlying data reachable as a table, even behind a disclosure
- no meaning carried by colour alone — direct labels, patterns, or markers
- `role="img"` with `aria-label` for a static chart; a focusable, keyboard-
  navigable series for an interactive one

### 9.7 Localisation, RTL, long text

Contract §10 states behaviour for:

- **RTL**: use logical properties (`margin-inline-start`, `padding-block`) so it
  is automatic. Directional *icons* must mirror; logos and media must not.
- **Long text**: German compounds and Finnish run 30-40% longer than English.
  Every label is tested at 2x length. A layout that only works with the English
  string is broken, not tight.
- **Truncation**: `text-overflow: ellipsis` plus the full value in a `title` or
  tooltip. Never truncate without an escape.
- **Formatting ownership**: `Intl.NumberFormat` / `Intl.DateTimeFormat`, locale
  from context, never hand-rolled. The component states whether it formats or
  expects pre-formatted input — both are fine, ambiguity is not.
- **Forced colors**: under `forced-colors: active` your palette is gone. Borders
  and focus indicators must survive on `ButtonText`/`CanvasText`, and anything
  conveyed by background colour needs a non-colour carrier.

---

## 10. Testing Rules

### 10.1 Required per component

| Test | Asserts | Tooling |
|------|---------|---------|
| **Render** | required props render the anatomy from contract §2 | any |
| **API** | each prop has its documented effect; defaults match §3 | any |
| **Variants** | every variant in §4 renders | snapshot |
| **States** | each transition in §5.1, including `pending` blocking re-entry | user-event |
| **Keyboard** | every key in contract §7 | user-event |
| **Accessibility** | zero axe violations; accessible name is correct | axe |
| **Focus** | dialogs trap and **restore** focus | user-event |
| **Content** | empty content, and 10x expected content | any |
| **Visual** | each variant x each theme, at 320 / 768 / 1440 | screenshot |

### 10.2 Test what the contract promises

Tests target the contract, not the implementation. Concretely:

- query by **role and accessible name** (`getByRole('button', { name: 'Save' })`).
  That one habit tests the accessibility contract for free on every assertion.
- assert on `data-state` and `data-variant`, never on class names
- drive with `user-event`, not synthetic `fireEvent` — real keyboard sequences
  catch real keyboard bugs
- **do not** test internal state, prop-drilling, or that a child was called with
  specific props. Those are refactors waiting to break a green suite.

### 10.3 Visual regression

Screenshots without baselines are documentation, not tests. A real setup needs a
committed baseline, a diff threshold (start at 0.1%), masking for genuinely
dynamic regions (timestamps, avatars), and both themes.

Yuva's `visual` gate currently captures screenshots and audits rendered styles;
**baseline diffing is not yet implemented**, so treat its screenshots as review
material rather than as a regression test.

---

## 11. Versioning and Deprecation

The design system is a published API even when it ships inside one repo. The
moment two features import the same `Button`, a change to it is a breaking
change to somebody.

### 11.1 What each bump means

| Bump | Examples |
|------|----------|
| **Major** | removing a prop, variant, or token; renaming a part; changing default behaviour; tightening a type; changing an accessible name |
| **Minor** | new component, new optional prop, new variant, new token, a deprecation |
| **Patch** | bug fix matching documented behaviour, visual fix within the contract, perf, docs |

Two that surprise people, both **major**:

- **Changing a default.** `size="md"` to `size="sm"` silently changes every
  call site that relied on the default. That is a break even though no API
  changed.
- **Changing an accessible name.** It breaks every test and every script that
  queries by name, and it changes what a screen-reader user hears.

### 11.2 Deprecation policy

1. **Announce** in the contract with `@deprecated`, naming the replacement and
   the removal version. A deprecation with no named replacement is an
   abandonment.
2. **Warn once per component per session** in development. Never in production.
3. **Keep it working** for at least one minor version — longer for anything with
   many call sites.
4. **Ship a codemod** for any mechanical rename. If the migration is
   find-and-replace, do it for your consumers; if it is not mechanical, write
   the migration note instead.
5. **Remove in the next major**, and list every removal in the changelog.

```tsx
/**
 * @deprecated since 2.5 — use `tone="danger"`. Removed in 3.0.
 * Codemod: npx yuva-codemod button-destructive-to-tone
 */
destructive?: boolean;
```

### 11.3 Changing a contract

The contract is the API, so editing it follows the same rules as editing code.
A contract change needs: the version it lands in, what breaks, the migration
path, and — for anything in §6, §7, §8 or §9 — a reason, because those four are
the sections consumers build on top of.

---

## 12. Worked Example — `DataTable`

The hard case, to prove the template holds. Abbreviated to the sections people
get wrong.

```markdown
# DataTable

## 1. Purpose
Displays a homogeneous collection with sorting, selection and row actions.
Distinct from `Table` (presentational only, no interaction contract).

## 2. Anatomy
root > toolbar > [search, filters, bulkActions]
     > scrollContainer > table > caption
                               > thead > headerRow > headerCell > sortButton
                               > tbody > row > [selectCell, cell..., actionsCell]
     > footer > [selectionSummary, pagination]

## 3. API
| Prop | Type | Default | Req | Notes |
| columns | Column<T>[] | — | yes | `id` must be stable; drives header + cell |
| rows | T[] | — | yes | pre-fetched; DataTable never fetches (Tier 1) |
| getRowId | (row: T) => string | — | yes | index is NOT acceptable; breaks selection on sort |
| state | 'loading'\|'empty'\|'error'\|'partial'\|'populated' | 'populated' | no | §5.3 |
| sort | { id, dir } \| null | — | no | controlled; omit for uncontrolled |
| onSortChange | (s) => void | — | no | required if `sort` is passed |
| selection | string[] | — | no | controlled; row ids |
| onSelectionChange | (ids) => void | — | no | required if `selection` is passed |
| density | 'compact'\|'comfortable' | from brief §4 | no | 32px / 44px rows |
| emptyFlavour | 'never'\|'filtered'\|'denied'\|'done' | 'never' | no | picks the empty action, §5.3 |

## 4. Variants and sizes
density: compact | comfortable. No other axes.
INVALID: `selection` without `getRowId` — throws in development.
INVALID: `sort` without `onSortChange` — warns and behaves read-only.

## 5. States
All five. `partial` keeps rendered rows, appends skeleton rows, and
PRESERVES SCROLL POSITION — this is the one that is always got wrong.
`loading` renders skeleton rows matching `density`, never a centred spinner.

## 6. Interaction contract
- Row click does nothing by default. Row actions are explicit controls.
- Sort is idempotent; third activation clears rather than cycling forever.
- Selection survives sorting and filtering (hence stable `getRowId`),
  and is cleared on a dataset identity change.
- Bulk destructive actions follow §6.3: confirm names the count and
  the object type.
- Search debounced 250ms trailing.

## 7. Keyboard contract
| Key | Action |
| Tab | moves between toolbar, table, footer — NOT cell to cell |
| Space | toggles selection when focus is on a row checkbox |
| Enter | activates the focused control |
| Shift+Click / Shift+Space | extends selection from the last anchor |
This component implements the TABLE pattern, not the GRID pattern:
no arrow-key cell navigation. Deliberate — see §9.5 of the standard,
half a grid is worse than none.

## 8. Accessibility contract
- native `<table>`; `<caption>` required, visually hidden if not shown
- `<th scope="col">`; `aria-sort` on the sorted header only
- the sort control is a `<button>` inside the `<th>`
- row checkbox accessible name names the row: "Select task Deploy api-gateway"
- selection changes announced `polite`: "3 of 240 selected"
- `aria-busy="true"` on the table during `loading` and `partial`
- sticky header must not obscure focus (WCAG 2.2 / 2.4.11): scrolling a
  focused row into view accounts for header height

## 9. Responsive contract
- >=1024px: all columns
- 768-1023px: columns marked `priority: 'low'` move to a row disclosure
- <768px: stacks into cards; `priority: 'high'` columns become the card
  header; selection persists
- 320px: single column stack, horizontal scroll never appears
- 200% zoom: toolbar wraps, rows keep `density`, no clipping
- touch: row actions always visible — never hover-revealed

## 10. Content rules
- cells truncate with ellipsis + `title`; numbers never truncate
- numeric cells right-aligned, `tabular-nums` (designsystem.md §3.3)
- a column with no value renders an em dash, not an empty cell —
  distinguishes "no value" from "render failed"
- RTL: logical properties; numeric alignment flips, numerals do not
- 10x content: cell content wraps to a 2-line clamp, row height grows once
- formatting is the CALLER's job; DataTable renders what it is given

## 11. Composition
MAY contain: Checkbox, Button, IconButton, Badge, Tag, Avatar, Skeleton,
EmptyState, ErrorState, Pagination.
MUST NOT be nested inside: another DataTable, or a Tooltip/Popover.

## 12. Do not
- do not use for a form layout — use Field
- do not use for 2-3 key/value pairs — use a description list
- do not fetch inside it; pass `rows` (Tier 1 rule)
- do not use the array index as `getRowId`; selection breaks on sort
- do not add arrow-key navigation without implementing the full grid pattern
```

---

## 13. Enforcement status

Honest accounting, so this file does not claim authority it lacks:

| Requirement | Enforced by | Status |
|-------------|-------------|--------|
| Contrast ratios | `visual` gate, computed | automated |
| Focus indicator present | `visual` gate, empirical | automated |
| Heading order, image alt | `visual` gate | automated |
| Horizontal overflow | `visual` gate, per viewport | automated |
| Banned generic accent | `visual` gate | automated |
| Colour literal outside `tokens.css` | — | **review only** |
| Component using a primitive token | — | **review only** |
| Off-scale spacing value | — | **review only** |
| axe violations, accessible names | — | **review only** |
| Contract exists for each component | — | **review only** |
| Visual regression baselines | — | **not implemented** |
| 320px and 200% zoom viewports | — | **not in gate defaults** |

Everything marked "review only" is source-lintable and belongs in the gate.
Until it is there, these are review items — and contract §12 is where you point
instead of re-arguing.

---

## 14. References

- `designsystem.md` — the taste layer; §1.0 product brief, §8 the five states
- `frontendstandards.md` — file layout and code organisation
- `frontendstandards.md` — code organisation, and the general testing policy
  that section 10 of this file specialises
- `docs/product-brief.md` — the product definition contracts serve
- `docs/components/<Name>.md` — one contract per component
- `yuva gate visual` — what is actually enforced today
