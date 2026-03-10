
-- =============================================
-- Drop ALL existing RLS policies
-- =============================================

-- profiles
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

-- receipts
DROP POLICY IF EXISTS "Users can view their own receipts" ON public.receipts;
DROP POLICY IF EXISTS "Users can insert their own receipts" ON public.receipts;
DROP POLICY IF EXISTS "Users can update their own receipts" ON public.receipts;
DROP POLICY IF EXISTS "Admins can view all receipts" ON public.receipts;
DROP POLICY IF EXISTS "Admins can manage all receipts" ON public.receipts;

-- transactions
DROP POLICY IF EXISTS "Authenticated users can view transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins can manage transactions" ON public.transactions;

-- import_batches
DROP POLICY IF EXISTS "Admins can manage import batches" ON public.import_batches;
DROP POLICY IF EXISTS "Users can view their own batches" ON public.import_batches;

-- expense_categories
DROP POLICY IF EXISTS "Anyone authenticated can view categories" ON public.expense_categories;
DROP POLICY IF EXISTS "Admins can manage categories" ON public.expense_categories;

-- statement_periods
DROP POLICY IF EXISTS "Anyone authenticated can view periods" ON public.statement_periods;
DROP POLICY IF EXISTS "Admins can manage periods" ON public.statement_periods;

-- app_settings
DROP POLICY IF EXISTS "Anyone authenticated can view settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can manage settings" ON public.app_settings;

-- storage
DROP POLICY IF EXISTS "Users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own receipts" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all screenshots" ON storage.objects;

-- =============================================
-- Create is_admin() SECURITY DEFINER function
-- =============================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- =============================================
-- Recreate RLS policies (all PERMISSIVE)
-- =============================================

-- PROFILES: users read/update own; admins read all
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin());

-- RECEIPTS: employees select/insert/update own; admins select/update all
CREATE POLICY "Users can view own receipts" ON public.receipts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own receipts" ON public.receipts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own receipts" ON public.receipts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all receipts" ON public.receipts FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can update all receipts" ON public.receipts FOR UPDATE TO authenticated USING (public.is_admin());

-- TRANSACTIONS: all authenticated select; admins insert/update/delete
CREATE POLICY "Authenticated can view transactions" ON public.transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert transactions" ON public.transactions FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update transactions" ON public.transactions FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can delete transactions" ON public.transactions FOR DELETE TO authenticated USING (public.is_admin());

-- IMPORT_BATCHES: admins only
CREATE POLICY "Admins can select import batches" ON public.import_batches FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can insert import batches" ON public.import_batches FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update import batches" ON public.import_batches FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can delete import batches" ON public.import_batches FOR DELETE TO authenticated USING (public.is_admin());

-- EXPENSE_CATEGORIES: authenticated read; admins write
CREATE POLICY "Authenticated can view categories" ON public.expense_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert categories" ON public.expense_categories FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update categories" ON public.expense_categories FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can delete categories" ON public.expense_categories FOR DELETE TO authenticated USING (public.is_admin());

-- STATEMENT_PERIODS: authenticated read; admins write
CREATE POLICY "Authenticated can view periods" ON public.statement_periods FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert periods" ON public.statement_periods FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update periods" ON public.statement_periods FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can delete periods" ON public.statement_periods FOR DELETE TO authenticated USING (public.is_admin());

-- APP_SETTINGS: authenticated read; admins write
CREATE POLICY "Authenticated can view settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert settings" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update settings" ON public.app_settings FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can delete settings" ON public.app_settings FOR DELETE TO authenticated USING (public.is_admin());

-- =============================================
-- Storage policies
-- =============================================

-- Receipts bucket: users upload to receipts/{uid}/*, read own files; admins read all
CREATE POLICY "Users upload own receipts" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users read own receipt files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Admins read all receipt files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND public.is_admin());

-- Transaction-screenshots bucket: admins only for upload and read
CREATE POLICY "Admins upload screenshots" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'transaction-screenshots' AND public.is_admin());

CREATE POLICY "Admins read screenshots" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'transaction-screenshots' AND public.is_admin());
