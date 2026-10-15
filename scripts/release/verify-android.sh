#!/usr/bin/env bash
# Static verification of a built Android APK: target SDK, permissions, 64-bit ABIs and 16 KB
# page-size compatibility (zip alignment + ELF LOAD segment alignment of every 64-bit .so).
set -euo pipefail
APK="${1:?usage: verify-android.sh <app-release.apk>}"
BT="${ANDROID_HOME:-/opt/android-sdk}/build-tools/$(ls "${ANDROID_HOME:-/opt/android-sdk}/build-tools" | sort -V | tail -1)"
fail=0

badging=$("$BT/aapt2" dump badging "$APK")
target=$(sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p" <<<"$badging")
echo "targetSdkVersion: $target"; [ "$target" -ge 36 ] || { echo "✗ targetSdk must be ≥ 36"; fail=1; }
grep -q "native-code:.*'arm64-v8a'" <<<"$badging" || { echo "✗ arm64-v8a missing"; fail=1; }

allowed='INTERNET|VIBRATE|ACCESS_NETWORK_STATE|ACCESS_WIFI_STATE|DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION|com.android.vending.BILLING'
while read -r perm; do
  [[ "$perm" =~ $allowed ]] && echo "  permission ok: $perm" || { echo "✗ unexpected permission: $perm"; fail=1; }
done < <(sed -n "s/^uses-permission: name='\([^']*\)'.*/\1/p" <<<"$badging")

"$BT/zipalign" -c -P 16 -v 4 "$APK" >/dev/null && echo "✓ zip entries 16 KB aligned" || { echo "✗ zipalign -P 16 failed"; fail=1; }
tmp=$(mktemp -d); unzip -q -o "$APK" 'lib/arm64-v8a/*' 'lib/x86_64/*' -d "$tmp" 2>/dev/null || true
n=0; bad=0
for so in "$tmp"/lib/*/*.so; do
  [ -e "$so" ] || continue; n=$((n+1))
  align=$(readelf -lW "$so" | awk '/LOAD/{print $NF}' | sort -u | head -1)
  if [ $((align)) -lt $((0x4000)) ]; then echo "✗ $(basename "$so") LOAD align $align"; bad=$((bad+1)); fi
done
echo "64-bit native libraries: $n, under 16 KB alignment: $bad"; [ "$bad" -eq 0 ] || fail=1
exit $fail
