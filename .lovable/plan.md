

# Fix Auto-Match Engine + Overhaul Matching Page UX

## Step 1 — Migration (must run first)

The `receipt_id` column and `match_suggestions` column already exist in the schema. The migration only needs to handle the CHECK constraints:

```sql
-- Expand match_status CHECK on receipts
ALTER TABLE public.receipts DROP CONSTRAINT IF EXISTS receipts_match_status_check;
ALTER TABLE public.receipts ADD CONSTRAINT receipts_match_status_check
  CHECK (match_status IN ('unmatched','matched','manual_match','needs_review','auto_matched'));

-- Expand match_status CHECK on transactions
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_match_status_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_match_status_check
  CHECK (match_status IN ('unmatched','matched','manual_match','needs_review','no_receipt'));
```

## Step 2 — Fix `src/lib/matcher.ts`

**Fix A — Return top 3 suggestions + populate match_suggestions**
- Update `matchReceiptToTransactions` to return `suggestions: Array<{ transactionId, vendor, amount, date, score }>` (top 3 by score).
- In `runMatchingForPeriod`, for `needs_review`: write `match_status`, `match_confidence`, and `match_suggestions` jsonb array. Do NOT set `transaction_id`.
- For `matched`: set `transaction_id`, `receipt_id` on transaction, clear `match_suggestions`.

**Fix B — Add `statement_period_id` filter**
- Fetch `statement_period_id` from the receipt query, filter transactions by it.

**Fix C — Graceful degradation on missing amount**
- Remove the early return when `rAmount == null`. Score amount component as 0, continue with date + vendor.

## Step 3 — Overhaul `src/pages/admin/Matching.tsx`

**Image lightbox**: Add `lightboxUrl` state + Dialog at bottom of render.

**All Receipts tab**: Add Photo column (40x40 thumbnail, clickable → lightbox, `ImageOff` placeholder if missing). Add Extracted column (green `CheckCircle` if vendor data present, amber `AlertTriangle` if not).

**Needs Review tab**: Add clickable receipt thumbnail above text fields on left side of card. Handle legacy data: if `match_suggestions` empty but `transaction_id` set, fetch the linked transaction inline and render as single confirmable candidate.

**Unmatched tab (renamed "No Match Found")**: Add Photo + Extracted columns. Amber left border on rows missing extraction. Info banner at top showing count of receipts needing AI extraction.

**Matched tab**: Add Photo column as first column.

**Tab label changes**:
- "All" → "All Receipts"
- "Unmatched" → "No Match Found"  
- "No Receipt" → "Tx Missing Receipt"

## Step 4 — Sidebar

Already clean from prior change. No action needed.

