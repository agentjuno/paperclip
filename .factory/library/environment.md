# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## External Dependencies

- **Stripe CLI** v1.36+ with Projects plugin installed (`stripe plugin install projects`)
- **Stripe authentication** via `stripe login` (stored in `~/.config/stripe/config.toml`)
- **Provider accounts** linked via `stripe projects link <provider>` (browser OAuth, one-time human step)

## Environment Variables

No new env vars required for the integration. The Stripe CLI uses its own auth config at `~/.config/stripe/config.toml`.

## Platform Notes

- macOS: Stripe CLI installed via Homebrew (`brew install stripe/stripe-cli/stripe`)
- The `stripe projects` plugin is a separate install: `stripe plugin install projects`
- Provider linking requires browser access (OAuth popup) — cannot be automated
