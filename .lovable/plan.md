

# Add duplicate transaction detection to import flow

Solid recommendation. The dedup key of `transaction_date + amount + card_last_four` is the right choice — vendor text from OCR is unreliable for exact matching. One important nuance: the existing memory note says "The transaction import process explicitly permits duplicate rows where vendor, date, and amount are identical" — but that was before card_last_four was part of the key. Adding card_last_four makes this a much tighter check that catches true re-imports while still allowing legitimate same-day same-amount charges on different cards.

## Changes — single file: `src/pages/admin/ImportTransactions.tsx`

In `confirmImport`, after building `txRows` (line 207) and before the insert (line 209):

1. **Compute date range** from txRows (min/max `transaction_date`)
2. **Query existing transactions** filtered by card_last_four values and date range
3. **Build dedup key set** (`date|amount|card_last_four`)
4. **Split** txRows into `toInsert` and count `skippedCount`
5. **If toInsert is empty**, skip insert, update batch with `imported_rows: 0`, show warning only
6. **Otherwise**, insert only `toInsert`, update batch `imported_rows` to `toInsert.length`, run auto-match on inserted rows
7. **If skippedCount > 0**, show warning toast after success toast
8. **Update success toast** to reflect `toInsert.length` instead of `sourceRows.length`

No database changes needed. No other files affected.

