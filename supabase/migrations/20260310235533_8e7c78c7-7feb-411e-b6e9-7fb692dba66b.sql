
-- Allow authenticated users to upload to their own folder in receipts bucket
CREATE POLICY "Users can upload own receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'receipts' 
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Allow authenticated users to read their own receipts
CREATE POLICY "Users can read own receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'receipts' 
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Allow admins to read all receipts
CREATE POLICY "Admins can read all receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'receipts' 
  AND public.is_admin()
);
