

# Fix: Make Messages Accessible to Admins

## Problem
- `/employee/messages` route uses `RoleGuard allowedRole="employee"` — admins are redirected away
- Messages nav item only appears in the employee sidebar
- Unread count fetch explicitly skips admins

## Changes

### 1. `src/App.tsx` — Remove RoleGuard from Messages route
Change the Messages route from `<RoleGuard allowedRole="employee">` to no guard (just authenticated via AppLayout's ProtectedRoute). This lets both admins and employees access their inbox.

### 2. `src/components/AppSidebar.tsx` — Add Messages to admin sidebar
- Add `{ title: "Messages", url: "/employee/messages", icon: MessageSquare }` to `adminItems` array (after Users)
- Remove the `role === "admin"` early return in the unread count `useEffect` so admins also see badge counts

### 3. No database changes needed
The RLS policy already allows viewing messages where `auth.uid() = sender_id OR auth.uid() = recipient_id`, so admins can already read their received messages at the DB level.

