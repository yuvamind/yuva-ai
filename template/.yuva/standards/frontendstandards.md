# Frontend Standards

Where frontend code lives and how it is written.

| File | Answers |
|------|---------|
| `designsystem.md` | What should it look like? (taste) |
| `componentcontracts.md` | How must a component behave? (contracts) |
| **this file** | Where does the code live, and how is it written? |

## Rule strength — read this first

Every rule below is tagged. Treating all three as equal is how a standard turns
into ceremony.

| Tag | Meaning |
|-----|---------|
| **[MUST]** | Correctness, security or accessibility. A violation is a defect. |
| **[SHOULD]** | Convention. Consistency is the only argument for it; deviate locally with a reason. |
| **[MAY]** | Architecture option. Pick per project; no option here is wrong. |

There are far fewer **[MUST]** rules than you expect. That is deliberate.

## Framework

This standard's core is framework-neutral. Framework-specific guidance lives in
the adapters in §9, and **the framework is declared per project** — in the
architecture constraints the Design agent receives — never assumed by this file.

If no framework has been chosen yet, that is a Planner decision, not a default
to inherit from a document.

---

## 1. Directory layout

### 1.1 The tier mapping **[MUST]**

`componentcontracts.md` §2 defines three component tiers with a dependency rule:
a component may only depend on lower tiers, and only Tier 2 may touch the
network. Directories must make that rule visible, or it will be violated
silently.

```
src/
├── components/
│   ├── ui/              # Tier 0 — primitives. No domain, no network.
│   │   └── button.*     #   Button, Input, Badge, Spinner, …
│   └── ...              # Tier 1 — compositions. No domain, no network.
│                        #   Dialog, Tabs, DataTable, EmptyState, …
├── features/
│   └── <feature>/       # Tier 2 — patterns. Domain-aware; MAY fetch.
│       ├── components/  #   TaskQueue, AgentRoster, …
│       └── api.*        #   the only place network calls belong
├── layouts/             # shells: Header, Sidebar, PageFrame
├── hooks/               # cross-feature hooks only; feature hooks live in the feature
├── lib/                 # pure helpers, no framework imports
├── styles/
│   └── tokens.css       # THE token file — see §4
└── types/
```

Two rules this layout enforces:

1. **[MUST]** Nothing in `components/` imports from `features/`. If a primitive
   needs domain knowledge, the knowledge belongs in a prop.
2. **[MUST]** Network access lives in `features/*/api.*` (or a dedicated data
   layer). A component in `components/` that fetches is misfiled, not just
   impure.

### 1.2 Documentation layout **[MUST]**

Design artifacts are agent-authored and live outside `.yuva/`, which is
framework config and write-protected:

```
docs/
├── product-brief.md         # who, what job, what is dangerous  (P1–P10)
├── design-brief.md          # the visual brief                  (B1–B8)
├── design-contract.json     # the machine-readable handoff
└── components/
    └── <ComponentName>.md   # one contract per component         (C1–C12)
```

### 1.3 Co-location **[SHOULD]**

Keep a component's test and styles beside it. Whether that is a flat file or a
folder is **[MAY]**:

```
button.tsx  button.test.tsx  button.module.css      # flat — fine
button/ { index.ts, button.tsx, button.test.tsx }   # folder — also fine
```

A folder per component earns its keep once a component has three or more files.
Below that it is ceremony. **One component per file is [SHOULD], not [MUST]** —
a 12-line `ButtonGroup` next to `Button` is often clearer colocated.

---

## 2. Naming

`componentcontracts.md` §3 is the authority for component, prop, CSS-part and
token naming. It is not repeated here. What that file does not cover:

| Thing | Convention | Strength |
|-------|------------|----------|
| Component file | matches the component name | **[SHOULD]** |
| Hook | `use` + noun or verb | **[MUST]** (framework linters rely on it) |
| Pure helper | camelCase verb phrase | **[SHOULD]** |
| Constant module | the domain noun, not `CONSTANTS` | **[SHOULD]** |
| Type / interface | PascalCase, no `I` prefix | **[SHOULD]** |
| Test | `<name>.test.*` beside the subject | **[SHOULD]** |

File-name casing (PascalCase.tsx vs kebab-case.tsx) is **[MAY]** — pick one
per project and hold it. Mixing the two in one tree is the actual defect.

---

## 3. Component structure

### 3.1 Semantics come first **[MUST]**

```jsx
// MUST — a real button: focusable, Enter/Space activated, announced as a button
<button type="button" onClick={() => onSelect(user.id)}>
  {user.name}
</button>

// DEFECT — not focusable, not keyboard-operable, announced as nothing
<div onClick={() => onSelect(user.id)}>{user.name}</div>
```

