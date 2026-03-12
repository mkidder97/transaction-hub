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