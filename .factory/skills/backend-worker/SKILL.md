---
name: backend-worker
description: Implements server-side features (DB schema, services, routes, shared types) with TDD
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:
- Database schema (Drizzle ORM tables in `packages/db/src/schema/`)
- Server services (factory functions in `server/src/services/`)
- Express routes (in `server/src/routes/`)
- Shared types and validators (`packages/shared/src/types/`, `packages/shared/src/validators/`)
- CLI wrapper utilities
- Unit and integration tests for all of the above

## Required Skills

None (no browser or terminal UI testing needed).

## Work Procedure

1. **Read the feature description** carefully. Understand preconditions, expected behavior, and verification steps.

2. **Read existing patterns** before writing any code:
   - For DB schema: read an existing schema file (e.g., `packages/db/src/schema/projects.ts`) and `packages/db/src/schema/index.ts`
   - For services: read an existing service (e.g., `server/src/services/projects.ts`) for the factory function pattern
   - For routes: read an existing route file (e.g., `server/src/routes/projects.ts`) for middleware, validation, and registration patterns
   - For shared types: read `packages/shared/src/types/index.ts` and an existing type file
   - For tests: read an existing test file in `server/src/__tests__/` for the test setup pattern (supertest, embedded postgres helper, etc.)

3. **Write tests first (RED)**:
   - Create test file(s) in `server/src/__tests__/` following the naming convention `<feature>.test.ts`
   - Write failing tests that cover the feature's expected behavior
   - For service tests: mock the CLI wrapper (do NOT call real Stripe CLI)
   - For route tests: use supertest against the express app
   - Run tests to confirm they fail: `cd junoclip && pnpm --filter @paperclipai/server exec vitest run <test-file>`

4. **Implement (GREEN)**:
   - Write the minimal implementation to make tests pass
   - Follow existing patterns strictly (factory functions, error types, etc.)
   - For DB schema: export from `schema/index.ts`, add migration
   - For services: export from `services/index.ts`
   - For routes: register in `app.ts`
   - For shared types: export from shared package index

5. **Verify**:
   - Run the specific test file: `cd junoclip && pnpm --filter @paperclipai/server exec vitest run <test-file>`
   - Run full server test suite: `cd junoclip && pnpm --filter @paperclipai/server exec vitest run`
   - Run typecheck: `cd junoclip && pnpm typecheck`

6. **Manual verification** (for route features):
   - Start the dev server: `cd junoclip && pnpm dev:once`
   - Use curl to hit the new endpoints and verify responses
   - Stop the dev server when done

## Example Handoff

```json
{
  "salientSummary": "Implemented stripeProjectsService with init, catalog, addService methods and CLI wrapper utility. Wrote 18 tests covering success paths, error handling, and precondition validation. All tests pass, typecheck clean.",
  "whatWasImplemented": "Created packages/db/src/schema/stripe_project_connections.ts with two tables (stripe_project_connections, stripe_provisioned_services). Created server/src/services/stripe-projects-cli.ts CLI wrapper with execStripeProjectsCmd(). Created server/src/services/stripe-projects.ts service factory with init, catalog, addService, removeService, listServices. Exported from services/index.ts. Added shared types in packages/shared/src/types/stripe-projects.ts.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd junoclip && pnpm --filter @paperclipai/server exec vitest run src/__tests__/stripe-projects.test.ts", "exitCode": 0, "observation": "18 tests pass, 0 failures" },
      { "command": "cd junoclip && pnpm typecheck", "exitCode": 0, "observation": "No type errors across all workspaces" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {
        "file": "server/src/__tests__/stripe-projects.test.ts",
        "cases": [
          { "name": "init creates connection and stores in DB", "verifies": "VAL-SVC-001" },
          { "name": "init rejects duplicate", "verifies": "VAL-SVC-003" },
          { "name": "catalog returns parsed service list", "verifies": "VAL-SVC-005" },
          { "name": "addService stores record", "verifies": "VAL-SVC-008" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on shared types or DB schema that doesn't exist yet
- Existing test patterns are unclear or inconsistent
- The Stripe CLI wrapper needs real CLI access for verification (not possible in test env)
- Build or typecheck failures in unrelated code block progress
