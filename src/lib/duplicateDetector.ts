import { supabase } from "@/integrations/supabase/client";

export interface DuplicateGroup {
  original: DuplicateReceipt;
  duplicate: DuplicateReceipt;
  matchReasons: string[];
  confidence: "high" | "medium";
}

export interface DuplicateReceipt {
  id: string;
  user_id: string;
  vendor_extracted: string | null;
  vendor_confirmed: string | null;
  amount_extracted: number | null;
  amount_confirmed: number | null;
  date_extracted: string | null;
  date_confirmed: string | null;
  photo_url: string | null;
  storage_path: string | null;
  match_status: string;
  duplicate_status: string | null;
  duplicate_of_id: string | null;
  created_at: string;
  employee: { full_name: string | null } | null;
}

function bigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/[^a-z0-9]/g, "");
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function vendorSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const bg1 = bigrams(a);
  const bg2 = bigrams(b);
  if (bg1.size === 0 || bg2.size === 0) return 0;
  let overlap = 0;
  for (const bi of bg1) if (bg2.has(bi)) overlap++;
  return (2 * overlap) / (bg1.size + bg2.size);
}

function getVendor(r: DuplicateReceipt) {
  return r.vendor_confirmed ?? r.vendor_extracted;
}
function getAmount(r: DuplicateReceipt) {
  return r.amount_confirmed ?? r.amount_extracted;
}
function getDate(r: DuplicateReceipt) {
  return r.date_confirmed ?? r.date_extracted;
}

export async function detectDuplicatesForPeriod(
  periodId: string
): Promise<DuplicateGroup[]> {
  const { data, error } = await supabase
    .from("receipts")
    .select(
      "id, user_id, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, photo_url, storage_path, match_status, duplicate_status, duplicate_of_id, created_at, employee:profiles!receipts_user_id_fkey(full_name)"
    )
    .eq("statement_period_id", periodId)
    .not("duplicate_status", "eq", "not_duplicate")
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const receipts = data as unknown as DuplicateReceipt[];
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < receipts.length; i++) {
    for (let j = i + 1; j < receipts.length; j++) {
      const a = receipts[i];
      const b = receipts[j];

      if (
        a.duplicate_status === "confirmed_duplicate" ||
        b.duplicate_status === "confirmed_duplicate"
      )
        continue;

      if (seen.has(`${a.id}-${b.id}`) || seen.has(`${b.id}-${a.id}`)) continue;

      const aAmount = getAmount(a);
      const bAmount = getAmount(b);
      const aDate = getDate(a);
      const bDate = getDate(b);
      const aVendor = getVendor(a);
      const bVendor = getVendor(b);

      const matchReasons: string[] = [];

      const amountMatch =
        aAmount != null &&
        bAmount != null &&
        Math.abs(aAmount - bAmount) <= 0.01;
      if (amountMatch)
        matchReasons.push(
          `Same amount (${aAmount != null ? `$${Number(aAmount).toFixed(2)}` : "—"})`
        );

      const dateMatch = !!aDate && !!bDate && aDate === bDate;
      if (dateMatch) matchReasons.push(`Same date (${aDate})`);

      const vendorSim = vendorSimilarity(aVendor, bVendor);
      const vendorMatch = vendorSim >= 0.75;
      if (vendorMatch) matchReasons.push(`Same vendor (${aVendor ?? "—"})`);

      const sameEmployee = a.user_id === b.user_id;
      if (sameEmployee && matchReasons.length > 0)
        matchReasons.push("Same employee");

      let confidence: "high" | "medium" | null = null;

      if (amountMatch && dateMatch && vendorMatch) {
        confidence = "high";
      } else if (amountMatch && dateMatch && sameEmployee) {
        confidence = "medium";
      } else if (amountMatch && vendorMatch && sameEmployee) {
        confidence = "medium";
      }

      if (confidence) {
        seen.add(`${a.id}-${b.id}`);
        groups.push({
          original: a,
          duplicate: b,
          matchReasons,
          confidence,
        });
      }
    }
  }

  return groups;
}
