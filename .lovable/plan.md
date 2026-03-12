

# Add Approve & Flag actions to the Matching page

## Current state
The Matching page has matching actions (Confirm, No Match, Unlink, Find Transaction) but no way to approve or flag a receipt's review status. Those actions only exist on the old Reconciliation page.

## Changes

### `src/pages/admin/Matching.tsx`

**1. Add approve/flag handler functions** (near the existing action handlers ~lines 500-560):
- `handleApprove(receiptId)` — updates `status` to `"approved"` and refreshes
- `handleFlag(receiptId, reason)` — updates `status` to `"flagged"` and `flag_reason`, then refreshes

**2. Add flag dialog state** (near existing state declarations):
- `flagReceiptId` / `flagReason` / `flagSubmitting` state variables

**3. Add a three-dot DropdownMenu to each receipt row** across all receipt-showing tabs:

- **All Receipts tab** (line ~909): Add an Actions column with a DropdownMenu containing Approve and Flag options
- **Needs Review tab** (line ~970): Add Approve/Flag buttons alongside the existing Confirm/No Match actions
- **No Match Found tab** (line ~1104): Add Approve/Flag to each row
- **Matched tab** (line ~1220): Add Approve/Flag next to the existing Unlink button

The DropdownMenu pattern mirrors the Reconciliation page: three-dot button → Approve / Flag options. Flag opens a small dialog for entering a reason.

**4. Add Flag dialog** at the bottom of the component (copy the pattern from Reconciliation.tsx lines ~310-340):
- Dialog with reason input + Cancel/Flag buttons

**5. Add imports**: `MoreHorizontal` icon (already imported as it turns out — will verify), `DropdownMenu` components, `Flag`/`CheckCircle` icons (already imported).

**6. Update table headers** to include an "Actions" column where needed.

