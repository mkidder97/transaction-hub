import { useState, useEffect } from "react";
import { getSignedReceiptUrl } from "@/lib/getSignedReceiptUrl";

export function useSignedUrl(storagePath: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!storagePath) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    getSignedReceiptUrl(storagePath).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return url;
}
