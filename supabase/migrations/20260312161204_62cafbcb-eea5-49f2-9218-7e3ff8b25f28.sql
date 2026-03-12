-- Expand match_status CHECK on receipts to include all valid values
ALTER TABLE public.receipts
  DROP CONSTRAINT IF EXISTS receipts_match_status_check;
ALTER TABLE public.receipts
  ADD CONSTRAINT receipts_match_status_check
  CHECK (match_status IN ('unmatched', 'matched', 'manual_match', 'needs_review', 'auto_matched'));

-- Expand match_status CHECK on transactions to include no_receipt
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_match_status_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_match_status_check
  CHECK (match_status IN ('unmatched', 'matched', 'manual_match', 'needs_review', 'no_receipt'));