import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, Plus, Check, X, BookOpen, Inbox, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { invalidateVendorCache } from "@/lib/vendorLookup";

interface KnownVendor {
  id: string;
  raw_name: string;
  canonical_name: string;
  default_category_id: string | null;
  created_at: string;
}

interface VendorCandidate {
  id: string;
  raw_name: string;
  suggested_name: string;
  suggested_category_id: string | null;
  submitted_by: string | null;
  status: string;
  created_at: string;
}

interface Category {
  id: string;
  name: string;
}

const VendorManagement = () => {
  // --- Known Vendors ---
  const [vendors, setVendors] = useState<KnownVendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [newVendor, setNewVendor] = useState({ raw_name: "", canonical_name: "", category_id: "" });
  const [vendorSaving, setVendorSaving] = useState(false);

  // --- Candidates ---
  const [candidates, setCandidates] = useState<VendorCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // --- Categories ---
  const [categories, setCategories] = useState<Category[]>([]);

  const fetchVendors = useCallback(async () => {
    setVendorsLoading(true);
    const { data } = await supabase.from("known_vendors").select("*").order("canonical_name");
    if (data) setVendors(data as KnownVendor[]);
    setVendorsLoading(false);
  }, []);

  const fetchCandidates = useCallback(async () => {
    setCandidatesLoading(true);
    const { data } = await supabase
      .from("vendor_candidates")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (data) setCandidates(data as VendorCandidate[]);
    setCandidatesLoading(false);
  }, []);

  useEffect(() => {
    fetchVendors();
    fetchCandidates();
    supabase
      .from("expense_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => { if (data) setCategories(data); });
  }, [fetchVendors, fetchCandidates]);

  const handleCreateVendor = async () => {
    if (!newVendor.raw_name || !newVendor.canonical_name) return;
    setVendorSaving(true);
    const { error } = await supabase.from("known_vendors").insert({
      raw_name: newVendor.raw_name,
      canonical_name: newVendor.canonical_name,
      default_category_id: newVendor.category_id || null,
    });
    setVendorSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Vendor added to dictionary");
    setNewVendor({ raw_name: "", canonical_name: "", category_id: "" });
    setShowNewVendor(false);
    invalidateVendorCache();
    fetchVendors();
  };

  const handleDeleteVendor = async (id: string) => {
    const { error } = await supabase.from("known_vendors").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setVendors((prev) => prev.filter((v) => v.id !== id));
    invalidateVendorCache();
    toast.success("Vendor removed");
  };

  const handleApproveCandidate = async (c: VendorCandidate) => {
    setProcessingId(c.id);
    // Insert into known_vendors
    const { error: insertErr } = await supabase.from("known_vendors").insert({
      raw_name: c.raw_name,
      canonical_name: c.suggested_name,
      default_category_id: c.suggested_category_id,
    });
    if (insertErr) { toast.error(insertErr.message); setProcessingId(null); return; }

    // Mark candidate as approved
    await supabase.from("vendor_candidates").update({ status: "approved" }).eq("id", c.id);
    setProcessingId(null);
    invalidateVendorCache();
    toast.success(`"${c.suggested_name}" approved and added to dictionary`);
    fetchVendors();
    fetchCandidates();
  };

  const handleRejectCandidate = async (id: string) => {
    setProcessingId(id);
    await supabase.from("vendor_candidates").update({ status: "rejected" }).eq("id", id);
    setProcessingId(null);
    setCandidates((prev) => prev.filter((c) => c.id !== id));
    toast.success("Candidate rejected");
  };

  const getCategoryName = (id: string | null) => {
    if (!id) return "—";
    return categories.find((c) => c.id === id)?.name ?? "—";
  };

  return (
    <div className="space-y-6">
      {/* ===== Pending Candidates ===== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Pending Vendor Suggestions
            {candidates.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5">{candidates.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {candidatesLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending suggestions.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OCR Name</TableHead>
                  <TableHead>Suggested Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm font-mono text-muted-foreground">{c.raw_name}</TableCell>
                    <TableCell className="text-sm font-medium">{c.suggested_name}</TableCell>
                    <TableCell className="text-sm">{getCategoryName(c.suggested_category_id)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 text-accent-foreground"
                          onClick={() => handleApproveCandidate(c)}
                          disabled={processingId === c.id}
                        >
                          {processingId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1"
                          onClick={() => handleRejectCandidate(c.id)}
                          disabled={processingId === c.id}
                        >
                          <X className="h-3 w-3" /> Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ===== Known Vendors Dictionary ===== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Vendor Dictionary
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowNewVendor(!showNewVendor)}>
            <Plus className="h-3.5 w-3.5" /> Add Vendor
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showNewVendor && (
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">OCR Raw Name</Label>
                  <Input
                    value={newVendor.raw_name}
                    onChange={(e) => setNewVendor((v) => ({ ...v, raw_name: e.target.value }))}
                    placeholder="e.g. RACETRAC 2370"
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Canonical Name</Label>
                  <Input
                    value={newVendor.canonical_name}
                    onChange={(e) => setNewVendor((v) => ({ ...v, canonical_name: e.target.value }))}
                    placeholder="e.g. RaceTrac"
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Default Category</Label>
                  <Select value={newVendor.category_id} onValueChange={(v) => setNewVendor((prev) => ({ ...prev, category_id: v }))}>
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreateVendor} disabled={vendorSaving || !newVendor.raw_name || !newVendor.canonical_name}>
                  {vendorSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewVendor(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {vendorsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : vendors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vendors in dictionary yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OCR Name</TableHead>
                  <TableHead>Canonical Name</TableHead>
                  <TableHead>Default Category</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="text-sm font-mono text-muted-foreground">{v.raw_name}</TableCell>
                    <TableCell className="text-sm font-medium">{v.canonical_name}</TableCell>
                    <TableCell className="text-sm">{getCategoryName(v.default_category_id)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDeleteVendor(v.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TableCell>
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

export default VendorManagement;
