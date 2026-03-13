-- Drop old admin-only INSERT policy
DROP POLICY IF EXISTS "Admins can send messages" ON public.receipt_messages;

-- Allow any authenticated user to insert messages as long as they are the sender
CREATE POLICY "Users can send messages"
ON public.receipt_messages
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = sender_id);

-- Update policy to allow both sender and recipient to update
DROP POLICY IF EXISTS "Recipients can mark read" ON public.receipt_messages;
CREATE POLICY "Participants can update messages"
ON public.receipt_messages
FOR UPDATE TO authenticated
USING (auth.uid() = recipient_id OR auth.uid() = sender_id)
WITH CHECK (auth.uid() = recipient_id OR auth.uid() = sender_id);