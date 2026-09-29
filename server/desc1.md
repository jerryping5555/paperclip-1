New staged file detected during drop-zone sweep (KIDAA-7). Route: Printful (syncs to Woo).

## Paths
- Drop: `/ssd/kidsfaithacademy_productupload/products/printful_products/bundled_greetingcards_mockup.jpg`
- Manifest truth: `/ssd/printful/PRODUCTS_MANIFEST.csv`
- Printful file library: `/ssd/printful/printful-file-library/`

## Lifecycle stage
**Dropped — not yet reflected.** The mockup landed 2026-09-25 16:40 (+1000), AFTER the last `PRODUCTS_MANIFEST.csv` update (14:11). No copy or reference exists anywhere under `/ssd/printful` (searched for *mockup* / *bundle*), and the manifest bundle row (`GC_BUNDLE_ALL12_25092026`, woo 26960, woo-side WPC bundle) has no mockup/image reference.

## What is needed
Per your runbook: QA the mockup, decide where it belongs (likely product image for the live woo bundle), stage it under `/ssd/printful`, and record it in `PRODUCTS_MANIFEST.csv`. If parts of this stay owner-side (dashboard product creation), state exactly what you did and what remains for the owner.
