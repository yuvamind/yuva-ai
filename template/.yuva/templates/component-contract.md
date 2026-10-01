# <ComponentName>

<!--
Copy to docs/components/<ComponentName>.md and fill in every section.

This is the SPEC, not the documentation — write it BEFORE the implementation.
All twelve sections are required. "None" and "no change" are valid answers and
must be written explicitly: an unstated answer is an oversight, a stated one is
a claim somebody can test.

Rules: .yuva/standards/componentcontracts.md
Tier:  0 primitive | 1 composition | 2 pattern  (see §2 of that file)
-->

**Tier:** 0 | 1 | 2
**Status:** draft | stable | deprecated (since X.Y, use `<Replacement>`)
**Since:** X.Y

## C1. Purpose

One sentence: what job does this do that no existing component does?
If you cannot answer the second half, you are duplicating something.

## C2. Anatomy

Named parts, outermost first. These names are binding — they become class
names, slot names, and test selectors.

```
root > ... > ...
```

## C3. API

| Prop | Type | Default | Required | Notes |
|------|------|---------|----------|-------|
|      |      |         |          |       |

Escape hatches: state `className` / `...rest` / `ref` forwarding explicitly, or
state that there are none.

## C4. Variants and sizes

The closed set — actual values, not "primary | etc".

- `variant`:
- `size`:

**Invalid combinations** and what happens if one is requested:

## C5. States

Which of `idle` / `pending` / `settled` / `error` apply, and for each: what
changes visually, what changes behaviourally.

Controlled, uncontrolled, or dual (§5.2 — pick one):

Data states, if this displays fetched data (`loading` / `empty` / `error` /
`partial` / `populated`), and which component renders each:

Empty flavour, if applicable (never-had-data / filtered / denied / done):

## C6. Interaction contract

- Pointer:
- Touch (remember: no hover):
- Idempotent under double-activation? If not, how is re-entry blocked:
- Debounce / throttle:
- Destructive? If so, the §6.3 protocol applied:
- Offline / failure behaviour:

## C7. Keyboard contract

| Key | Action |
|-----|--------|
|     |        |

If this component handles no keys, say so explicitly — that is a claim.

## C8. Accessibility contract

- Role / element:
- Accessible name comes from:
- `aria-label` for icon-only controls (mandatory if any):
- ARIA state attributes, and what changes them:
- Focus: on open / on close / on item removal:
- Announcements: what, which region, which politeness:
- WCAG 2.2 AA exceptions, with reason and mitigation:

## C9. Responsive contract

| Context | Behaviour |
|---------|-----------|
| >=1024px |  |
| 768-1023px |  |
| <768px |  |
| **320px** |  |
| **200% zoom** |  |
| landscape phone |  |
| touch |  |

"No change" is a valid answer everywhere, and must be written.

## C10. Content rules

- Min / max length, truncation behaviour:
- No content:
- 10x expected content:
- RTL (logical properties; which icons mirror):
- Long-text (tested at 2x English):
- Number / date formatting — does this component format, or expect formatted input?

## C11. Composition

- MAY contain:
- MAY be contained by:
- MUST NOT be nested inside:

## C12. Do not

The three or four misuses you expect, named — so reviewers link here instead of
re-arguing.

-
-
-
