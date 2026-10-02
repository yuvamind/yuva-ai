/**
 * Starter behaviour tests, scaffolded by `yuva e2e init`.
 *
 * These are deliberately the checks that `componentcontracts.md` section 13 used
 * to list as "review only" — the ones a screenshot cannot make. Replace the
 * goals with your own, taken from:
 *
 *   docs/product-brief.md   P3 (the critical workflow) and P7 (dangerous actions)
 *   docs/components/*.md    C5 (states), C6 (interaction), C7 (keyboard), C8 (a11y)
 *
 * Write the goal as an OUTCOME, not a click path: "upgrade the workspace to Pro",
 * not "click Settings then Billing then Upgrade". A path breaks the moment the
 * UI moves; an outcome survives, and the recorded steps replay from cache until
 * the app actually changes.
 */

import { test, expect } from 'e2e';

test('the critical workflow completes', async ({ app, agent, screen }) => {
  // Product brief P3. Replace with the real one — this is the single test most
  // worth having, because it is the thing the product exists to do.
  await app.open('/');

  await agent.act('complete the primary task this page exists for');
  await agent.assert('the result of that task is visible and looks successful');

  await expect(screen.getByRole('status')).toBeVisible();
});

test('the workflow is completable with the keyboard alone', async ({ app, agent }) => {
  // Contract C7. This is the check a screenshot cannot make, and the reason
  // this suite exists alongside `yuva gate visual`.
  await app.open('/');

  await agent.act('complete the same primary task using only the keyboard, never the mouse');
  await agent.assert('every control that was activated showed a visible focus indicator at the time');
});

test('a dialog returns focus to the control that opened it', async ({ app, agent }) => {
  // Contract C8. Dropping focus restoration strands keyboard users at the top of
  // the document after every interaction, and nothing about the page LOOKS wrong.
  await app.open('/');

  await agent.act('open a dialog, then close it with the Escape key');
  await agent.assert('keyboard focus returned to the control that opened the dialog');
});

test('an empty result offers the action that resolves it', async ({ app, agent }) => {
  // Contract C5. An empty state after filtering should offer "clear filters",
  // not "create new" — see designsystem.md section 8.
  await app.open('/');

  await agent.act('filter or search for something that returns no results');
  await agent.assert('the empty state explains why it is empty and offers a way out of it, '
    + 'and that way out matches the cause — clearing the filter rather than creating a record');
});

test('a destructive action cannot be triggered by accident', async ({ app, agent }) => {
  // Product brief P7. Skip this test if the product has no destructive action —
  // delete the test rather than leaving it to pass vacuously.
  await app.open('/');

  await agent.assert('any irreversible action is visually distinct from the safe actions '
    + 'by more than colour alone, and is not the default focus target');
});
