import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ReceiptDetailPanel } from "@/components/employee/ReceiptDetailPanel";
import { Receipt, FileText } from "lucide-react";
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
  statement_period_id: string | null;
  transaction_id: string | null;
  created_at: string;
  category: { id: string; name: string } | null;
}

interface Period {
  id: string;
  name: string;
  is_current: boolean;
}

const STATUS_OPTIONS = ["all", "pending", "reviewed", "approved", "flagged"] as const;

const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  reviewed: "bg-primary/15 text-primary",
  approved: "bg-accent/15 text-accent",
  flagged: "bg-destructive/15 text-destructive",
};

function ReceiptListThumb({ storagePath }: { storagePath: string | null }) {
  const url = useSignedUrl(storagePath);
  if (!url) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Receipt className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }
  return <img src={url} alt="Receipt" className="h-full w-full object-cover" />;
}

const EmployeeReceipts = () => {
  const { user } = useAuth();
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<ReceiptRow | null>(null);

  // Fetch periods
  useEffect(() => {
    supabase
      .from("statement_periods")
      .select("id, name, is_current")
      .order("start_date", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setPeriods(data);
          const current = data.find((p) => p.is_current);
          if (current) setPeriodFilter(current.id);
        }
      });
  }, []);

  // Fetch receipts
  useEffect(() => {
    if (!user) return;
    setLoading(true);

    let query = supabase
      .from("receipts")
      .select("*, category:expense_categories(id, name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (periodFilter && periodFilter !== "all") {
      query = query.eq("statement_period_id", periodFilter);
    }
    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    query.then(({ data, error }) => {
      if (!error && data) setReceipts(data as unknown as ReceiptRow[]);
      setLoading(false);
    });
  }, [user, periodFilter, statusFilter]);

  const formatted = useMemo(
    () =>
      receipts.map((r) => ({
        ...r,
        vendor: r.vendor_confirmed ?? r.vendor_extracted ?? "Unknown",
        amount: r.amount_confirmed ?? r.amount_extracted,
        date: r.date_confirmed ?? r.date_extracted,
      })),
    [receipts],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Receipts</h1>
        <p className="text-muted-foreground text-sm">
          View and manage your submitted receipts.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Statement period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All periods</SelectItem>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.is_current ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : formatted.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <FileText className="h-10 w-10" />
            <p className="text-sm">No receipts found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {formatted.map((r) => (
            <Card
              key={r.id}
              className="cursor-pointer hover:ring-1 hover:ring-primary/30 transition-shadow"
              onClick={() => setSelected(r)}
            >
              <CardContent className="p-3 flex items-center gap-4">
                {/* Thumbnail */}
                <div className="h-14 w-14 rounded-md bg-muted flex-shrink-0 overflow-hidden">
                  <ReceiptListThumb storagePath={r.storage_path} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {r.vendor}
                    </span>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 ${statusColor[r.status] ?? ""}`}
                    >
                      {r.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {r.amount != null && (
                      <span className="font-medium text-foreground">
                        ${r.amount.toFixed(2)}
                      </span>
                    )}
                    {r.date && <span>{r.date}</span>}
                    {r.category && <span>{r.category.name}</span>}
                  </div>
                </div>

                {/* Created */}
                <span className="text-[11px] text-muted-foreground flex-shrink-0 hidden sm:block">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail panel */}
      <ReceiptDetailPanel
        receipt={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
};

export default EmployeeReceipts;
