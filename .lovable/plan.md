

## Root Cause: Transaction dates are wrong (2024 instead of 2026)

The matching engine **is working correctly** -- the problem is bad data. Here's what happened:

When the credit card statement screenshots were imported, the AI OCR extracted transaction dates with the year **2024** instead of **2026**. Compare:

```text
Receipt:     RaceTrac  $9.30  2026-03-06
Transaction: RACETRAC  $9.30  2024-03-06  ← wrong year
```

The matching algorithm scores amount (40%), date (35%), and vendor (25%). With dates 2 years apart, the date score is 0, capping the max possible score at ~0.65 -- just below the 0.85 auto-match threshold. That's why you see 14 "Needs Review" and 0 "Auto-Matched."

## Plan

### 1. Fix existing transaction dates (migration)
Update all 31 transactions with year 2024 to year 2026 by adding 2 years to their `transaction_date`. This is a one-time data fix.

### 2. Improve date extraction in the import flow
Update `supabase/functions/extract-transactions/index.ts` to add a sanity check: if the AI extracts a date with a year more than 1 year in the past, adjust it to the current year (keeping month/day). This prevents the same issue on future imports.

### 3. Re-run auto-match
After fixing dates, the scores will jump to ~1.0 for exact matches (amount + date + vendor all matching), and auto-matching will work as expected.

