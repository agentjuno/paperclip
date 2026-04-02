---
name: frontend-worker
description: Implements React UI features (pages, components, API hooks) with visual verification
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:
- React page components (`ui/src/pages/`)
- UI components (`ui/src/components/`)
- API hook modules (`ui/src/api/`)
- Query key registration (`ui/src/lib/queryKeys.ts`)
- Route registration in `ui/src/App.tsx`
- Sidebar/navigation changes

## Required Skills

- `agent-browser` — for visual verification of UI changes against the running dev server

## Work Procedure

1. **Read the feature description** carefully. Understand what UI elements to build and how they interact with the API.

2. **Read existing patterns** before writing any code:
   - For pages: read `ui/src/pages/ProjectDetail.tsx` (the page you're extending) and `ui/src/pages/CompanySettings.tsx` (for settings-style layout)
   - For API hooks: read `ui/src/api/projects.ts` and `ui/src/api/secrets.ts` for the pattern
   - For query keys: read `ui/src/lib/queryKeys.ts`
   - For components: read existing components in the same area for styling patterns (Radix UI + Tailwind CSS 4)
   - For routing: read `ui/src/App.tsx` `boardRoutes()` function

3. **Write the API hooks first**:
   - Create `ui/src/api/stripe-projects.ts` following existing patterns
   - Register query keys in `ui/src/lib/queryKeys.ts`
   - These are the data layer the UI components will consume

4. **Implement UI components**:
   - Follow the existing component patterns (Radix UI, Tailwind CSS 4, Lucide icons)
   - Use `useCompany()` for company context, `useBreadcrumbs()` for navigation
   - Use `useQuery()` and `useMutation()` from TanStack Query
   - Handle loading, error, and empty states
   - Use `useToast()` for operation feedback

5. **Register routes** if adding new pages:
   - Add route in `App.tsx` `boardRoutes()`
   - Add sidebar nav item if needed

6. **Verify with agent-browser**:
   - Start the dev server: `cd junoclip && pnpm dev:once`
   - Use agent-browser to navigate to the page
   - Verify all visual elements render correctly
   - Test user interactions (click buttons, open dialogs, etc.)
   - Capture screenshots as evidence

7. **Run typecheck**:
   - `cd junoclip && pnpm typecheck`

## Example Handoff

```json
{
  "salientSummary": "Added Infrastructure tab to ProjectDetail with service catalog dialog, provisioned services list, and sync/rotate actions. Verified all UI elements render and interact correctly via agent-browser.",
  "whatWasImplemented": "Created ui/src/api/stripe-projects.ts with API hooks for catalog, init, addService, removeService, sync, rotate, listServices, status. Added query keys in queryKeys.ts. Created ServiceCatalogDialog component with category filtering. Added Infrastructure tab to ProjectDetail page with ServiceList, empty state, and action buttons.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd junoclip && pnpm typecheck", "exitCode": 0, "observation": "No type errors" }
    ],
    "interactiveChecks": [
      { "action": "Navigate to /:companyPrefix/projects/:id, click Infrastructure tab", "observed": "Tab renders, shows empty state with Add Service CTA" },
      { "action": "Click Add Service, browse catalog, filter by databases", "observed": "Catalog dialog opens, filter works, services display correctly" },
      { "action": "Select a service and confirm", "observed": "Service appears in list with correct provider, type, status" },
      { "action": "Click Sync Credentials", "observed": "Loading state appears, success toast shown after completion" }
    ]
  },
  "tests": { "added": [] },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- API endpoints the UI depends on don't exist yet or return unexpected shapes
- The dev server fails to start
- Existing UI patterns are unclear (component library, styling approach)
- agent-browser cannot interact with the application