The second form is flagged by `yuva gate visual` (`div-as-button`) and is a
defect under `designsystem.md` §13. `<button>` for actions, `<a href>` for
navigation. Adding `role="button"` and `tabIndex={0}` to a `div` reimplements
what the element already does, and usually forgets Space.

Always set `type` on a button. The default is `submit`, which silently posts the
enclosing form.

### 3.2 Props **[MUST]**

- Required props have no default. Optional props have one.
- Never spread unknown props onto a DOM node without declaring it in the
  contract's §3 escape-hatch line — it is how invalid attributes reach the HTML.
- A boolean prop defaults to `false`. If you want a default-on behaviour, name
  the prop for its off state instead of defaulting a boolean to `true`.

### 3.3 Derived state is not state **[MUST]**

```js
// DEFECT — two sources of truth that will disagree
const [items, setItems] = useState([]);
const [filtered, setFiltered] = useState([]);

// MUST — derive it
const filtered = items.filter(item => item.active);
```

Memoise the derivation only when profiling says to (§5).

### 3.4 Never mutate inputs **[MUST]**

```js
// DEFECT — sort() mutates in place; callers observe a reordered array
const sorted = items.sort((a, b) => a.name.localeCompare(b.name));

// MUST — copy first
const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
```

`sort`, `reverse`, `splice`, `push`, `fill` and `copyWithin` all mutate.
`toSorted`, `toReversed`, `toSpliced` and `with` do not, where available.

### 3.5 Conditional rendering **[MUST]** on one point

```jsx
// MUST — guard with a boolean, not a value
{user !== null ? <UserProfile user={user} /> : null}

// DEFECT — renders "0" when count is 0, and "" when name is empty
{count && <Badge value={count} />}
```

`&&` leaks falsy non-boolean operands into the output. This is the single most
common rendering bug in React codebases.

Early returns for loading/error/empty are **[SHOULD]** and usually read best.
Nested ternaries are **[SHOULD NOT]** — extract a function.

---

## 4. Styling

### 4.1 Tokens **[MUST]**

`src/styles/tokens.css` (the default) is the only file that may contain colour
literals. Its actual path is declared in `docs/design-contract.json`, so nothing
hardcodes it.

Components reference **semantic** tokens (`var(--text-muted)`), never
**primitive** ones (`var(--n-500)`). `componentcontracts.md` §7 is the authority
on the three token tiers and on governance.

### 4.2 Strategy **[MAY]**

CSS Modules, Tailwind, vanilla-extract, plain CSS and CSS-in-JS are all
acceptable. Three constraints, whichever you pick:

1. **[MUST]** It consumes the token file rather than redeclaring values. With
   Tailwind that means mapping tokens into the theme — Tailwind with its default
   palette is how generic UI reappears after the design work is done.
2. **[MUST]** Static extraction if the project is SSR. Runtime CSS-in-JS costs a
   hydration round-trip and a flash.
3. **[SHOULD]** One strategy per project. The real defect is two components at
   the same tier styled by different mechanisms.

Pick once, record it in the design brief, and do not mix.

### 4.3 Layout and responsiveness

`designsystem.md` §4 and §5 are the authority — including the spacing scale, the
layout archetypes, and intrinsic responsiveness (`clamp`, `auto-fit`, `min()`)
in preference to breakpoint cascades.

**This file deliberately prescribes no breakpoint table.** A fixed
`sm/md/lg/xl` ladder pushes every project toward the same layout, and the
container-relative behaviour most components actually need is a container query,
not a viewport one. Where explicit breakpoints *are* needed — sidebar collapse,
column priority, modal sizing — they are per-component decisions recorded in that
component's contract §9, which also requires stating 320px and 200%-zoom
behaviour.

Class naming is **[SHOULD]**: semantic over presentational (`.user-card__avatar`,
not `.red-text`), except inside a utility framework where that is the point.

---

## 5. Performance

### 5.1 Measure first **[MUST]**

Every optimisation below is **[MAY]** until a profile justifies it. Applied
reflexively, memoisation makes code slower and harder to read: each memo costs a
dependency comparison plus retained memory, and a wrong dependency array
produces a stale-value bug that is much more expensive than the render it saved.

In particular, **`memo`, `useCallback` and `useMemo` are [MAY], never [SHOULD]**.
Reach for them when a profile shows a specific component re-rendering expensively
— not as a default style. Modern framework compilers increasingly make them
unnecessary.

### 5.2 Rules that pay off without measuring **[MUST]**

