

# In-App Messaging System — Updated Plan

## Part A: Database Migration

Create `receipt_messages` table with RLS. Same schema as before — no changes needed from the original plan.

## Part B: Matching.tsx — Message Employee (with fixes)

**Fix 1: Import useAuth**
```typescript
import { useAuth } from "@/contexts/AuthContext";
// Inside component:
const { user } = useAuth();
```

**Fix 2: Normalized MessageTarget type** instead of raw TxRow | ReceiptRow union:
```typescript
interface MessageTarget {
  id: string;
  user_id: string | null;
  vendor: string;
  amount: number | null;
  date: string | null;
  employeeName: string | null;
  transaction_id?: string;
  receipt_id?: string | null;
}
```

- State: `messageTx: MessageTarget | null`, `messageText: string`, `sendingMessage: boolean`
- "Tx Missing Receipt" tab: button builds MessageTarget from TxRow (`vendor = tx.vendor_normalized || tx.vendor_raw`, `employeeName = tx.user?.full_name`, `transaction_id = tx.id`)
- "Matched" tab: button builds MessageTarget from ReceiptRow (`vendor = r.vendor_confirmed || r.vendor_extracted`, `employeeName = r.employee?.full_name`, `transaction_id = r.transaction?.id`, `receipt_id = r.id`)
- Dialog pre-fills message using `MessageTarget.employeeName?.split(" ")[0]` for first name
- Insert uses `user.id` as `sender_id`, `messageTx.user_id` as `recipient_id`
- Add `MessageSquare` to lucide imports

## Part C: Employee Messages Page

Create `src/pages/employee/Messages.tsx`:
- Fetch messages where `recipient_id = user.id`, join sender/transaction/receipt
- Cards with unread highlighting, click to mark read
- Empty state with MessageSquare icon

## Part D: Sidebar + Routing

**AppSidebar.tsx:**
- Add `MessageSquare` to lucide imports
- Add `{ title: "Messages", url: "/employee/messages", icon: MessageSquare }` after "My Receipts" in `employeeItems`
- Add useEffect to fetch unread count, show Badge when > 0

**App.tsx:**
- Add lazy import: `const EmployeeMessages = lazy(() => import("@/pages/employee/Messages"))`
- Add route inside employee block: `/employee/messages` with `RoleGuard allowedRole="employee"`

## Implementation Order
1. DB migration
2. Create Messages page
3. Update AppSidebar (nav + unread badge)
4. Update App.tsx (route)
5. Update Matching.tsx (useAuth import, MessageTarget type, dialog)

