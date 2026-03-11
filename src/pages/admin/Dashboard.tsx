import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Receipt, CheckCircle, Flag, FileX, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

interface StatCards {
  total: number;
  approved: number;
  flagged: number;
  unmatched: number;
}

interface RecentReceipt {
  id: string;
  vendor_confirmed: string | null;
  vendor_extracted: string | null;
  amount_confirmed: number | null;
  amount_extracted: number | null;
  status: string;
  created_at: string;
  employee: { full_name: string | null } | null;
}

interface UnmatchedTx {
  id: string;
  vendor_normalized: string | null;
  vendor_raw: string | null;
  amount: number | null;
  card_last_four: string | null;
  transaction_date: string | null;
}

interface DeptRow {
  department: string;
  total: number;
  approved: number;
  flagged: number;
  pending: number;
}

const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  reviewed: "bg-primary/15 text-primary",
  approved: "bg-accent/15 text-accent",
  flagged: "bg-destructive/15 text-destructive",
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [periodName, setPeriodName] = useState<string | null>(null);
  const [stats, setStats] = useState<StatCards>({ total: 0, approved: 0, flagged: 0, unmatched: 0 });
  const [recentReceipts, setRecentReceipts] = useState<RecentReceipt[]>([]);
  const [unmatchedTxs, setUnmatchedTxs] = useState<UnmatchedTx[]>([]);
  const [deptRows, setDeptRows] = useState<DeptRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      // Get current period
      const { data: period } = await supabase
        .from("statement_periods")
        .select("id, name")
        .eq("is_current", true)
        .limit(1)
        .single();

      if (!period) { setLoading(false); return; }
      setPeriodName(period.name);
      const pid = period.id;

      // Fetch all receipts for stats + dept breakdown
      const { data: allReceipts } = await supabase
        .from("receipts")
        .select("status, match_status, user_id, employee:profiles!receipts_user_id_fkey(department)")
        .eq("statement_period_id", pid);

      if (allReceipts) {
        setStats({
          total: allReceipts.length,
          approved: allReceipts.filter((r) => r.status === "approved").length,
          flagged: allReceipts.filter((r) => r.status === "flagged").length,
          unmatched: allReceipts.filter((r) => r.match_status === "unmatched").length,
        });

        // Dept breakdown
        const deptMap: Record<string, { total: number; approved: number; flagged: number; pending: number }> = {};
        for (const r of allReceipts) {
          const dept = (r.employee as any)?.department ?? "Unassigned";
          if (!deptMap[dept]) deptMap[dept] = { total: 0, approved: 0, flagged: 0, pending: 0 };
          deptMap[dept].total++;
          if (r.status === "approved") deptMap[dept].approved++;
          else if (r.status === "flagged") deptMap[dept].flagged++;
          else deptMap[dept].pending++;
        }
        setDeptRows(
          Object.entries(deptMap)
            .map(([department, d]) => ({ department, ...d }))
            .sort((a, b) => b.total - a.total),
        );
      }

      // Recent receipts
      const { data: recent } = await supabase
        .from("receipts")
        .select("id, vendor_confirmed, vendor_extracted, amount_confirmed, amount_extracted, status, created_at, employee:profiles!receipts_user_id_fkey(full_name)")
        .eq("statement_period_id", pid)
        .order("created_at", { ascending: false })
        .limit(5);
      if (recent) setRecentReceipts(recent as unknown as RecentReceipt[]);

      // Unmatched transactions
      const { data: txs } = await supabase
        .from("transactions")
        .select("id, vendor_normalized, vendor_raw, amount, card_last_four, transaction_date")
        .eq("statement_period_id", pid)
        .eq("match_status", "unmatched")
        .order("transaction_date", { ascending: false })
        .limit(5);
      if (txs) setUnmatchedTxs(txs as UnmatchedTx[]);

      setLoading(false);
    };
    load();
  }, []);

  const statCards = [
    { label: "Total Receipts", value: stats.total, icon: <Receipt className="h-5 w-5" />, color: "text-foreground" },
    { label: "Approved", value: stats.approved, icon: <CheckCircle className="h-5 w-5" />, color: "text-accent" },
    { label: "Flagged", value: stats.flagged, icon: <Flag className="h-5 w-5" />, color: "text-destructive" },
    { label: "Unmatched", value: stats.unmatched, icon: <FileX className="h-5 w-5" />, color: "text-warning", link: "/admin/matching?tab=needs-review" },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {periodName && <p className="text-muted-foreground text-sm">{periodName}</p>}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex flex-col gap-1">
              <div className={`flex items-center gap-2 ${s.color}`}>
                {s.icon}
                <span className="text-2xl font-bold">{s.value}</span>
              </div>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Middle two-column section */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Recent Receipts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Recent Receipts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentReceipts.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 pb-4">No receipts yet.</p>
            ) : (
              <div className="divide-y">
                {recentReceipts.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.vendor_confirmed ?? r.vendor_extracted ?? "Unknown"}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                        <span>{(r.employee as any)?.full_name ?? "—"}</span>
                        <span>•</span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-sm font-medium">
                        {(r.amount_confirmed ?? r.amount_extracted) != null
                          ? `$${(r.amount_confirmed ?? r.amount_extracted)!.toFixed(2)}`
                          : "—"}
                      </span>
                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusColor[r.status] ?? ""}`}>
                        {r.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unmatched Transactions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Unmatched Transactions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {unmatchedTxs.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 pb-4">All transactions matched!</p>
            ) : (
              <div className="divide-y">
                {unmatchedTxs.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {tx.vendor_normalized ?? tx.vendor_raw ?? "Unknown"}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                        {tx.card_last_four && <span>•••• {tx.card_last_four}</span>}
                        {tx.transaction_date && <span>{tx.transaction_date}</span>}
                      </div>
                    </div>
                    <span className="text-sm font-medium flex-shrink-0 ml-2">
                      {tx.amount != null ? `$${tx.amount.toFixed(2)}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* By Department */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">By Department</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deptRows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 pb-4">No data.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Submitted</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Flagged</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deptRows.map((d) => (
                  <TableRow key={d.department}>
                    <TableCell className="text-sm font-medium">{d.department}</TableCell>
                    <TableCell className="text-sm text-right">{d.total}</TableCell>
                    <TableCell className="text-sm text-right text-accent">{d.approved}</TableCell>
                    <TableCell className="text-sm text-right text-destructive">{d.flagged}</TableCell>
                    <TableCell className="text-sm text-right text-muted-foreground">{d.pending}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminDashboard;