- Stable, meaningful list keys — never the array index for a reorderable list.
- `width`/`height` (or `aspect-ratio`) on every image, to prevent layout shift.
- Code-split by route.
- Lazy-load anything heavy and below the fold.
- Animate only `transform` and `opacity` (`designsystem.md` §7.3); for geometry
  changes see §7.5 there.
- Virtualise lists past a few hundred rows — which means knowing the row count
  from product brief P6.

### 5.3 Budgets **[SHOULD]**

Set them in the design brief and check them in CI. Use the bundler's own
analyser (`rollup-plugin-visualizer` for Vite/Rollup,
`webpack-bundle-analyzer` for Webpack, `@next/bundle-analyzer` for Next) — not a
tool from a bundler you are not using.

---

## 6. Accessibility

`componentcontracts.md` §9 is the authority, including the **WCAG 2.2 AA**
target, per-component contracts, dialog semantics and focus restoration. The
floor, restated because it is violated most often:

- **[MUST]** Semantic element for the job; `<div onClick>` is a defect (§3.1).
- **[MUST]** Every input has a programmatically associated `<label>`.
- **[MUST]** Every icon-only control has an accessible name. This is the most
  common real-world failure in shipped UI.
- **[MUST]** Visible `:focus-visible` indicator. `outline: none` with no
  replacement is a defect.
- **[MUST]** One `<h1>`; heading levels never skip.
- **[MUST]** Contrast per `designsystem.md` §2.4 — 4.5:1 body text, 3:1 large
  text (≥24px, or ≥18.66px bold), 3:1 for meaningful borders and icons. A flat
  "4.5:1 everywhere" is both wrong and unachievable for large display type.
- **[MUST]** Never convey state by colour alone.
- **[MUST]** Keyboard-operable: logical tab order, `Escape` closes overlays,
  focus trapped in modals and **restored** to the trigger on close.
- **[MUST]** Test at 320px width and 200% zoom.

```jsx
// MUST — icon-only control carries its own name
<button type="button" aria-label="Close dialog" onClick={onClose}>
  <CloseIcon aria-hidden="true" />
</button>
```

Mark decorative icons `aria-hidden="true"`, or their glyph name gets announced.

---

## 7. Data, forms and errors

### 7.1 The data boundary **[MUST]**

Network access lives in the feature layer (§1.1). Components receive data as
props or through a declared data hook. This is what makes Tier 0 and Tier 1
testable without mocking a transport.

### 7.2 Every data surface implements five states **[MUST]**

`loading`, `empty`, `error`, `partial`, `populated` — per `designsystem.md` §8
and `componentcontracts.md` §5.3. `partial` must preserve scroll position.

These are **data-surface** states. Controls have **interaction** states instead
(default, hover, focus, active, disabled, busy). A button has no `empty` state
and a divider has neither set; do not apply the five-state rule universally.

### 7.3 Forms **[MUST]**

- Validate on blur for feedback, on submit for correctness, and on the server
  for security. Client validation is UX, never a control.
- Associate each error with its field (`aria-describedby`) so it is announced
  where focus already is.
- Block re-submission while a submit is in flight — the `pending` state in
  `componentcontracts.md` §5.1. A double-clickable submit button is a defect,
  not a race for the backend to absorb.
- Never clear a user's input on a failed submit.

A form library is **[MAY]**. Hand-rolled is fine until you need field arrays or
cross-field validation.

### 7.4 Errors **[MUST]**

```js
// MUST — a fetch Response carries the status; a thrown Error does not
const response = await fetch(url);
if (!response.ok) {
  if (response.status === 401) return redirectToLogin();
  if (response.status === 404) return setState({ kind: 'empty' });
  throw new HttpError(response.status, await safeText(response));
}
```

`fetch` rejects only on network failure, so a bare `try/catch` around it treats
a `500` as success. Check `response.ok` explicitly.

- **[MUST]** Show what failed, in plain language, with a retry affordance. Never
  a raw stack trace, never a bare "Something went wrong".
- **[MUST]** An error boundary at each route, so one broken subtree does not
  blank the application. It must *report* the error, not only render a fallback —
  a boundary that swallows silently is worse than a crash, because nobody learns.
- **[SHOULD]** Distinguish *expected* failures (404, 403, validation), which are
  states, from *unexpected* ones, which are errors.

---

## 8. Security **[MUST]**

- Never interpolate untrusted input as HTML (`dangerouslySetInnerHTML`,
  `innerHTML`, `v-html`, `{@html}`). If you must render rich text, sanitise with
  a maintained library and allowlist.
- Never put tokens or secrets in `localStorage` or `sessionStorage` — any XSS
  reads them. Use httpOnly, `Secure`, `SameSite` cookies.
