/**
 * e2e configuration — https://e2e.tester.army/docs/reference/config.md
 *
 * Scaffolded by `yuva e2e init`. Yuva reads the RESULTS of this suite; it does
 * not own this file, so edit it freely.
 *
 * What this suite is for, in Yuva's terms: the `visual` gate checks what the UI
 * looks like. This checks what it DOES — the keyboard contract (C7), focus
 * restoration (C8), and the five data states (C5) that `componentcontracts.md`
 * section 13 could not previously enforce.
 *
 * Auth: the model below comes from `yuva e2e init`, which prefers a SUBSCRIPTION
 * you already pay for over an API key — Yuva drives AI CLIs, so the behaviour
 * suite should not need a second, per-token way to pay for the same work. Sign in
 * with `yuva e2e login <openai|github-copilot|spacexai>`; Copilot serves OpenAI,
 * Anthropic, Google and xAI models over one login, and is how a Claude Code user
 * reaches Anthropic models without a key (e2e has no Claude subscription
 * support). `yuva e2e models <provider>` lists what the plan actually serves.
 *
 * Cost note: an `agent.act` step calls a model the first time, and again
 * whenever the app changes enough to invalidate the recording. Verified steps
 * replay from cache with no model calls otherwise. `e2e cache stats` shows what
 * is cached; a bill that keeps climbing usually means something invalidates the
 * cache on every run.
 */

import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

// __MODEL_IMPORT__

export default {
  targets: [
    {
      name: 'web',
      engine: web({ browser: 'chromium' }),
      app: {
        // Point this at however the app is served. Match the `visual` gate's
        // url in .yuva/config.json so both gates test the same thing.
        url: process.env.APP_URL ?? '__APP_URL__',
      },
    },
  ],

  // Default is `tests/**/*.e2e.ts`. Keep behaviour tests apart from unit tests:
  // these are slow, cost money, and should not run on every save.
  tests: 'tests/e2e/**/*.e2e.ts',

  agents: {
    // __MODEL_COMMENT__
    default: { model: __MODEL_EXPR__ },
  },

  // `read-write` locally so new steps get recorded; `read-only` in CI so a run
  // never silently starts spending because the cache went stale. That is the
  // framework default and it is the right one — overriding it in CI is how an
  // unattended pipeline runs up a bill.
  // cache: 'read-write',

  reporters: ['list'],

  // Where traces, screenshots and the report land. Add this to .gitignore.
  output: '.e2e',
} satisfies E2EConfig;
