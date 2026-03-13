CREATE TABLE public.receipt_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id UUID REFERENCES public.receipts(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id),
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.receipt_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own messages" ON public.receipt_messages
FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "Admins can send messages" ON public.receipt_messages
FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "Recipients can mark read" ON public.receipt_messages
FOR UPDATE USING (auth.uid() = recipient_id)
WITH CHECK (auth.uid() = recipient_id);