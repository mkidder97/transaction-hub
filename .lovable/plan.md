

## Changes

### 1. Remove Reconciliation from sidebar
In `src/components/AppSidebar.tsx`, remove the Reconciliation entry (`/admin/reconciliation`, `GitCompare`) from `adminItems`. Also remove the unused `GitCompare` import.

### 2. Wire Run Auto-Match to client-side matcher
In `src/pages/admin/Matching.tsx`:
- Import `runMatchingForPeriod` from `@/lib/matcher`
- Replace `handleRunMatch` to call `runMatchingForPeriod(periodId)` instead of the non-existent edge function
- Remove `session` from the `useAuth()` destructure since it's no longer needed
- Remove the `!session?.access_token` guard from `handleRunMatch`

### 3. Fix matcher status value
In `src/lib/matcher.ts`, line 172: change `match_status: "manual_match"` to `match_status: "needs_review"` so the Matching page's "Needs Review" tab (which queries for `match_status === "needs_review"`) actually shows these receipts.

