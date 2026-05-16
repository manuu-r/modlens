# ModLens

Reddit-native context for queue decisions.

ModLens helps moderators review queue items with author context, shared notes, linked-site evidence, searchable mod log history, explainable risk rules, low-noise alerts, and optional one-line AI insights.

## What It Does

- Opens a focused queue review surface for high, aged, and normal items.
- Shows author notes, removals, recent activity, linked sites, and focused author context.
- Parses post URLs into sites and lets mods tag sites as trusted, watchlist, spammy, or scam.
- Provides searchable mod log context and lightweight team activity insights.
- Supports explainable risk rules for repeat offenders, site risk, and queue patterns.
- Sends low-noise alerts for backlog, repeat-offender, and bad-site signals.

## Moderator Actions

- ModLens: Open queue - Open the review queue with risk reasons and author/site context.
- ModLens: View author context - Open ModLens focused on the author of the selected post or comment.
- ModLens: Tag linked site - Review the linked site and apply a moderation tag.
- ModLens: Add author note - Save a shared note that appears in future author context.
- ModLens: Create risk rule - Create an explainable rule from the selected queue item.
- ModLens: Configure alerts - Open alert settings for high-signal moderation events.

## Privacy and AI

ModLens stores moderation context in Redis for the installed subreddit. Gemini AI is optional and only receives compact moderation facts for short one-line insights; raw Reddit content is not sent by the micro-insight adapter.

## Development

- `pnpm run dev`: Start Devvit playtest mode.
- `pnpm run build`: Build the web app.
- `pnpm run type-check`: Run TypeScript checks.
- `pnpm run lint`: Run ESLint.
- `pnpm run test`: Run Vitest.
- `pnpm run deploy`: Type-check, lint, test, and upload a new Devvit version.
- `pnpm run launch`: Upload and publish for review.
