

# Fix unmatched receipts and duplicate transaction cleanup

## Current state (from database inspection)

**6 unmatched receipts:**
- 3x Chick-fil-A $19.52 dated 2/04 -- OCR extracted wrong date; actual transaction is 2/24
- 1x Subway $12.05 dated 2/23 -- confirmed_duplicate (original is already matched)
- 1x Subway $11.29 dated 2/27 -- confirmed_duplicate (original is already matched)
- 1x McDonald's $10.37 dated **2020**-03-03 -- OCR extracted wrong year (should be 2026)

4 of these 6 are `confirmed_duplicate` but still show in "No Match Found" because the query doesn't filter them out.

**Duplicate transactions:** 15+ groups of duplicates exist from re-imports across batches (screenshot imports without `card_last_four` duplicated by CSV imports with `card_last_four`). Many unmatched duplicates are cluttering the pool.

## Plan

### 1. Hide confirmed duplicates from "No Match Found" tab (code fix)

In `src/pages/admin/Matching.tsx`, add `duplicate_status.neq.confirmed_duplicate` filter to the unmatched receipts query. Confirmed duplicates have already been dismissed -- they should not appear as action items.

### 2. Data cleanup via SQL migrations

**a) Fix Chick-fil-A date:** Update the one non-duplicate Chick-fil-A receipt (5b9407f8) from 2/04 to 2/24 (matching the actual CHICK-FIL-A transaction on 2/24). Mark the other two as `confirmed_duplicate` of this one.

**b) Fix McDonald's year:** Update receipt 4aedc29e date from 2020-03-03 to 2026-03-03. This will allow matching to the existing MCDONALDS transaction on 2026-03-03 (but that one is already matched to another receipt -- so this McDonald's receipt is likely a duplicate too and should be investigated).

**c) Delete orphaned duplicate transactions:** Remove unmatched transactions that are duplicates of already-matched transactions (same vendor, amount, date but from a different import batch). This cleans ~15 phantom transactions from the pool.

### 3. Re-run auto-match after cleanup

Invoke the match-receipt edge function for the March 2026 period to pick up the newly fixable Chick-fil-A match.

## Summary of changes
- **1 file edited:** `src/pages/admin/Matching.tsx` (filter confirmed_duplicate from unmatched tab)
- **SQL data fixes:** Correct 2 receipt dates, mark 2 receipts as confirmed_duplicate, delete ~15 duplicate transactions
- **Re-run matching** for the period

