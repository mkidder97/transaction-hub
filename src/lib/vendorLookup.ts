import { supabase } from "@/integrations/supabase/client";

// ─── Levenshtein distance ──────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[la][lb];
}

// ─── Types ─────────────────────────────────────────────────────────────

export interface VendorMatch {
  canonical_name: string;
  default_category_id: string | null;
}

interface KnownVendor {
  id: string;
  raw_name: string;
  canonical_name: string;
  default_category_id: string | null;
}

// ─── Lookup ────────────────────────────────────────────────────────────

let cachedVendors: KnownVendor[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

async function getKnownVendors(): Promise<KnownVendor[]> {
  if (cachedVendors && Date.now() - cacheTime < CACHE_TTL) return cachedVendors;
  const { data } = await supabase.from("known_vendors").select("id, raw_name, canonical_name, default_category_id");
  cachedVendors = (data as KnownVendor[]) ?? [];
  cacheTime = Date.now();
  return cachedVendors;
}

export function invalidateVendorCache() {
  cachedVendors = null;
}

/**
 * Fuzzy-match an OCR vendor string against known_vendors.
 * Match if Levenshtein distance ≤ 2 (case-insensitive).
 * Also match if the OCR string contains the raw_name or vice versa,
 * BUT only when edit distance is also ≤ 2 to avoid false positives.
 */
export async function lookupVendor(ocrVendor: string): Promise<VendorMatch | null> {
  if (!ocrVendor || ocrVendor.trim().length === 0) return null;

  const vendors = await getKnownVendors();
  const needle = ocrVendor.trim().toLowerCase();

  let bestMatch: KnownVendor | null = null;
  let bestDist = Infinity;

  for (const v of vendors) {
    const raw = v.raw_name.toLowerCase();
    const dist = levenshtein(needle, raw);

    if (dist <= 2 && dist < bestDist) {
      bestDist = dist;
      bestMatch = v;
    }
  }

  if (bestMatch) {
    return {
      canonical_name: bestMatch.canonical_name,
      default_category_id: bestMatch.default_category_id,
    };
  }

  return null;
}

// ─── Candidate submission ──────────────────────────────────────────────

export async function submitVendorCandidate(
  rawName: string,
  suggestedName: string,
  suggestedCategoryId: string | null,
  userId: string,
): Promise<void> {
  // Don't submit if it's already a known vendor
  const existing = await lookupVendor(rawName);
  if (existing) return;

  // Don't submit duplicates
  const { data: dup } = await supabase
    .from("vendor_candidates")
    .select("id")
    .eq("raw_name", rawName)
    .eq("status", "pending")
    .limit(1);
  if (dup && dup.length > 0) return;

  await supabase.from("vendor_candidates").insert({
    raw_name: rawName,
    suggested_name: suggestedName,
    suggested_category_id: suggestedCategoryId || null,
    submitted_by: userId,
    status: "pending",
  });
}
