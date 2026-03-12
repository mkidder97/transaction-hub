ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS duplicate_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES public.receipts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.validate_duplicate_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.duplicate_status IS NOT NULL AND NEW.duplicate_status NOT IN ('suspected', 'confirmed_duplicate', 'not_duplicate') THEN
    RAISE EXCEPTION 'Invalid duplicate_status value: %', NEW.duplicate_status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_duplicate_status
  BEFORE INSERT OR UPDATE ON public.receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_duplicate_status();