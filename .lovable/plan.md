

# Fix: Transactions Missing Employee Assignment

## Problem

All 34 transactions with `card_last_four = '2397'` have `user_id = NULL`, despite your profile having `card_last_four = '2397'`. This happened because the import code resolves `user_id` from `card_last_four` at import time, but your profile's card number was set *after* the transactions were already imported. There is also no database trigger to auto-assign `user_id` when cards match, so once imported with NULL, they stay NULL.

## Plan

### 1. Backfill existing data
Run a data update to set `user_id` on all transactions where `card_last_four` matches a profile but `user_id` is currently NULL.

```sql
UPDATE public.transactions t
SET user_id = p.id
FROM public.profiles p
WHERE t.card_last_four = p.card_last_four
  AND t.user_id IS NULL
  AND p.card_last_four IS NOT NULL;
```

### 2. Add a database trigger to prevent this in the future
Create a trigger on the `transactions` table that auto-resolves `user_id` from `card_last_four` on INSERT (when `user_id` is not already set). This way, even if the import code fails to resolve the user, the database will catch it.

```sql
CREATE OR REPLACE FUNCTION public.auto_assign_transaction_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.card_last_four IS NOT NULL THEN
    SELECT id INTO NEW.user_id
    FROM public.profiles
    WHERE card_last_four = NEW.card_last_four
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_assign_transaction_user
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_transaction_user();
```

### 3. No code changes needed
The import code in `ImportTransactions.tsx` already attempts card-to-user resolution. The trigger serves as a safety net. The placeholder flow will work immediately after the backfill since all transactions will have a `user_id`.

