---
name: cli-worker
description: Implements CLI commands that proxy to server API with formatted terminal output
---

# CLI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:
- CLI command implementations (`cli/src/commands/client/`)
- Terminal output formatting
- PaperclipApiClient usage for server communication
- CLI-specific error handling

## Required Skills

None (CLI verification done via direct command execution, not tuistory at build time).

## Work Procedure

1. **Read the feature description** carefully. Understand what commands to implement, their arguments, and expected output.

2. **Read existing patterns** before writing any code:
   - Read `cli/src/commands/client/` for existing client command patterns (e.g., `agent.ts`, `issue.ts`, `company.ts`)
   - Read `cli/src/client/http.ts` for PaperclipApiClient usage
   - Read `cli/src/client/command-label.ts` for command registration
   - Read `cli/src/index.ts` for how commands are registered in the CLI

3. **Write tests first (RED)**:
   - Create test file in `cli/src/__tests__/stripe-projects.test.ts`
   - Test command output format, error handling, argument parsing
   - Mock PaperclipApiClient responses
   - Run tests: `cd junoclip && pnpm --filter @paperclipai/cli exec vitest run <test-file>`

4. **Implement commands (GREEN)**:
   - Create `cli/src/commands/client/stripe-projects.ts`
   - Use PaperclipApiClient for all server communication
   - Format output with picocolors for terminal readability
   - Handle connection errors (server unreachable) with user-friendly messages
   - Register commands in `cli/src/index.ts`

5. **Verify**:
   - Run tests: `cd junoclip && pnpm --filter @paperclipai/cli exec vitest run`
   - Run typecheck: `cd junoclip && pnpm typecheck`
   - Start dev server and test commands manually:
     - `cd junoclip && pnpm dev:once` (in background)
     - Run each command and verify output format
     - Stop dev server

## Example Handoff

```json
{
  "salientSummary": "Implemented paperclipai stripe-projects subcommands (catalog, init, status, add, sync, remove) with formatted terminal output. 12 tests pass, typecheck clean.",
  "whatWasImplemented": "Created cli/src/commands/client/stripe-projects.ts with 6 subcommands. Each command uses PaperclipApiClient, formats output with picocolors, handles server connection errors. Registered in cli/src/index.ts. Created cli/src/__tests__/stripe-projects.test.ts with 12 test cases.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd junoclip && pnpm --filter @paperclipai/cli exec vitest run src/__tests__/stripe-projects.test.ts", "exitCode": 0, "observation": "12 tests pass" },
      { "command": "cd junoclip && pnpm typecheck", "exitCode": 0, "observation": "No type errors" }
    ],
    "interactiveChecks": [
      { "action": "Run paperclipai stripe-projects catalog", "observed": "Formatted table of services with provider and category columns" },
      { "action": "Run paperclipai stripe-projects status", "observed": "Project info and services list displayed" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "cli/src/__tests__/stripe-projects.test.ts",
        "cases": [
          { "name": "catalog formats service list", "verifies": "VAL-CLI-001" },
          { "name": "init shows success message", "verifies": "VAL-CLI-002" },
          { "name": "server unreachable shows connection error", "verifies": "VAL-CLI-008" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Server API endpoints the CLI depends on don't exist yet
- PaperclipApiClient lacks needed methods
- Existing CLI registration pattern is unclear
- Build fails due to unrelated issues
