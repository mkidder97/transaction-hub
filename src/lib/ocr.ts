import Tesseract from "tesseract.js";

export interface OcrResult {
  vendor_extracted: string | null;
  amount_extracted: number | null;
  date_extracted: string | null;
  ai_confidence: number;
  ai_raw_text: string;
}

function extractAmount(text: string): number | null {
  // Match patterns like $12.34, $ 12.34, 12.34, with optional thousands separators
  const patterns = [
    /\$\s?([\d,]+\.\d{2})\b/,
    /total[:\s]*\$?\s?([\d,]+\.\d{2})/i,
    /amount[:\s]*\$?\s?([\d,]+\.\d{2})/i,
    /due[:\s]*\$?\s?([\d,]+\.\d{2})/i,
    /balance[:\s]*\$?\s?([\d,]+\.\d{2})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseFloat(m[1].replace(/,/g, ""));
  }
  return null;
}

function extractDate(text: string): string | null {
  const patterns = [
    // MM/DD/YYYY or MM-DD-YYYY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2}|\d{2})\b/,
    // Month DD, YYYY
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2}),?\s+(20\d{2})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      try {
        const raw = m[0];
        const d = new Date(raw);
        if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
        // Fallback for MM/DD/YY
        if (m.length >= 4) {
          let year = m[3];
          if (year.length === 2) year = "20" + year;
          const month = m[1].padStart(2, "0");
          const day = m[2].padStart(2, "0");
          return `${year}-${month}-${day}`;
        }
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

function extractVendor(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 60);
  // First non-trivial line is often the store/vendor name
  for (const line of lines.slice(0, 5)) {
    // Skip lines that are mostly numbers or dates
    if (/^\d/.test(line)) continue;
    if (/^(total|subtotal|tax|amount|date|receipt|order)/i.test(line)) continue;
    return line;
  }
  return lines[0] ?? null;
}

export async function runOcrRaw(
  imageSource: string,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const result = await Tesseract.recognize(imageSource, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(m.progress);
      }
    },
  });
  return result.data.text;
}

export async function runOcr(
  imageSource: string,
  onProgress?: (progress: number) => void,
): Promise<OcrResult> {
  const rawText = await runOcrRaw(imageSource, onProgress);
  const vendor = extractVendor(rawText);
  const amount = extractAmount(rawText);
  const date = extractDate(rawText);

  let found = 0;
  if (vendor) found++;
  if (amount) found++;
  if (date) found++;
  const confidence = Math.round((found / 3) * 100) / 100;

  return {
    vendor_extracted: vendor,
    amount_extracted: amount,
    date_extracted: date,
    ai_confidence: confidence,
    ai_raw_text: rawText,
  };
}

export interface ParsedTransaction {
  vendor: string;
  date: string;
  amount: number;
}

const SKIP_PATTERNS = /sort by|transactions|filter|card ending|present|balance/i;

export function parseTransactionList(rawText: string): ParsedTransaction[] {
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const results: ParsedTransaction[] = [];

  const dateRe = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4}\b/i;
  const amountRe = /\$\s?([\d,]+\.\d{2})/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip header/noise lines
    if (SKIP_PATTERNS.test(line)) { i++; continue; }

    // Vendor candidate: non-numeric string > 2 chars, doesn't start with $ or digit
    const isVendorCandidate = line.length > 2 && !/^\d/.test(line) && !/^\$/.test(line);

    if (isVendorCandidate) {
      // Look ahead up to 2 lines for date and amount
      let foundDate: string | null = null;
      let foundAmount: number | null = null;

      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
        const ahead = lines[j];
        if (!foundDate) {
          const dm = ahead.match(dateRe);
          if (dm) {
            const d = new Date(dm[0]);
            if (!isNaN(d.getTime())) {
              foundDate = d.toISOString().split("T")[0];
            }
          }
        }
        if (foundAmount === null) {
          const am = ahead.match(amountRe);
          if (am) {
            foundAmount = parseFloat(am[1].replace(/,/g, ""));
          }
        }
      }

      // Also check the vendor line itself for date/amount (in case they're on the same line)
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
        i += 3; // skip past the consumed lines
        continue;
      }
    }
    i++;
  }

  return results;
}

export interface ParsedTransactionRow {
  date: string;
  vendor: string;
  amount: string;
  card_last_four: string;
}

export function parseTransactionRows(rawText: string): ParsedTransactionRow[] {
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 5);
  const rows: ParsedTransactionRow[] = [];

  const dateRe = /(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2}|\d{2})/;
  const amountRe = /\$?\s?([\d,]+\.\d{2})/;

  for (const line of lines) {
    const dateMatch = line.match(dateRe);
    const amountMatch = line.match(amountRe);
    if (!dateMatch || !amountMatch) continue;

    let year = dateMatch[3];
    if (year.length === 2) year = "20" + year;
    const dateStr = `${year}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`;

    const amountVal = amountMatch[1].replace(/,/g, "");

    // Vendor is the text between date and amount
    const dateEnd = dateMatch.index! + dateMatch[0].length;
    const amountStart = amountMatch.index!;
    let vendor = line.slice(dateEnd, amountStart).trim();
    if (!vendor) {
      // Try text after amount
      vendor = line.slice(amountMatch.index! + amountMatch[0].length).trim();
    }
    // Clean up vendor
    vendor = vendor.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
    if (!vendor) vendor = "Unknown";

    rows.push({ date: dateStr, vendor, amount: amountVal, card_last_four: "" });
  }

  return rows;
}
