

# Auto-categorize receipts on upload

## Problem
Categories are never auto-filled because all `known_vendors` have `default_category_id = NULL`, and the AI extraction doesn't return a category suggestion.

## Approach
Have the AI suggest a category during extraction. The edge function already calls Gemini Vision -- we add "category" to its tool schema with the exact list of categories. The AI picks the best-fit category based on the receipt content. This works for every receipt, not just known vendors.

## Changes

### 1. Update `extract-receipt` edge function
- Accept an optional `categories` array in the request body (list of `{id, name}`)
- Add a `category_id` field to the AI tool schema with an enum of category names
- Map the AI's chosen category name back to its ID in the response
- Return `suggested_category_id` alongside existing fields

### 2. Update `SubmitReceipt.tsx`
- Pass the loaded `categories` array to the edge function call
- Use the returned `suggested_category_id` to pre-fill the category dropdown
- Fall back to vendor dictionary's `default_category_id` if AI doesn't suggest one

### 3. Backfill `known_vendors` default categories (data migration)
- Update known gas station vendors (QuikTrip, RaceTrac, Shell, etc.) → Fuel category
- This provides a secondary fallback via vendor lookup

## Flow
```text
Receipt uploaded
  → AI extracts vendor, amount, date, AND category
  → Vendor lookup (canonical name + default_category_id fallback)
  → Category priority: AI suggestion > vendor default > empty
  → User sees pre-filled category in dropdown
```

