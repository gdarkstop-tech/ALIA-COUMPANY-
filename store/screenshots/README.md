# Store screenshots — DRAFTS

`draft-web-harness/` holds **draft** listing screenshots captured from the react-native-web harness
(`STORE_SHOTS=1 pnpm --filter @ghayarly/e2e exec playwright test store-screenshots`), EN and AR:

| Folder | Size | Store slot |
|---|---|---|
| `apple-6.3in` | 1206 × 2622 | App Store — iPhone with Dynamic Island, medium display |
| `apple-6.9in` | 1320 × 2868 | App Store — iPhone with Dynamic Island, large display |
| `google-phone` | 1080 × 1920 | Google Play — phone (9:16) |

They use synthetic demo data only and still show the development-showcase banner. They are for
reviewing layout and copy, **not for upload**: final screenshots must be captured from the native
iOS / Android builds (real status bar, native controls and fonts) against review-safe data, with
official brand assets in place (see `docs/release/RELEASE_STATUS.md`).