- Treat every client-side check as advisory; authorise on the server.
- Never interpolate user input into a URL that is then navigated to without
  validating the scheme (`javascript:` is a live XSS vector in `href`).
- Only `NEXT_PUBLIC_`-style prefixed env vars reach the client bundle. Verify
  before adding one — build tools inline these literally.

---

## 9. Framework adapters

The core above is framework-neutral. Everything specific lives here, and applies
only to the framework the project actually declared.

### 9.1 React + TypeScript

- **[SHOULD]** Function components. Type props with an explicit interface rather
  than `React.FC`, which adds an implicit `children` and blocks generics.
- **[MUST]** Hook rules: top level only, never conditional, and the dependency
  array is complete. Enable `eslint-plugin-react-hooks` — this is the one lint
  that catches real bugs rather than style.
- **[SHOULD]** A consistent hook order within a component (state → context →
  custom hooks → refs → effects → handlers). Consistency is the whole benefit;
  there is nothing correctness-bearing about the order itself.
- **[MUST]** An effect's job is synchronising with something external. Deriving
  values in an effect and storing them in state causes a second render and a
  frame of stale UI — derive inline instead (§3.3).
- **[MUST]** Clean up subscriptions, timers and listeners in the effect's return.
  Abort in-flight requests on unmount.
- **[MAY]** `memo` / `useCallback` / `useMemo` — see §5.1.
- **[MAY]** State management: local state and context for most things; a store
  (Zustand, Redux Toolkit, Jotai) when genuinely global, mutable, cross-cutting
  state exists. Server state belongs in a query library, not a store.

### 9.2 Vue 3

- **[SHOULD]** Composition API with `<script setup>`.
- **[MUST]** `v-for` requires a stable `:key`; never the index for reorderable
  lists.
- **[MUST]** Never `v-html` with untrusted input (§8).
- **[SHOULD]** `computed` for derivation; `watch` only for genuine side effects.
- **[MUST]** Props are read-only — emit an event instead of mutating.

### 9.3 Svelte 5

- **[SHOULD]** Runes (`$state`, `$derived`, `$effect`) in new code.
- **[MUST]** `$derived` for derivation, never `$effect` writing back to state —
  that creates a loop.
- **[MUST]** Never `{@html}` with untrusted input (§8).
- **[MUST]** Keyed `{#each}` for reorderable lists.

### 9.4 Adding an adapter

A new adapter states: component declaration style, reactivity/derivation rules,
effect-cleanup rules, the list-key rule, the untrusted-HTML escape hatch to
avoid, and the linter that enforces its hook/reactivity rules. Nothing else from
the core needs restating.

---

## 10. Testing

### 10.1 Runner **[MUST]**

**Use the repository's existing test runner.** Do not introduce a second one;
two runners means two configs, two environments and two sets of globals. If the
existing runner genuinely cannot do the job, that is a Planner decision with a
migration, not a new dev-dependency.

*This repository runs Vitest* (`vitest.config.js`, `npm test`). A standard that
named a specific runner is how an agent ends up installing Jest beside it.

### 10.2 What to test **[MUST]**

`componentcontracts.md` §10 is the authority — it lists the required tests per
component and the query rules. The two that matter most:

- **Query by role and accessible name** (`getByRole('button', { name: 'Save' })`).
  That single habit tests the accessibility contract on every assertion.
- **Assert on `data-state` / `data-variant`, never on class names.** Class names
  are styling; state attributes are contract.

```js
// MUST — tests the contract
expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

// DEFECT — tests the implementation; breaks on every refactor
expect(wrapper.state().isLoggedIn).toBe(true);
```

### 10.3 What not to test **[SHOULD]**

Internal state, that a child was called with particular props, exact class
names, or snapshot blobs nobody reads. Each is a refactor waiting to break a
green suite.

---

## 11. Tooling **[SHOULD]**

- A linter with the framework's own rules enabled (for React,
  `eslint-plugin-react-hooks` is **[MUST]** — it catches bugs, not style).
- A formatter, run in CI. Which one is **[MAY]**; arguing about it is not.
- TypeScript `strict: true` if the project is TypeScript. Opting out of `strict`
  keeps the syntax and discards most of the value.
- Pre-commit hooks are **[MAY]** — useful, and not a substitute for CI, which is
  the gate that cannot be bypassed with `--no-verify`.

---

## 12. References

- `designsystem.md` — taste: colour, type, spacing, layout, motion, states
- `componentcontracts.md` — behaviour: the 12-section contract, tiers, tokens,
  accessibility, testing, versioning
- `docs/design-contract.json` — the machine-readable handoff, including the
  declared token path and UI source globs
- `yuva gate visual` — what is actually enforced automatically
