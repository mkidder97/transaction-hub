

# Redesign Dashboard Stats for Accountant Clarity

## The Problem

The Dashboard "Unmatched" card shows **12** -- this counts every receipt with `match_status = 'unmatched'`, including the 11 confirmed duplicates that have already been dismissed. When the accountant clicks through to the Matching page, they see **0** unmatched because duplicates are filtered out. This creates confusion and erodes trust in the numbers.

More broadly, the current four stat cards (Total Receipts, Approved, Flagged, Unmatched) don't answer the questions an accountant actually cares about:
- "Are all bank charges accounted for?"
- "What still needs my attention?"
- "Can I close this period?"

## Proposed Dashboard Stat Cards

Replace the current 4 cards with 5 that map to the accountant's mental model:

```text
┌─────────────────┬─────────────────┐
│  43              │  31             │
│  Total Receipts  │  Matched        │  ← receipts matched to a tx
├─────────────────┼─────────────────┤
│  0               │  0              │
│  Needs Review    │  No Match       │  ← actionable items
├─────────────────┼─────────────────┤
│  1               │                 │
│  Tx w/o Receipt  │                 │  ← bank charges missing receipts
└─────────────────┘                 
```

### Counting Rules
- **Total Receipts**: All receipts in period (unchanged)
- **Matched**: Receipts where `match_status` is `matched`, `auto_matched`, or `manual_match` (excluding confirmed duplicates)
- **Needs Review**: Receipts with `match_status = 'needs_review'` AND not confirmed duplicates
- **No Match**: Receipts with `match_status = 'unmatched'` AND not confirmed duplicates (the fix -- currently shows all 12 including dupes)
- **Tx Without Receipt**: Unmatched transactions count (already fetched but not shown as a stat)

Each actionable card (Needs Review, No Match, Tx w/o Receipt) links to the corresponding Matching page tab.

## Changes

**File: `src/pages/admin/Dashboard.tsx`**

1. Update the `StatCards` interface to include `matched`, `needsReview`, `noMatch`, and `txWithoutReceipt` instead of `approved`, `flagged`, `unmatched`.

2. Update the stats computation (line 91-97) to:
   - Filter out `confirmed_duplicate` receipts for actionable counts
   - Count matched receipts (status in matched/auto_matched/manual_match, not confirmed duplicate)
   - Count needs_review receipts (not confirmed duplicate)
   - Count unmatched receipts (not confirmed duplicate)
   - Keep total as-is (all receipts)

3. Add a `txWithoutReceipt` count from the existing unmatched transactions query (already fetched at line 126, just not surfaced as a stat).

4. Replace the `statCards` array (line 140-145) with the new 5 cards, each with appropriate icon, color, and navigation link:
   - Total Receipts → no link
   - Matched → `/admin/matching?tab=matched`
   - Needs Review → `/admin/matching?tab=needs-review`
   - No Match → `/admin/matching?tab=unmatched`
   - Tx w/o Receipt → `/admin/matching?tab=unmatched-tx`

5. Change grid from `grid-cols-2 sm:grid-cols-4` to `grid-cols-2 sm:grid-cols-3` to accommodate 5 cards cleanly.

6. Keep the Recent Receipts, Unmatched Transactions, and By Department sections unchanged.

This aligns the dashboard numbers exactly with what the Matching page shows and gives the accountant a clear picture of what needs attention.

