
-- =============================================
-- SpendSync Database Schema
-- =============================================

-- 1. Profiles table
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'admin')),
  department TEXT,
  card_last_four VARCHAR(4),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 2. Expense categories table
CREATE TABLE public.expense_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view categories" ON public.expense_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage categories" ON public.expense_categories FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 3. Statement periods table
CREATE TABLE public.statement_periods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.statement_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view periods" ON public.statement_periods FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage periods" ON public.statement_periods FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 4. Import batches table
CREATE TABLE public.import_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  imported_by UUID REFERENCES public.profiles(id),
  source TEXT NOT NULL CHECK (source IN ('screenshot', 'csv')),
  filename TEXT,
  total_rows INTEGER DEFAULT 0,
  imported_rows INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage import batches" ON public.import_batches FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users can view their own batches" ON public.import_batches FOR SELECT USING (auth.uid() = imported_by);

-- 5. Transactions table
CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  import_batch_id UUID REFERENCES public.import_batches(id),
  transaction_date DATE,
  vendor_raw TEXT,
  vendor_normalized TEXT,
  amount NUMERIC(10,2),
  card_last_four VARCHAR(4),
  source TEXT NOT NULL DEFAULT 'screenshot' CHECK (source IN ('screenshot', 'csv', 'manual')),
  user_id UUID REFERENCES public.profiles(id),
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'matched', 'manual_match')),
  match_confidence NUMERIC(3,2),
  statement_period_id UUID REFERENCES public.statement_periods(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view transactions" ON public.transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage transactions" ON public.transactions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 6. Receipts table
CREATE TABLE public.receipts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  photo_url TEXT,
  storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'approved', 'flagged')),
  vendor_extracted TEXT,
  vendor_confirmed TEXT,
  amount_extracted NUMERIC(10,2),
  amount_confirmed NUMERIC(10,2),
  date_extracted DATE,
  date_confirmed DATE,
  category_id UUID REFERENCES public.expense_categories(id),
  ai_confidence NUMERIC(3,2),
  ai_raw_text TEXT,
  transaction_id UUID REFERENCES public.transactions(id),
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'matched', 'manual_match')),
  match_confidence NUMERIC(3,2),
  statement_period_id UUID REFERENCES public.statement_periods(id),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  flag_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own receipts" ON public.receipts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own receipts" ON public.receipts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own receipts" ON public.receipts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all receipts" ON public.receipts FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can manage all receipts" ON public.receipts FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 7. App settings table
CREATE TABLE public.app_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage settings" ON public.app_settings FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- =============================================
-- Triggers
-- =============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_receipts_updated_at BEFORE UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_statement_periods_updated_at BEFORE UPDATE ON public.statement_periods FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-assign statement_period_id on receipts
CREATE OR REPLACE FUNCTION public.auto_assign_receipt_period()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.date_confirmed IS NOT NULL OR NEW.date_extracted IS NOT NULL THEN
    SELECT id INTO NEW.statement_period_id
    FROM public.statement_periods
    WHERE COALESCE(NEW.date_confirmed, NEW.date_extracted) BETWEEN start_date AND end_date
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER auto_receipt_period BEFORE INSERT OR UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.auto_assign_receipt_period();

-- Auto-assign statement_period_id on transactions
CREATE OR REPLACE FUNCTION public.auto_assign_transaction_period()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_date IS NOT NULL THEN
    SELECT id INTO NEW.statement_period_id
    FROM public.statement_periods
    WHERE NEW.transaction_date BETWEEN start_date AND end_date
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER auto_transaction_period BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.auto_assign_transaction_period();

-- Auto-create profile on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- Storage buckets
-- =============================================

INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('transaction-screenshots', 'transaction-screenshots', false);

CREATE POLICY "Users can upload receipts" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view their own receipts" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Admins can view all receipts" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'receipts' AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users can upload screenshots" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'transaction-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view their own screenshots" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'transaction-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Admins can view all screenshots" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'transaction-screenshots' AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- =============================================
-- Seed data
-- =============================================

-- 8 expense categories
INSERT INTO public.expense_categories (name, description) VALUES
  ('Meals & Entertainment', 'Business meals, client entertainment, team events'),
  ('Travel', 'Flights, trains, rideshares, and other transportation'),
  ('Lodging', 'Hotels, Airbnb, and other accommodations'),
  ('Office Supplies', 'Pens, paper, printer supplies, desk accessories'),
  ('Software & Subscriptions', 'SaaS tools, licenses, and recurring subscriptions'),
  ('Fuel', 'Gas, EV charging, and vehicle fuel costs'),
  ('Parking & Tolls', 'Parking fees, toll roads, and related charges'),
  ('Miscellaneous', 'Other business expenses not covered by other categories');

-- Current month statement period
INSERT INTO public.statement_periods (name, start_date, end_date, is_current) VALUES
  (TO_CHAR(now(), 'Month YYYY'), DATE_TRUNC('month', now())::date, (DATE_TRUNC('month', now()) + INTERVAL '1 month - 1 day')::date, true);

-- App settings
INSERT INTO public.app_settings (key, value, description) VALUES
  ('auto_match_threshold', '0.85', 'Confidence threshold for automatic receipt-to-transaction matching'),
  ('notification_email', '', 'Email address for system notifications'),
  ('onedrive_base_path', '', 'Base OneDrive path for receipt backup sync');
