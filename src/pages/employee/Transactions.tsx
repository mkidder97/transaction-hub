import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Receipt, FileText } from "lucide-react";

interface Period { id: string; name: string; is_current: boolean }

interface TransactionRow {
  id: string;
  transaction_date: string | null;
  vendor_raw: string | null;
  vendor_normalized: string | null;
  amount: number | null;
  card_last_four: string | null;
  match_status: string;
  statement_period_id: string | null;
}

const MATCH_OPTIONS = ["all", "unmatched", "matched"] as const;

const matchColor: Record<string, string> = {
  unmatched: "bg-warning/15 text-warning",
  matched: "bg-accent/15 text-accent",
  manual_match: "bg-primary/15 text-primary",
};

const EmployeeTransactions = () => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [linkedTxIds, setLinkedTxIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodFilter, setPeriodFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");

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

  useEffect(() => {
    if (!user) return;
    setLoading(true);

    let query = supabase
      .from("transactions")
      .select("id, transaction_date, vendor_raw, vendor_normalized, amount, card_last_four, match_status, statement_period_id")
      .eq("user_id", user.id)
      .order("transaction_date", { ascending: false });

    if (periodFilter && periodFilter !== "all") {
      query = query.eq("statement_period_id", periodFilter);
    }
    if (matchFilter !== "all") {
      query = query.eq("match_status", matchFilter);
    }

    query.then(async ({ data, error }) => {
      if (!error && data) {
        setTransactions(data as TransactionRow[]);
        const ids = data.map((t) => t.id);
        if (ids.length > 0) {
          const { data: receipts } = await supabase
            .from("receipts")
            .select("transaction_id")
            .in("transaction_id", ids);
          if (receipts) {
            setLinkedTxIds(new Set(receipts.map((r) => r.transaction_id!).filter(Boolean)));
          }
        } else {
          setLinkedTxIds(new Set());
        }
      }
      setLoading(false);
    });
  }, [user, periodFilter, matchFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Transactions</h1>
        <p className="text-muted-foreground text-sm">View card transactions assigned to you.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Statement period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All periods</SelectItem>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}{p.is_current ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={matchFilter} onValueChange={setMatchFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Match status" />
          </SelectTrigger>
          <SelectContent>
            {MATCH_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <FileText className="h-10 w-10" />
            <p className="text-sm">No transactions found for this period.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden sm:table-cell">Card</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-sm">{t.transaction_date ?? "—"}</TableCell>
                  <TableCell className="text-sm font-medium truncate max-w-[200px]">
                    {t.vendor_normalized ?? t.vendor_raw ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right font-medium">
                    {t.amount != null ? `$${t.amount.toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {t.card_last_four ? `•••• ${t.card_last_four}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${matchColor[t.match_status] ?? ""}`}>
                      {t.match_status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {linkedTxIds.has(t.id) && <Receipt className="h-4 w-4 text-accent" />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default EmployeeTransactions;
