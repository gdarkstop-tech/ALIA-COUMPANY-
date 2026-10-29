#!/usr/bin/env bash
# Local Android builds for verification and internal device testing (not store uploads):
#   production — release APK + AAB (store variant: no camera, photo or microphone access)
#   preview    — release APK for internal testers (wound photos + realtime voice linked; the
#                server-side flags still decide whether either can be used)
#   dev client — debug APK that loads JavaScript from a Metro server
# Every artifact is signed with the local debug key only. Store builds come from EAS with the
# Play upload key. Usage:
#   OUT=/path/to/artifacts [EXPO_PUBLIC_API_URL=https://staging-api.example] scripts/release/build-android-local.sh [production] [preview] [dev]
# The API URL is baked into release builds: testers need a reachable staging API, otherwise the
# app opens but every request fails (the default below is deliberately unroutable).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:?set OUT to the artifacts directory}"
API_URL="${EXPO_PUBLIC_API_URL:-https://api.dressmywound.invalid}"
VERSION="$(node -p "require('$ROOT/apps/mobile/package.json').version")"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}" ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
GRADLE_ARGS=(--no-daemon --max-workers=4 -Dorg.gradle.internal.repository.max.retries=12 -Dorg.gradle.internal.repository.initial.backoff=3000 "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g")
mkdir -p "$OUT"
targets=("$@"); [ ${#targets[@]} -gt 0 ] || targets=(production preview dev)
status=0

retry() { for i in 1 2 3; do "$@" && return 0; echo "attempt $i failed: $*"; sleep 30; done; return 1; }
# Native intermediates take several GB per variant: drop them once the artifacts are copied.
clean_intermediates() { rm -rf "$ROOT/apps/mobile/android/app/build" "$ROOT/apps/mobile/android/build" "$ROOT/apps/mobile/android/.gradle"; find "$ROOT/node_modules" -path '*/android/build' -type d -prune -exec rm -rf {} + 2>/dev/null; true; }
prebuild() { (cd "$ROOT/apps/mobile" && APP_VARIANT="$1" EXPO_PUBLIC_API_URL="$API_URL" npx expo prebuild --platform android --clean --no-install); }

for t in "${targets[@]}"; do
  case "$t" in
    production)
      echo "=== production (API $API_URL)"
      prebuild production || { echo "PRODUCTION_PREBUILD_FAILED"; status=1; continue; }
      if (cd "$ROOT/apps/mobile/android" && APP_VARIANT=production EXPO_PUBLIC_API_URL="$API_URL" NODE_ENV=production retry ./gradlew "${GRADLE_ARGS[@]}" assembleRelease bundleRelease); then
        cp "$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk" "$OUT/dress-my-wound-production-$VERSION-local-debugsigned.apk"
        cp "$ROOT/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab" "$OUT/dress-my-wound-production-$VERSION-local-debugsigned.aab"
        bash "$ROOT/scripts/release/verify-android.sh" "$OUT/dress-my-wound-production-$VERSION-local-debugsigned.apk" && echo "PRODUCTION_OK" || { echo "PRODUCTION_VERIFY_FAILED"; status=1; }
      else echo "PRODUCTION_BUILD_FAILED"; status=1; fi
      clean_intermediates ;;
    preview)
      echo "=== preview (API $API_URL)"
      prebuild preview || { echo "PREVIEW_PREBUILD_FAILED"; status=1; continue; }
      if (cd "$ROOT/apps/mobile/android" && APP_VARIANT=preview EXPO_PUBLIC_API_URL="$API_URL" NODE_ENV=production retry ./gradlew "${GRADLE_ARGS[@]}" -PreactNativeArchitectures=arm64-v8a,armeabi-v7a assembleRelease); then
        cp "$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk" "$OUT/dress-my-wound-preview-$VERSION-local-debugsigned.apk"
        VARIANT=preview bash "$ROOT/scripts/release/verify-android.sh" "$OUT/dress-my-wound-preview-$VERSION-local-debugsigned.apk" && echo "PREVIEW_OK" || { echo "PREVIEW_VERIFY_FAILED"; status=1; }
      else echo "PREVIEW_BUILD_FAILED"; status=1; fi
      clean_intermediates ;;
    dev)
      echo "=== development client"
      prebuild development || { echo "DEV_PREBUILD_FAILED"; status=1; continue; }
      if (cd "$ROOT/apps/mobile/android" && APP_VARIANT=development retry ./gradlew "${GRADLE_ARGS[@]}" -PreactNativeArchitectures=arm64-v8a,x86_64 assembleDebug); then
        cp "$ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk" "$OUT/dress-my-wound-dev-client-$VERSION-arm64-x86_64.apk"
        echo "DEV_OK"
      else echo "DEV_BUILD_FAILED"; status=1; fi
      clean_intermediates ;;
    *) echo "unknown target: $t"; status=1 ;;
  esac
done
(cd "$OUT" && sha256sum ./*.apk ./*.aab 2>/dev/null)
echo "ALL_DONE status=$status"
exit $status
