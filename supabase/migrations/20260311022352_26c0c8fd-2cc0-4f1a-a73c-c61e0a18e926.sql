-- Force backfill receipts without statement_period_id
UPDATE receipts
SET statement_period_id = '82e88f78-4722-4990-b4fd-a5005c9a26f6'
WHERE statement_period_id IS NULL;