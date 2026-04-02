# User Testing

Testing surface discovery, required tools, and resource cost classification.

---

## Validation Surface

### Surface 1: Server API (vitest + supertest)
- **Tool:** vitest (unit and integration tests)
- **What:** Service layer methods, route handlers, CLI wrapper
- **Setup:** `pnpm install` then `pnpm test:run` from junoclip root
- **Notes:** Tests mock the Stripe CLI subprocess — no real Stripe auth needed for unit tests

### Surface 2: UI (agent-browser)
- **Tool:** agent-browser
- **What:** Infrastructure tab on ProjectDetail, catalog dialog, service management
- **URL:** http://localhost:3100
- **Setup:** Start dev server with `pnpm dev` from junoclip root
- **Auth:** Board session required (create via onboarding flow)

### Surface 3: CLI (tuistory)
- **Tool:** tuistory
- **What:** `paperclipai stripe-projects` subcommands
- **Setup:** Server must be running on localhost:3100. CLI uses PaperclipApiClient.
- **Auth:** CLI auth context required

## Validation Concurrency

**Machine:** 64GB RAM, 10 CPU cores

### vitest surface
- Max concurrent: **5** (test runner manages its own parallelism, lightweight per-test)
- Rationale: Node.js vitest workers use ~200MB each. 5 * 200MB = 1GB, well within budget.

### agent-browser surface
- Max concurrent: **5**
- Rationale: Dev server ~300MB + each browser instance ~300MB. 5 * 300MB + 300MB = 1.8GB. Well within 64GB budget.

### tuistory surface
- Max concurrent: **3**
- Rationale: Each CLI session is lightweight but shares the server. Conservative to avoid race conditions on shared server state.
