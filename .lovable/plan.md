

# Fix card number data and clean up duplicate transactions

## Problem
The card's last 5 digits are **42397**. Some imports captured `4239` (4 digits) and others captured `2397` (last 4). There are also 6 transactions with NULL card numbers from screenshot imports. This created three sets of duplicates across the card variants, all matched to different receipts.

## Current state

| Card | Tx count | Notes |
|------|----------|-------|
| 2397 | 20 | Correct card number. Has the most complete data. |
| 4239 | 15 | Wrong truncation. 3 are exact duplicates of 2397 txns, 12 are unique. |
| NULL | 6 | Screenshot imports. 3 overlap with 2397/4239, 3 are unique. |

### Duplicates found (same vendor + amount + date across card variants)

**Between 4239 and 2397 (3 pairs):**
- CHIPOTLE $10.28 on 2/20 — both matched (2397 receipt is confirmed_duplicate)
- SUBWAY $12.05 on 2/23 — both matched (2397 receipt is confirmed_duplicate)
- CHIPOTLE $14.45 on 2/26 — both matched

**Between NULL and 2397 (1 pair):**
- CHIPOTLE $14.45 on 2/26 — triple duplicate (exists in all 3 card variants)

**Between NULL and 4239 (3 pairs, 1 already counted above):**
- SUBWAY $11.29 on 2/27
- MCDONALDS $10.37 on 3/03

## Plan

### 1. Set profile card number
Update the user profile to `card_last_four = '2397'`.

### 2. Consolidate unique card-4239 transactions
For the **12 unique** card-4239 transactions (no duplicate in 2397), update `card_last_four` from `4239` to `2397`. These keep their existing receipt matches.

### 3. Delete duplicate card-4239 transactions (3 records)
Delete the 3 card-4239 transactions that are exact duplicates of existing 2397 transactions. Unlink their associated receipts (set `transaction_id = NULL`, `match_status = 'unmatched'`) and mark those receipts as `confirmed_duplicate`.

### 4. Consolidate unique NULL-card transactions
For the **3 unique** NULL-card transactions (Chipotle 3/04, Racetrac 3/05, Racetrac 3/06), update `card_last_four` to `2397`. These keep their existing receipt matches.

### 5. Delete duplicate NULL-card transactions (3 records)
Delete the 3 NULL-card transactions that duplicate 2397 or 4239 records. Unlink and mark their receipts as `confirmed_duplicate`.

### 6. Fix RACETRAC duplicate on 2/19
Card 2397 has two RACETRAC $4.64 transactions on 2/19 (IDs `ee808e05` and `fdc145d7`), both matched. Verify with user if this is legitimate (two separate purchases same day) or a duplicate.

## Summary
- **SQL data operations:** Update profile card, reassign ~15 transactions from wrong card to `2397`, delete ~6 duplicate transactions, mark ~5 receipts as `confirmed_duplicate`
- **No code changes needed** — this is purely data cleanup
- **Result:** All transactions consolidated under card `2397`, no phantom duplicates in Tx Missing Receipt

