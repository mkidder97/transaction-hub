

# Replace PDF save with open-in-new-tab approach

## Change

In `src/lib/generateReconciliationPdf.ts`, replace lines 180-182:

```
  const filename = `reconciliation-${period.name.replace(/\s+/g, "-").toLowerCase()}.pdf`;
  doc.save(filename);
}
```

With the new blob-based open-in-new-tab approach that:
- Opens the PDF in a new browser tab using `window.open`
- Falls back to a direct download if the popup is blocked
- Revokes the blob URL after 30 seconds

No other changes to the file.

