

# Security Migration + Role Management UI

## Part 1: Database Migration

Run a single migration that:

1. Drops `"Users can update own profile"` policy on `profiles` (the self-update policy that allows role escalation)
2. Drops any open transaction SELECT policy if it exists, then creates two scoped policies:
   - `"Users can view own transactions"` — `auth.uid() = user_id`
   - `"Admins can view all transactions"` — uses `is_admin()` function (already exists as security definer, avoids recursive RLS)

Note: Looking at the current RLS, the transaction table already has the correct two policies (`"Users can view own transactions"` and `"Admins can view all transactions"`). The migration will use `IF EXISTS` so it's safe either way. The profiles self-update policy is named `"Users can update own profile"` in the schema.

## Part 2: Users.tsx UI Change

In `src/pages/admin/Users.tsx`:

1. **Replace the Badge** in the Role `TableCell` (lines 164-176) with a `Select` dropdown (`employee` / `admin` options)
2. **Add `handleRoleChange` handler** that calls `supabase.from("profiles").update({ role: newRole })` and optimistically updates local state
3. Remove the `Badge` import (no longer used in this file)

### Files
- **Migration**: Drop profile self-update policy + ensure scoped transaction SELECT policies
- **Edit**: `src/pages/admin/Users.tsx` — swap Badge for Select, add handler

