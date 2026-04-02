# Architecture — Stripe Projects Integration

## Overview

This integration adds Stripe Projects CLI wrapping as a core service in Paperclip. The server spawns `stripe projects <cmd> --json -y` as a child process, parses structured output, and maps results into Paperclip's existing DB schema and secrets system.

## Components

### CLI Wrapper (`server/src/services/stripe-projects-cli.ts`)
- Thin utility: `execStripeProjectsCmd(subcommand, args, options?)` 
- Spawns `stripe projects <subcommand> <args> --json -y` via `child_process.spawn`
- Returns parsed JSON stdout on success
- Throws typed errors on: non-zero exit (with stderr), timeout, malformed JSON, missing CLI binary
- Configurable timeout (default 30s), injectable spawn function for testing
- All output logged with credential redaction

### Service Layer (`server/src/services/stripe-projects.ts`)
- Factory function: `stripeProjectsService(db: Db)`
- Methods: init, catalog, addService, removeService, status, syncCredentials, rotateCredentials, listServices
- Coordinates CLI wrapper calls with DB persistence
- Credential sync: parses env output → upserts into company_secrets via secretService
- All operations validate preconditions (connection exists, service exists) before CLI calls
- Atomic behavior: CLI failure → no DB mutation (no orphaned records)

### DB Schema (`packages/db/src/schema/stripe_project_connections.ts`)
- `stripe_project_connections`: id, companyId, projectId (FK to projects), stripeProjectName, stripeProjectDir (path to .projects/), status, createdAt, updatedAt. Unique on (companyId, projectId).
- `stripe_provisioned_services`: id, connectionId (FK to connections), providerService (e.g. "vercel/project"), provider, serviceType, tier, status, resourceMetadata (jsonb), provisionedAt, createdAt, updatedAt.
- Both tables cascade delete from parent.

### API Routes (`server/src/routes/stripe-projects.ts`)
- Mounted under `/api` via `api.use(stripeProjectRoutes(db))`
- Company-scoped with `assertCompanyAccess`
- Board-only for mutations via `assertBoard`
- Catalog is read-only (accessible to all company members)
- All mutations logged via `logActivity`
- Request validation via zod schemas

### Shared Types (`packages/shared/src/types/stripe-projects.ts`)
- TypeScript interfaces for all domain objects
- Zod schemas for request validation
- Exported from shared package index

### UI (`ui/src/pages/StripeProjects.tsx` + related)
- "Infrastructure" tab on ProjectDetail page
- API hooks in `ui/src/api/stripe-projects.ts`
- Query keys in `ui/src/lib/queryKeys.ts`
- Components: ServiceCatalogDialog, ServiceList, ServiceCard

### CLI Commands (`cli/src/commands/client/stripe-projects.ts`)
- Subcommands: catalog, init, status, add, sync, remove
- Uses PaperclipApiClient for server communication
- Formatted terminal output with picocolors

## Data Flow

```
User action (UI/CLI)
  → API Route (validate, auth, log)
    → Service method (precondition check)
      → CLI wrapper (spawn stripe CLI, parse JSON)
      → DB write (connection or service record)
      → Secret sync (for credential operations)
    ← Return domain object
  ← HTTP response
← UI update / CLI output
```

## Key Invariants

1. **No DB write without successful CLI call** — if the CLI fails, no row is inserted/updated/deleted
2. **Company-scoped isolation** — all queries filter by companyId, enforced at route + service level
3. **Board-only mutations** — only board members can provision/modify infrastructure
4. **Credential redaction** — secrets never appear in logs
5. **One connection per project** — unique constraint on (companyId, projectId)
6. **CLI flags always appended** — every CLI invocation includes --json -y for non-interactive JSON output
