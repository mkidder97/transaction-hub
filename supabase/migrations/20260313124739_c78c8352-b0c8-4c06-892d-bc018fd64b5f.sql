-- FIX 1: Prevent role self-escalation
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- FIX 2: Scope transaction visibility
DROP POLICY IF EXISTS "Authenticated can view transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all transactions" ON public.transactions
  FOR SELECT TO authenticated USING (is_admin());