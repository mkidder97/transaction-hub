

# Migration: Fix Role Escalation and Transaction Data Exposure

## What this does

Two SQL security fixes in a single migration file — no application code changes.

### Fix 1: Role Escalation on Profiles
Drop the existing `"Users can update own profile"` policy and replace it with one that includes a `WITH CHECK` preventing users from changing their own `role` column.

### Fix 2: Transaction Visibility
Drop the existing `"Authenticated can view transactions"` open SELECT policy and replace it with two scoped policies:
- Employees see only their own transactions (`user_id = auth.uid()`)
- Admins see all (using `is_admin()` which already exists)

### SQL

```sql
-- FIX 1: Prevent role self-escalation
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- FIX 2: Scope transaction visibility
DROP POLICY IF EXISTS "Authenticated can view transactions" ON public.transactions;

CREATE POLICY "Users can view own transactions" ON public.transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Note: "Admins can view all transactions" already exists as a separate policy
-- We only need the user-scoped policy to replace the open one.
```

**Note:** The provided plan's admin transaction policy uses a raw subquery, but there's already an existing admin SELECT policy... let me re-check. Actually, looking at the transactions RLS policies listed, I do NOT see a separate admin SELECT policy — the single `"Authenticated can view transactions"` covers everyone. So we do need to create the admin one too.

### Revised SQL

```sql
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Authenticated can view transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all transactions" ON public.transactions
  FOR SELECT TO authenticated USING (is_admin());
```

Using `is_admin()` (the existing security definer function) instead of an inline subquery — consistent with the rest of the codebase and avoids RLS recursion.

No code files are modified.

