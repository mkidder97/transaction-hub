

# Add Employee Filtering to Excel (and PDF) Export

## Overview
Add a per-period employee filter dropdown and a Download Report dropdown to each period row in the Settings page. Create the `generateReconciliationExcel.ts` file with optional `userId` filtering. Also update `generateReconciliationPdf` to accept the same optional `userId` parameter.

## Changes

### 1. Create `src/lib/generateReconciliationExcel.ts`
- Signature: `export async function generateReconciliationExcel(periodId: string, userId?: string): Promise<void>`
- Same two queries as the PDF generator (receipts with joins, transactions with user join), with conditional `.eq("user_id", userId)` when provided
- If userId provided, fetch profile name for filename
- 5 sheets: Matched Pairs, Unmatched Receipts, Missing Receipts, Flagged, Category Summary
- Amounts as numbers, dates as YYYY-MM-DD, column widths via `wch`
- Download via `XLSX.writeFile()`

### 2. Update `src/lib/generateReconciliationPdf.ts`
- Add optional `userId?: string` parameter
- Conditionally add `.eq("user_id", userId)` to both queries
- Add employee name to filename when filtered

### 3. Update `src/pages/admin/Settings.tsx`
- Fetch active profiles on mount (new state: `profiles`)
- Add `reportFilters` state: `Record<string, string | undefined>` keyed by period id, storing selected userId
- Widen the last table column to fit controls
- In each period row's action cell, add:
  - A small Select dropdown ("All Employees" default + one option per profile)
  - A DropdownMenu button: "Download Report" with PDF and Excel options
  - Keep the existing Close Period button for current periods
- Both PDF and Excel calls pass the selected userId from `reportFilters[period.id]`
- New imports: `DropdownMenu*`, `Select*`, `generateReconciliationExcel`, `Download`, `FileText`, `FileSpreadsheet`, `ChevronDown`

### Files
- **New**: `src/lib/generateReconciliationExcel.ts`
- **Edit**: `src/lib/generateReconciliationPdf.ts` (add userId param + filter)
- **Edit**: `src/pages/admin/Settings.tsx` (profiles fetch, filter dropdown, download dropdown)

