CREATE POLICY "Admins can insert receipts"
ON public.receipts
FOR INSERT
TO authenticated
WITH CHECK (is_admin());