# ModLens

Reddit-native moderation context for faster, more consistent queue decisions.

ModLens gives subreddit moderators a focused expanded workspace for queue items, user context, shared notes, linked-site history, explainable risk rules, low-noise alerts, removal reason workflows, and optional one-line AI insights.

## What ModLens Helps With

- Review posts and comments in high, aged, and normal triage buckets.
- See author context, including shared mod notes, prior removals, recent subreddit activity, linked sites, and account-level signals.
- Add private author notes and item notes for future moderators.
- Detect external links added after a post or comment is edited.
- Tag linked domains as trusted, watchlist, spammy, or scam.
- Create explainable rules that raise queue priority based on reports, prior removals, domain tags, and edit behavior.
- Use removal reason templates with variables for consistent moderator messaging.
- Review mod log insights, audit history, and recent automated decision reasoning.
- Send optional alerts for backlog, repeat-offender, risky-domain, edited-link, pattern, and modmail events.
- Generate optional short AI moderation insights when configured by the app owner.

## Moderator Actions

ModLens adds moderator-only menu actions:

- **ModLens: Open queue** opens the ModLens launcher; moderators can then open the full review workspace in expanded view.
- **ModLens: View author context** opens notes, recent activity, linked sites, and related moderation history for the selected author.
- **ModLens: Tag linked site** saves a trusted, watchlist, spammy, or scam tag for a linked domain.
- **ModLens: Add author note** saves a shared note about the selected author.
- **ModLens: Add item note** saves private context on the selected post or comment.
- **ModLens: Create risk rule** creates an explainable queue-priority rule.
- **ModLens: Configure alerts** opens alert settings for high-signal moderation events.

## Data Handling

ModLens stores moderation context in Devvit Redis for the subreddit where it is installed. Stored data may include queue items, usernames tied to moderation context, mod notes, item notes, domain tags, rule configuration, alert configuration, recent alerts, mod log summaries, audit entries, and limited post/comment body snapshots used to detect links added after submission.

ModLens uses moderator-scoped Reddit and Devvit permissions because it is a moderation app. Access is intended for authorized subreddit moderators.

## External Services

ModLens can share limited data externally only when optional features are configured:

- **Google Gemini:** Optional AI insights may send compact moderation facts to Gemini. Raw Reddit content is not intentionally sent by the micro-insight adapter.
- **Discord, Slack, or custom webhooks:** Optional alerts may send alert payloads to configured webhook URLs. Payloads can include moderation context such as queue links, usernames, domains, report context, modmail snippets, and item identifiers.

If these features are not configured, ModLens does not send those optional external requests.

## Privacy

ModLens does not sell personal information and does not use moderation information for advertising. Moderators should avoid entering unnecessary sensitive personal information into notes, domain notes, rule names, removal templates, or alert settings.

For full details, see the linked Privacy Policy and Terms and Conditions on the app listing.

## Intended Users

ModLens is built for subreddit moderation teams that need clearer queue context, shared memory, and repeatable decision support. It is not a replacement for moderator judgment. Moderators remain responsible for reviewing content and applying subreddit rules, Reddit policies, and applicable law.

## Support

For questions or support, contact dev@maybecoded.com.
