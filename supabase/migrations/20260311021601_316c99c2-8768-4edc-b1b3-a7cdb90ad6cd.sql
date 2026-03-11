-- Update trigger to fall back to current period when no matching date range found
CREATE OR REPLACE FUNCTION public.auto_assign_transaction_period()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.transaction_date IS NOT NULL THEN
    SELECT id INTO NEW.statement_period_id
    FROM public.statement_periods
    WHERE NEW.transaction_date BETWEEN start_date AND end_date
    LIMIT 1;
  END IF;
  -- Fall back to current period if no matching period found
  IF NEW.statement_period_id IS NULL THEN
    SELECT id INTO NEW.statement_period_id
    FROM public.statement_periods
    WHERE is_current = true
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;

-- Fix existing orphan transactions
UPDATE public.transactions
SET statement_period_id = (SELECT id FROM public.statement_periods WHERE is_current = true LIMIT 1)
WHERE statement_period_id IS NULL;