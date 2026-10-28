# TetraSol artwork (supplied)

| File | What it is | Supplied |
|---|---|---|
| `tetrasol-logo-supplied.png` | The TetraSol logo with the line "Delaware-based incorporation, USA" (650 × 250, white backdrop) | By the project owner in the development session, 2026-10-28 |
| `loader-swirl-supplied.png` | Orange brush-stroke swirl, supplied as the reference for loading indicators (392 × 396, white backdrop) | Same |

These are the source files. `scripts/brand/prepare-supplied-assets.py` derives the app files
(`apps/mobile/assets/brand/`, `apps/admin/public/brand/`): it removes the white backdrop, cuts a
tagline-free **wordmark** for small sizes (the tagline is unreadable below ~150 px of logo height) and
scales the swirl. It never redraws or recolours the artwork.

Usage rules as implemented (to be confirmed by the TetraSol brand owner; no brand guidelines have been
supplied):
- The logo appears only where TetraSol is named: store banner, product tiles and pages, the home card
  that opens the store, approved product information in the assistant, and the admin catalogue and
  TetraSol knowledge pages. Never in the Dress My Wound lockup, app icon or store-listing keywords.
- The navy and orange are never changed. On dark surfaces the logo sits on a light plate.
- The swirl is the loading indicator in the app and the admin console; it turns slowly, and stays still
  (breathing) when the person has Reduce Motion on.
