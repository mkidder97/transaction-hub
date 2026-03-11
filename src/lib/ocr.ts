// ─── Transaction parsing types ─────────────────────────────────────────

export interface ParsedTransaction {
  vendor: string;
  date: string;
  amount: number;
}

export interface ParsedTransactionRow {
  date: string;
  vendor: string;
  amount: string;
  card_last_four: string;
}

// ─── CSV / text parsing helpers (kept for CSV import) ──────────────────

const SKIP_PATTERNS = /sort by|transactions|filter|card ending|present|balance/i;

const dateRe = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4}\b/i;
const amountRe = /\$\s?([\d,]+\.\d{2})/;

export function parseTransactionList(rawText: string): ParsedTransaction[] {
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const results: ParsedTransaction[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (SKIP_PATTERNS.test(line)) { i++; continue; }

    const isVendorCandidate = line.length > 2 && !/^\d/.test(line) && !/^\$/.test(line);

    if (isVendorCandidate) {
      let foundDate: string | null = null;
      let foundAmount: number | null = null;
      let lastConsumed = i;

      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
        const ahead = lines[j];
        if (!foundDate) {
          const dm = ahead.match(dateRe);
          if (dm) {
            const d = new Date(dm[0]);
            if (!isNaN(d.getTime())) {
              foundDate = d.toISOString().split("T")[0];
              if (j > lastConsumed) lastConsumed = j;
            }
          }
        }
        if (foundAmount === null) {
          const am = ahead.match(amountRe);
          if (am) {
            foundAmount = parseFloat(am[1].replace(/,/g, ""));
            if (j > lastConsumed) lastConsumed = j;
          }
        }
      }

      if (!foundDate) {
        const dm = line.match(dateRe);
        if (dm) {
          const d = new Date(dm[0]);
          if (!isNaN(d.getTime())) foundDate = d.toISOString().split("T")[0];
        }
      }
      if (foundAmount === null) {
        const am = line.match(amountRe);
        if (am) foundAmount = parseFloat(am[1].replace(/,/g, ""));
      }

      if (foundDate && foundAmount !== null) {
        results.push({ vendor: line.replace(dateRe, "").replace(amountRe, "").trim() || line, date: foundDate, amount: foundAmount });
        i = lastConsumed + 1;
        continue;
      }
    }
    i++;
  }

  return results;
}

export function parseTransactionRows(rawText: string): ParsedTransactionRow[] {
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 5);
  const rows: ParsedTransactionRow[] = [];

  const rowDateRe = /(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2}|\d{2})/;
  const rowAmountRe = /\$?\s?([\d,]+\.\d{2})/;

  for (const line of lines) {
    const dateMatch = line.match(rowDateRe);
    const amountMatch = line.match(rowAmountRe);
    if (!dateMatch || !amountMatch) continue;

    let year = dateMatch[3];
    if (year.length === 2) year = "20" + year;
    const dateStr = `${year}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`;

    const amountVal = amountMatch[1].replace(/,/g, "");

    const dateEnd = dateMatch.index! + dateMatch[0].length;
    const amountStart = amountMatch.index!;
    let vendor = line.slice(dateEnd, amountStart).trim();
    if (!vendor) {
      vendor = line.slice(amountMatch.index! + amountMatch[0].length).trim();
    }
    vendor = vendor.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
    if (!vendor) vendor = "Unknown";

    rows.push({ date: dateStr, vendor, amount: amountVal, card_last_four: "" });
  }

  return rows;
}
