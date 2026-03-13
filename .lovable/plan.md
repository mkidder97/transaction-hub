

# Remove Needs Review + Scale for 30+ Users

## Part 1: Remove Needs Review Tier

The matching engine currently has three outcomes (auto-match, needs-review, no-match). We collapse to two: **matched or unmatched**. Receipts that scored 0.4-0.69 (client) or 0.6-threshold (edge function) now go straight to unmatched with suggestions stored for manual "Find Transaction".

### Database Migration
```sql
UPDATE public.receipts SET match_status = 'unmatched' WHERE match_status = 'needs_review';
```

### File Changes

**`src/lib/matcher.ts`**
- Remove `needs_review` from `MatchResult.status` type (line 14) — only `"matched" | "no_match"`
- Remove `PeriodMatchSummary.needs_review` field, replace with `noMatch`
- Lines 163-164: Remove the `score >= 0.4` branch that returns `needs_review`. Everything below auto-match threshold becomes `no_match` (but still returns suggestions)
- Lines 217-229: Remove the `needs_review` branch in `runMatchingForPeriod`. Receipts that don't auto-match get `match_status = "unmatched"` with `match_suggestions` preserved for manual search
- Line 183: Remove `"needs_review"` from the `.in()` filter — only fetch `"unmatched"` receipts

**`supabase/functions/match-receipt/index.ts`**
- Lines 257-276: Remove the `score >= 0.6` needs_review branch. Below auto-match threshold → return `no_match` with suggestions stored in `match_suggestions` for manual use
- Lines 109-111, 119, 124: Remove `needsReview` counter from bulk mode response
- Lines 104: Update response shape to remove `needsReview`

**`src/pages/admin/Matching.tsx`**
- Remove `needsReview` from `Stats` interface (line 103) and `stats` state (line 283)
- Remove `reviewReceipts` state, `reviewLoading`, `fetchReview`, `legacyTxCache` (lines 300-301, 319-320, 429-439, 500-522)
- Remove `fetchReview` from `refreshAll` (line 488)
- Remove `filteredReview` (line 930)
- Remove "Needs Review" stat card (line 905)
- Remove entire Needs Review tab content (lines 1169-1290)
- Remove `needsReview` from bulk result display (line 985) and `BulkResult` interface (line 159)
- Update `initialTab` default from `"needs-review"` to `"unmatched"` (line 275)
- Update stat card grid from `md:grid-cols-6` to `md:grid-cols-5` (line 992)
- Remove `"needs_review"` badge styling from All Receipts tab (lines 1145-1150)
- Remove `reviewReceipts` from `openSearchTx` fallback array (line 782, 815)

**`src/pages/admin/Dashboard.tsx`**
- Remove `needsReview` from `StatCards` interface and state (lines 22, 65, 97)
- Replace "Needs Review" stat card with "Duplicates" card linking to `/admin/matching?tab=duplicates`
- Add a duplicates count query: fetch receipts where `duplicate_status IS NULL` and group by amount+vendor+date to count suspected groups (or just show 0 and let Matching page handle detection)
- Simpler approach: just count receipts with `duplicate_status = 'suspected_duplicate'` or keep it as a static link without a count

### Dashboard Stat Cards (final set)
1. Total Receipts — no link
2. Matched — links to `/admin/matching?tab=matched`
3. No Match — links to `/admin/matching?tab=unmatched`
4. Tx w/o Receipt — links to `/admin/matching?tab=no-receipt`
5. Duplicates — links to `/admin/matching?tab=duplicates`

---

## Part 2: Scale for 30+ Users

### Pagination (all tables in Matching.tsx)
- Add `page` state per tab, 20 rows per page
- Add prev/next buttons below each table
- Apply `.range(page * 20, (page + 1) * 20 - 1)` to each fetch query
- Add pagination to Dashboard recent receipts (already limited to 5, fine as-is)

### Employee filter on Duplicates tab
- Add the employee dropdown filter to the duplicates tab (currently excluded from the condition on line 1047)

### Bulk operations
- Add "Select All" checkbox to unmatched and matched table headers
- Add bulk actions bar (appears when items selected): "Approve Selected", "Flag Selected"

### Per-employee summary on Dashboard
- Add a "By Employee" card showing receipt counts per person: total submitted, matched, unmatched
- Query: group `allReceipts` by `user_id` and join with profile `full_name`
- Sortable table so accountant can see who's behind

### Selective refresh
- Replace `refreshAll` (fires 7 queries) with targeted refreshes:
  - After confirming match: refresh stats + matched + unmatched tabs only
  - After flagging: refresh stats + current tab only
  - After duplicate action: refresh stats + duplicates tab only

---

## Implementation Order
1. DB migration: `needs_review` → `unmatched`
2. Update `matcher.ts` — remove needs_review tier
3. Update `match-receipt` edge function — remove needs_review tier
4. Update `Matching.tsx` — remove needs-review tab/state, add pagination, add bulk select
5. Update `Dashboard.tsx` — swap Needs Review for Duplicates card, add employee summary
6. Optimize selective refresh logic

