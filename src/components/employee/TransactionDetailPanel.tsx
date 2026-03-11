import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ExternalLink, Receipt, Calendar, Store, CreditCard, DollarSign, FileText } from "lucide-react";
import { ExternalLink, Receipt, Calendar, Store, CreditCard, DollarSign, FileText } from "lucide-react";

interface TransactionDetailPanelProps {
  transactionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TransactionDetail {
  id: string;
  transaction_date: string | null;
  vendor_raw: string | null;
  vendor_normalized: string | null;
  amount: number | null;
  card_last_four: string | null;
  match_status: string;
  source: string;
  notes: string | null;
  created_at: string;
}

interface LinkedReceipt {
  id: string;
  vendor_confirmed: string | null;
  amount_confirmed: number | null;
  date_confirmed: string | null;
  status: string;
  match_status: string;
  photo_url: string | null;
  storage_path: string | null;
  ai_confidence: number | null;
}

const matchColor: Record<string, string> = {
  unmatched: "bg-warning/15 text-warning",
  matched: "bg-accent/15 text-accent",
  manual_match: "bg-primary/15 text-primary",
};

export function TransactionDetailPanel({ transactionId, open, onOpenChange }: TransactionDetailPanelProps) {
  const [tx, setTx] = useState<TransactionDetail | null>(null);
  const [receipt, setReceipt] = useState<LinkedReceipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!transactionId || !open) return;
    setLoading(true);
    setTx(null);
    setReceipt(null);
    setImageUrl(null);

    (async () => {
      const { data: txData } = await supabase
        .from("transactions")
        .select("id, transaction_date, vendor_raw, vendor_normalized, amount, card_last_four, match_status, source, notes, created_at")
        .eq("id", transactionId)
        .single();

      if (txData) setTx(txData);

      // Find linked receipt
      const { data: receiptData } = await supabase
        .from("receipts")
        .select("id, vendor_confirmed, amount_confirmed, date_confirmed, status, match_status, photo_url, storage_path, ai_confidence")
        .eq("transaction_id", transactionId)
        .limit(1)
        .maybeSingle();

      if (receiptData) {
        setReceipt(receiptData);
        // Get signed URL for private bucket
        if (receiptData.storage_path) {
          const { data: signedData } = await supabase.storage
            .from("receipts")
            .createSignedUrl(receiptData.storage_path, 300);
          if (signedData?.signedUrl) setImageUrl(signedData.signedUrl);
        }
      }

      setLoading(false);
    })();
  }, [transactionId, open]);

  const DetailRow = ({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) => (
    <div className="flex items-start gap-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value || "—"}</p>
      </div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Transaction Details</SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="space-y-4 mt-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : tx ? (
          <div className="space-y-4 mt-4">
            <div className="space-y-1">
              <DetailRow icon={Store} label="Vendor" value={tx.vendor_normalized ?? tx.vendor_raw} />
              <DetailRow icon={DollarSign} label="Amount" value={tx.amount != null ? `$${tx.amount.toFixed(2)}` : null} />
              <DetailRow icon={Calendar} label="Date" value={tx.transaction_date} />
              <DetailRow icon={CreditCard} label="Card" value={tx.card_last_four ? `•••• ${tx.card_last_four}` : null} />
              <DetailRow icon={FileText} label="Source" value={tx.source === "screenshot" ? "Screenshot Import" : "CSV Import"} />
              <div className="flex items-start gap-3 py-2">
                <Receipt className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Match Status</p>
                  <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 mt-0.5 ${matchColor[tx.match_status] ?? ""}`}>
                    {tx.match_status}
                  </Badge>
                </div>
              </div>
              {tx.notes && <DetailRow icon={FileText} label="Notes" value={tx.notes} />}
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3">Linked Receipt</h3>
              {receipt ? (
                <div className="space-y-3">
                  {imageUrl ? (
                    <div className="rounded-lg border overflow-hidden bg-muted">
                      <img
                        src={imageUrl}
                        alt="Receipt"
                        className="w-full max-h-[300px] object-contain"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border bg-muted flex items-center justify-center py-8 text-muted-foreground text-sm">
                      No image available
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Vendor</p>
                      <p className="font-medium">{receipt.vendor_confirmed ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Amount</p>
                      <p className="font-medium">{receipt.amount_confirmed != null ? `$${receipt.amount_confirmed.toFixed(2)}` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p className="font-medium">{receipt.date_confirmed ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {receipt.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/50 flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                  <Receipt className="h-8 w-8" />
                  <p className="text-sm">No receipt linked yet</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground mt-4">Transaction not found.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
