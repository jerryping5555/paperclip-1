Re-drop with stale QA detected during drop-zone sweep (KIDAA-7). Route: Printful (syncs to Woo).

## Paths
- Drop folder: `/ssd/kidsfaithacademy_productupload/products/printful_products/greeting-cards/design_8/`
- Printful file library: `/ssd/printful/printful-file-library/Greeting Cards/` (d8 files, checksums already match the staged PNGs)
- Manifest truth: `/ssd/printful/PRODUCTS_MANIFEST.csv` (row `GC_LOVE_2509202607`, live, sync 475161483, woo 26936, placement file IDs 1073390494 | 1073390498 | 1073390504 | 1073390495)

## Lifecycle stage
**Re-drop needing QA/previews update.** All 4 artwork PNGs (front/inside1/inside2/back) were rewritten 2026-09-25 10:19 (+1000), AFTER the local `QA_report.txt` (08:54), which still says `inside2: MISSING – skipped` and `back: MISSING – skipped`. Local `previews/` only has front + inside1 — no inside2/back previews. The Printful side already reflects the new files (library copies match by md5; manifest live), so the remaining gap is local: regenerate `QA_report.txt` against the current PNGs and complete the preview set, or record why not.

## What is needed
1. Re-run your print-file QA on the current design_8 PNGs; overwrite `QA_report.txt`.
2. Regenerate missing previews (inside2, back) alongside the existing ones.
3. Confirm no further action needed for the live Printful/Woo listing; if the artwork change requires a re-upload on Printful, do that per your runbook and update the manifest.
