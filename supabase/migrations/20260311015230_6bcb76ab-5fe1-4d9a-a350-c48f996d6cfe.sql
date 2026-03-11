ALTER TABLE public.statement_periods ADD COLUMN closed_at timestamptz DEFAULT NULL;
ALTER TABLE public.statement_periods ADD COLUMN closed_by uuid DEFAULT NULL;