
-- Known vendors: admin-approved dictionary
CREATE TABLE public.known_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_name text NOT NULL,
  canonical_name text NOT NULL,
  default_category_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_known_vendors_raw ON public.known_vendors(raw_name);

ALTER TABLE public.known_vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view known vendors" ON public.known_vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert known vendors" ON public.known_vendors FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "Admins can update known vendors" ON public.known_vendors FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "Admins can delete known vendors" ON public.known_vendors FOR DELETE TO authenticated USING (is_admin());

-- Vendor candidates: flagged by employees, pending admin approval
CREATE TABLE public.vendor_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_name text NOT NULL,
  suggested_name text NOT NULL,
  suggested_category_id uuid REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can insert vendor candidates" ON public.vendor_candidates FOR INSERT TO authenticated WITH CHECK (auth.uid() = submitted_by);
CREATE POLICY "Authenticated can view own vendor candidates" ON public.vendor_candidates FOR SELECT TO authenticated USING (auth.uid() = submitted_by);
CREATE POLICY "Admins can view all vendor candidates" ON public.vendor_candidates FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "Admins can update vendor candidates" ON public.vendor_candidates FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "Admins can delete vendor candidates" ON public.vendor_candidates FOR DELETE TO authenticated USING (is_admin());
