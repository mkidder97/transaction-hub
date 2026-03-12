import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Receipt as ReceiptIcon } from "lucide-react";
import { useSignedUrl } from "@/hooks/useSignedUrl";

interface ReceiptRow {
  id: string;
  photo_url: string | null;
  storage_path: string | null;
  vendor_extracted: string | null;
  vendor_confirmed: string | null;
  amount_extracted: number | null;
  amount_confirmed: number | null;
  date_extracted: string | null;
  date_confirmed: string | null;
  ai_confidence: number | null;
  ai_raw_text: string | null;
  status: string;
  match_status: string;
  match_confidence: number | null;
  flag_reason: string | null;
  notes: string | null;
  transaction_id: string | null;
  created_at: string;
  category: { id: string; name: string } | null;
}

const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  reviewed: "bg-primary/15 text-primary",
  approved: "bg-accent/15 text-accent",
  flagged: "bg-destructive/15 text-destructive",
};

const matchColor: Record<string, string> = {
  unmatched: "bg-muted text-muted-foreground",
  matched: "bg-accent/15 text-accent",
  partial: "bg-warning/15 text-warning",
};

function Field({
  label,
  extracted,
  confirmed,
}: {
  label: string;
  extracted: string | null;
  confirmed: string | null;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{confirmed ?? extracted ?? "—"}</dd>
      {confirmed && extracted && confirmed !== extracted && (
        <dd className="text-[11px] text-muted-foreground line-through">
          {extracted}
        </dd>
      )}
    </div>
  );
}

export function ReceiptDetailPanel({
  receipt,
  onClose,
}: {
  receipt: ReceiptRow | null;
  onClose: () => void;
}) {
  const signedUrl = useSignedUrl(receipt?.storage_path ?? null);

  if (!receipt) return null;

  const r = receipt;

  return (
    <Sheet open={!!receipt} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">Receipt Details</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Image */}
          <div className="rounded-lg overflow-hidden bg-muted aspect-[3/4] max-h-72 flex items-center justify-center">
            {signedUrl ? (
              <img
                src={signedUrl}
                alt="Receipt"
                className="w-full h-full object-contain"
              />
            ) : (
              <ReceiptIcon className="h-12 w-12 text-muted-foreground" />
            )}
          </div>

          {/* Status badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="secondary"
              className={statusColor[r.status] ?? ""}
            >
              {r.status}
            </Badge>
            <Badge
              variant="secondary"
              className={matchColor[r.match_status] ?? ""}
            >
              {r.match_status}
            </Badge>
            {r.ai_confidence != null && (
              <Badge variant="outline" className="text-xs">
                {Math.round(r.ai_confidence * 100)}% OCR
              </Badge>
            )}
          </div>

          <Separator />

          {/* Fields */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field
              label="Vendor"
              extracted={r.vendor_extracted}
              confirmed={r.vendor_confirmed}
            />
            <Field
              label="Amount"
              extracted={
                r.amount_extracted != null
                  ? `$${r.amount_extracted.toFixed(2)}`
                  : null
              }
              confirmed={
                r.amount_confirmed != null
                  ? `$${r.amount_confirmed.toFixed(2)}`
                  : null
              }
            />
            <Field
              label="Date"
              extracted={r.date_extracted}
              confirmed={r.date_confirmed}
            />
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Category</dt>
              <dd className="text-sm font-medium">
                {r.category?.name ?? "—"}
              </dd>
            </div>
          </dl>

          {/* Flag reason */}
          {r.flag_reason && (
            <>
              <Separator />
              <div className="space-y-1">
                <p className="text-xs font-medium text-destructive">
                  Flag Reason
                </p>
                <p className="text-sm">{r.flag_reason}</p>
              </div>
            </>
          )}

          {/* Match info */}
          {r.transaction_id && (
            <>
              <Separator />
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Matched Transaction
                </p>
                <p className="text-sm font-mono text-xs">
                  {r.transaction_id}
                </p>
                {r.match_confidence != null && (
                  <p className="text-xs text-muted-foreground">
                    Match confidence: {Math.round(r.match_confidence * 100)}%
                  </p>
                )}
              </div>
            </>
          )}

          {/* Notes */}
          {r.notes && (
            <>
              <Separator />
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm">{r.notes}</p>
              </div>
            </>
          )}

          {/* Meta */}
          <Separator />
          <p className="text-[11px] text-muted-foreground">
            Submitted {new Date(r.created_at).toLocaleString()}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
