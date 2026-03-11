-- Backfill receipts without statement_period_id to the current period
UPDATE receipts
SET statement_period_id = (SELECT id FROM statement_periods WHERE is_current = true LIMIT 1)
WHERE statement_period_id IS NULL;

-- Also fix the auto-assign trigger to handle receipts with dates outside any period
CREATE OR REPLACE FUNCTION auto_assign_receipt_period()
RETURNS TRIGGER AS $$
DECLARE
  period_id uuid;
BEGIN
  -- Try to find a matching period by date
  IF NEW.date_confirmed IS NOT NULL OR NEW.date_extracted IS NOT NULL THEN
    SELECT id INTO period_id
    FROM statement_periods
    WHERE (COALESCE(NEW.date_confirmed, NEW.date_extracted))::date
          BETWEEN start_date AND end_date
    LIMIT 1;
  END IF;

  -- Fall back to current period
  IF period_id IS NULL THEN
    SELECT id INTO period_id FROM statement_periods WHERE is_current = true LIMIT 1;
  END IF;

  IF period_id IS NOT NULL THEN
    NEW.statement_period_id := period_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;