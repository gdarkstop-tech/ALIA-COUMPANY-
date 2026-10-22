#!/usr/bin/env bash
# Static verification of a built STORE Android APK (preview / production variant; dev clients
# legitimately carry dev-menu permissions): target SDK, permissions, 64-bit ABIs and 16 KB
# page-size compatibility (zip alignment + ELF LOAD segment alignment of every 64-bit .so).
set -euo pipefail
APK="${1:?usage: verify-android.sh <app-release.apk>}"
BT="${ANDROID_HOME:-/opt/android-sdk}/build-tools/$(ls "${ANDROID_HOME:-/opt/android-sdk}/build-tools" | sort -V | tail -1)"
fail=0
command -v readelf >/dev/null || { echo "✗ readelf not found (install binutils): cannot check 16 KB ELF alignment"; exit 1; }

badging=$("$BT/aapt2" dump badging "$APK")
target=$(sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p" <<<"$badging")
echo "targetSdkVersion: $target"; [ "$target" -ge 36 ] || { echo "✗ targetSdk must be ≥ 36"; fail=1; }
grep -q "native-code:.*'arm64-v8a'" <<<"$badging" || { echo "✗ arm64-v8a missing"; fail=1; }

# Exact allow-list (anchored, dots escaped); also covers <uses-permission-sdk-23>, which Expo's
# blockedPermissions does not strip.
allowed='^(android\.permission\.(INTERNET|VIBRATE|ACCESS_NETWORK_STATE|ACCESS_WIFI_STATE)|com\.android\.vending\.BILLING|[a-z0-9_.]+\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION)$'
while read -r perm; do
  [[ "$perm" =~ $allowed ]] && echo "  permission ok: $perm" || { echo "✗ unexpected permission: $perm"; fail=1; }
done < <(sed -n "s/^uses-permission\(-sdk-23\)\{0,1\}: name='\([^']*\)'.*/\2/p" <<<"$badging")

"$BT/zipalign" -c -P 16 -v 4 "$APK" >/dev/null && echo "✓ zip entries 16 KB aligned" || { echo "✗ zipalign -P 16 failed"; fail=1; }
tmp=$(mktemp -d)
# unzip exits 11 when one of the two ABI patterns has no match (e.g. an arm64-only build); any
# other failure is real.
unzip -q -o "$APK" 'lib/arm64-v8a/*' 'lib/x86_64/*' -d "$tmp" || [ $? -eq 11 ] || { echo "✗ could not extract native libraries"; fail=1; }
n=0; bad=0
for so in "$tmp"/lib/*/*.so; do
  [ -e "$so" ] || continue; n=$((n+1))
  # Every LOAD segment must be ≥ 16 KB aligned (compared numerically, not as strings). A library
  # readelf cannot parse, or one without LOAD segments, counts as a failure — never a silent pass.
  if ! hdr=$(readelf -lW "$so" 2>&1); then echo "✗ $(basename "$so"): readelf failed"; bad=$((bad+1)); continue; fi
  aligns=$(awk '/LOAD/{print $NF}' <<<"$hdr")
  [ -n "$aligns" ] || { echo "✗ $(basename "$so"): no LOAD segments found"; bad=$((bad+1)); continue; }
  for align in $aligns; do
    if [ $((align)) -lt $((0x4000)) ]; then echo "✗ $(basename "$so") LOAD align $align"; bad=$((bad+1)); break; fi
  done
done
echo "64-bit native libraries: $n, under 16 KB alignment: $bad"
[ "$n" -gt 0 ] || { echo "✗ no 64-bit native libraries found to check"; fail=1; }
[ "$bad" -eq 0 ] || fail=1
exit $fail
