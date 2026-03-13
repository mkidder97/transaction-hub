

# Per-Transaction Chat Threads + Bulk Messaging

## Overview
Three features: (1) convert flat messages into threaded conversations per transaction, (2) allow employees to reply, (3) allow admins to bulk-message multiple missing receipts at once.

## Database Changes

**RLS policy update**: Add a new INSERT policy so employees can also send messages (replies). Currently only admins can insert.

```sql
CREATE POLICY "Authenticated users can reply to their conversations"
ON public.receipt_messages
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1 FROM public.receipt_messages rm
    WHERE rm.transaction_id = receipt_messages.transaction_id
    AND (rm.sender_id = auth.uid() OR rm.recipient_id = auth.uid())
  )
);
```

This is tricky because the row doesn't exist yet during INSERT. A simpler approach: allow any authenticated user to insert as long as `sender_id = auth.uid()`.

```sql
CREATE POLICY "Users can send messages"
ON public.receipt_messages
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = sender_id);
```

This replaces the admin-only insert policy, since we still control who can be messaged via the UI. Drop the old "Admins can send messages" policy.

## Part 1: Employee Messages Page — Threaded Conversation View

Transform `src/pages/employee/Messages.tsx` from a flat list into a grouped-by-transaction view with inline reply.

- **Group messages by `transaction_id`**: Fetch all messages where user is sender OR recipient (to show their own replies too). Group into threads by `transaction_id`.
- **Thread list view**: Show one card per transaction thread, with latest message preview, unread count badge, vendor/amount context.
- **Thread detail view**: Clicking a thread opens a conversation view (inline expand or panel) showing all messages in chronological order, with sender labels ("Admin" vs "You").
- **Reply input**: At the bottom of each open thread, a Textarea + Send button. On send, insert into `receipt_messages` with `sender_id = user.id`, `recipient_id = original sender (admin)`, same `transaction_id`.
- **Mark all thread messages as read** when thread is opened.

## Part 2: Admin Messages Page — Same Threaded View

The admin Messages page (`/employee/messages` which both roles access) should work identically — fetch messages where user is sender or recipient, group by transaction, allow replies.

Update the fetch query to include messages where `sender_id = user.id` in addition to `recipient_id = user.id`.

## Part 3: Bulk Message from Matching Page

In `src/pages/admin/Matching.tsx`, on the "Tx Missing Receipt" tab:

- **Add checkboxes** to each transaction row (similar to existing bulk actions on other tabs).
- **"Message Selected" button** in the tab header area, enabled when 1+ rows are checked.
- Clicking opens a Dialog:
  - Title: "Send Message to N employees"
  - List of selected transactions (vendor, amount, employee) as a summary
  - Single Textarea with a template message (same pattern as single message)
  - Send button loops through selected transactions and inserts one `receipt_messages` row per transaction/employee pair
  - Toast: "N messages sent"

**State additions**: `selectedMissingTxIds: Set<string>`, select-all checkbox, "Message Selected" button.

## Files to Change

1. **Migration**: Drop old admin-only INSERT policy, add new authenticated INSERT policy
2. **`src/pages/employee/Messages.tsx`**: Complete rewrite — threaded conversation view with reply capability
3. **`src/pages/admin/Matching.tsx`**: Add bulk selection + bulk message dialog to "Tx Missing Receipt" tab

