-- 1. Drop employee self-update profile policy (role escalation risk)
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- 2. Ensure scoped transaction SELECT policies (idempotent)
DROP POLICY IF EXISTS "Authenticated users can view transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.transactions;

CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (is_admin());