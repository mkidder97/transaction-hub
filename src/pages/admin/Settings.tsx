import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Lock, CalendarDays, Tag, Settings2, BookOpen } from "lucide-react";
import { toast } from "sonner";
import VendorManagement from "@/components/admin/VendorManagement";

// ---------- Types ----------

interface Period {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  is_closed: boolean;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface AppSetting {
  id: string;
  key: string;
  value: string | null;
  description: string | null;
}

// ========== Component ==========

const AdminSettings = () => {
  // --- Statement Periods ---
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: "", start_date: "", end_date: "" });
  const [periodSaving, setPeriodSaving] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const fetchPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    const { data } = await supabase
      .from("statement_periods")
      .select("*")
      .order("start_date", { ascending: false });
    if (data) setPeriods(data as Period[]);
    setPeriodsLoading(false);
  }, []);

  useEffect(() => { fetchPeriods(); }, [fetchPeriods]);

  const handleCreatePeriod = async () => {
    if (!newPeriod.name || !newPeriod.start_date || !newPeriod.end_date) return;
    setPeriodSaving(true);
    // Set all existing to not current
    await supabase.from("statement_periods").update({ is_current: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    const { error } = await supabase.from("statement_periods").insert({
      name: newPeriod.name,
      start_date: newPeriod.start_date,
      end_date: newPeriod.end_date,
      is_current: true,
    });
    setPeriodSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Period created");
    setNewPeriod({ name: "", start_date: "", end_date: "" });
    setShowNewPeriod(false);
    fetchPeriods();
  };

  const handleClosePeriod = async (id: string) => {
    setClosingId(id);
    const { error } = await supabase
      .from("statement_periods")
      .update({ is_closed: true, is_current: false })
      .eq("id", id);
    setClosingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Period closed");
    fetchPeriods();
  };

  // --- Expense Categories ---
  const [categories, setCategories] = useState<Category[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCat, setNewCat] = useState({ name: "", description: "" });
  const [catSaving, setCatSaving] = useState(false);

  const fetchCategories = useCallback(async () => {
    setCatsLoading(true);
    const { data } = await supabase.from("expense_categories").select("*").order("name");
    if (data) setCategories(data as Category[]);
    setCatsLoading(false);
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const handleCreateCategory = async () => {
    if (!newCat.name) return;
    setCatSaving(true);
    const { error } = await supabase.from("expense_categories").insert({
      name: newCat.name,
      description: newCat.description || null,
    });
    setCatSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Category added");
    setNewCat({ name: "", description: "" });
    setShowNewCat(false);
    fetchCategories();
  };

  const toggleCategory = async (id: string, current: boolean) => {
    const { error } = await supabase
      .from("expense_categories")
      .update({ is_active: !current })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, is_active: !current } : c)));
  };

  // --- App Settings ---
  const [appSettings, setAppSettings] = useState<AppSetting[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);

  const fetchAppSettings = useCallback(async () => {
    setSettingsLoading(true);
    const { data } = await supabase.from("app_settings").select("*").order("key");
    if (data) {
      setAppSettings(data as AppSetting[]);
      const vals: Record<string, string> = {};
      for (const s of data) vals[s.key] = s.value ?? "";
      setSettingsValues(vals);
    }
    setSettingsLoading(false);
  }, []);

  useEffect(() => { fetchAppSettings(); }, [fetchAppSettings]);

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    let hasError = false;
    for (const s of appSettings) {
      const newVal = settingsValues[s.key] ?? "";
      if (newVal !== (s.value ?? "")) {
        const { error } = await supabase
          .from("app_settings")
          .update({ value: newVal })
          .eq("id", s.id);
        if (error) { toast.error(`Failed to save ${s.key}`); hasError = true; }
      }
    }
    setSettingsSaving(false);
    if (!hasError) { toast.success("Settings saved"); fetchAppSettings(); }
  };

  // Known setting keys with specific input types
  const settingMeta: Record<string, { label: string; type: string }> = {
    auto_match_threshold: { label: "Auto-Match Threshold", type: "number" },
    notification_email: { label: "Notification Email", type: "email" },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage statement periods, expense categories, vendors, and app configuration.
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList>
          <TabsTrigger value="general" className="gap-1.5"><Settings2 className="h-3.5 w-3.5" /> General</TabsTrigger>
          <TabsTrigger value="vendors" className="gap-1.5"><BookOpen className="h-3.5 w-3.5" /> Vendors</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Statement Periods
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowNewPeriod(!showNewPeriod)}>
            <Plus className="h-3.5 w-3.5" /> New Period
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showNewPeriod && (
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input value={newPeriod.name} onChange={(e) => setNewPeriod((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. March 2026" className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Start Date</Label>
                  <Input type="date" value={newPeriod.start_date} onChange={(e) => setNewPeriod((p) => ({ ...p, start_date: e.target.value }))} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">End Date</Label>
                  <Input type="date" value={newPeriod.end_date} onChange={(e) => setNewPeriod((p) => ({ ...p, end_date: e.target.value }))} className="h-8" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreatePeriod} disabled={periodSaving || !newPeriod.name || !newPeriod.start_date || !newPeriod.end_date}>
                  {periodSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Create
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewPeriod(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {periodsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm">{p.start_date}</TableCell>
                    <TableCell className="text-sm">{p.end_date}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {p.is_current && <Badge className="bg-accent/15 text-accent text-[10px] px-1.5 py-0">Current</Badge>}
                        {p.is_closed && <Badge className="bg-muted text-muted-foreground text-[10px] px-1.5 py-0">Closed</Badge>}
                        {!p.is_current && !p.is_closed && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Open</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.is_current && !p.is_closed && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleClosePeriod(p.id)} disabled={closingId === p.id}>
                          {closingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                          Close
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ===== Expense Categories ===== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" /> Expense Categories
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowNewCat(!showNewCat)}>
            <Plus className="h-3.5 w-3.5" /> Add Category
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showNewCat && (
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input value={newCat.name} onChange={(e) => setNewCat((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. Travel" className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input value={newCat.description} onChange={(e) => setNewCat((c) => ({ ...c, description: e.target.value }))} placeholder="Optional" className="h-8" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreateCategory} disabled={catSaving || !newCat.name}>
                  {catSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewCat(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {catsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories yet.</p>
          ) : (
            <div className="divide-y">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.description && <span className="text-xs text-muted-foreground ml-2">— {c.description}</span>}
                  </div>
                  <Switch checked={c.is_active} onCheckedChange={() => toggleCategory(c.id, c.is_active)} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== App Settings ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> App Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : appSettings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No settings configured.</p>
          ) : (
            <>
              <div className="space-y-3">
                {appSettings.map((s) => {
                  const meta = settingMeta[s.key];
                  return (
                    <div key={s.id} className="space-y-1">
                      <Label className="text-xs">{meta?.label ?? s.key}</Label>
                      <Input
                        type={meta?.type ?? "text"}
                        step={meta?.type === "number" ? "0.01" : undefined}
                        min={meta?.type === "number" ? "0" : undefined}
                        max={s.key === "auto_match_threshold" ? "1" : undefined}
                        value={settingsValues[s.key] ?? ""}
                        onChange={(e) => setSettingsValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
                        placeholder={s.value ?? "Not set"}
                        className="h-8 max-w-sm"
                      />
                      {s.description && <p className="text-[11px] text-muted-foreground">{s.description}</p>}
                    </div>
                  );
                })}
              </div>
              <Button size="sm" onClick={handleSaveSettings} disabled={settingsSaving}>
                {settingsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Save Settings
              </Button>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="vendors">
          <VendorManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminSettings;
