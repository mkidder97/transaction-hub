-- Fix search_path on the function
CREATE OR REPLACE FUNCTION auto_assign_receipt_period()
RETURNS TRIGGER AS $$
DECLARE
  period_id uuid;
BEGIN
  IF NEW.date_confirmed IS NOT NULL OR NEW.date_extracted IS NOT NULL THEN
    SELECT id INTO period_id
    FROM public.statement_periods
    WHERE (COALESCE(NEW.date_confirmed, NEW.date_extracted))::date
          BETWEEN start_date AND end_date
    LIMIT 1;
  END IF;

  IF period_id IS NULL THEN
    SELECT id INTO period_id FROM public.statement_periods WHERE is_current = true LIMIT 1;
  END IF;

  IF period_id IS NOT NULL THEN
    NEW.statement_period_id := period_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;