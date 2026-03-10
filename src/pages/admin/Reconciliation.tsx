import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { runMatchingForPeriod, type PeriodMatchSummary } from "@/lib/matcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Zap, FileCheck, AlertTriangle, FileX, Files } from "lucide-react";
import { toast } from "sonner";

interface Period {
  id: string;
  name: string;
  is_current: boolean;
}

interface Stats {
  total: number;
  matched: number;
  manual_match: number;
  unmatched: number;
}

const Reconciliation = () => {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<PeriodMatchSummary | null>(null);
  const [stats, setStats] = useState<Stats>({ total: 0, matched: 0, manual_match: 0, unmatched: 0 });
  const [statsLoading, setStatsLoading] = useState(false);

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
          if (current) setPeriodId(current.id);
        }
      });
  }, []);

  // Fetch stats for selected period
  const fetchStats = useCallback(async (pid: string) => {
    if (!pid) return;
    setStatsLoading(true);
    const { data, error } = await supabase
      .from("receipts")
      .select("match_status")
      .eq("statement_period_id", pid);

    if (!error && data) {
      const total = data.length;
      const matched = data.filter((r) => r.match_status === "matched").length;
      const manual_match = data.filter((r) => r.match_status === "manual_match").length;
      const unmatched = data.filter((r) => r.match_status === "unmatched").length;
      setStats({ total, matched, manual_match, unmatched });
    }
    setStatsLoading(false);
  }, []);

  useEffect(() => {
    if (periodId) fetchStats(periodId);
  }, [periodId, fetchStats]);

  // Run auto-match
  const handleRunMatch = async () => {
    if (!periodId) return;
    setRunning(true);
    setLastResult(null);
    try {
      const result = await runMatchingForPeriod(periodId);
      setLastResult(result);
      toast.success("Matching complete!");
      fetchStats(periodId);
    } catch (err: any) {
      toast.error(err.message ?? "Matching failed");
    } finally {
      setRunning(false);
    }
  };

  const statCards: { label: string; value: number; icon: React.ReactNode; color: string }[] = [
    { label: "Total Receipts", value: stats.total, icon: <Files className="h-5 w-5" />, color: "text-foreground" },
    { label: "Auto-Matched", value: stats.matched, icon: <FileCheck className="h-5 w-5" />, color: "text-accent" },
    { label: "Pending Review", value: stats.manual_match, icon: <AlertTriangle className="h-5 w-5" />, color: "text-warning" },
    { label: "Unmatched", value: stats.unmatched, icon: <FileX className="h-5 w-5" />, color: "text-destructive" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reconciliation</h1>
        <p className="text-muted-foreground text-sm">
          Match receipts to transactions and resolve discrepancies.
        </p>
      </div>

      {/* Period selector + Run button */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={periodId} onValueChange={setPeriodId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}{p.is_current ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button className="gap-2" onClick={handleRunMatch} disabled={running || !periodId}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {running ? "Matching receipts to transactions…" : "Run Auto-Match"}
        </Button>
      </div>

      {/* Result summary */}
      {lastResult && !running && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="p-4 text-sm flex items-center gap-4 flex-wrap">
            <span className="font-semibold">Last Run:</span>
            <span className="text-accent font-medium">Matched: {lastResult.matched}</span>
            <span className="text-warning font-medium">Needs Review: {lastResult.needs_review}</span>
            <span className="text-muted-foreground font-medium">No Match: {lastResult.skipped}</span>
          </CardContent>
        </Card>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex flex-col gap-1">
              <div className={`flex items-center gap-2 ${s.color}`}>
                {s.icon}
                <span className="text-2xl font-bold">
                  {statsLoading ? "–" : s.value}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Reconciliation;
