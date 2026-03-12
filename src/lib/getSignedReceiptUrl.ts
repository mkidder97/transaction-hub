import { supabase } from "@/integrations/supabase/client";

const cache: Record<string, { url: string; expiresAt: number }> = {};
const TTL_SECONDS = 3600;
const REFRESH_BEFORE_EXPIRY = 300;

export async function getSignedReceiptUrl(
  storagePath: string | null
): Promise<string | null> {
  if (!storagePath) return null;

  const now = Math.floor(Date.now() / 1000);
  const cached = cache[storagePath];
  if (cached && cached.expiresAt - now > REFRESH_BEFORE_EXPIRY) {
    return cached.url;
  }

  const { data, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(storagePath, TTL_SECONDS);

  if (error || !data?.signedUrl) return null;

  cache[storagePath] = {
    url: data.signedUrl,
    expiresAt: now + TTL_SECONDS,
  };

  return data.signedUrl;
}
