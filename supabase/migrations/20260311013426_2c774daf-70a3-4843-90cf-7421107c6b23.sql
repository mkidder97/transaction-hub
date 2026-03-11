
-- Add match_suggestions jsonb column to receipts
ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS match_suggestions jsonb DEFAULT NULL;

-- Add receipt_id column to transactions (reverse link)
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES public.receipts(id) DEFAULT NULL;
