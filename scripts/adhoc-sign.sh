#!/usr/bin/env bash
# Ký lại Melo.ipa (chưa ký) thành bản Ad Hoc để cài 1 chạm từ Safari trên iPhone đã đăng ký UDID.
# Chạy trên máy macOS của GitHub Actions. Cần 3 biến môi trường (GitHub Secrets, KHÔNG bao giờ để trong code):
#   SIGNING_CERT_P12_BASE64  chứng chỉ "Apple Distribution" (.p12) dạng base64
#   SIGNING_CERT_PASSWORD    mật khẩu của file .p12
#   ADHOC_PROFILE_BASE64     hồ sơ "Ad Hoc" (.mobileprovision) cho com.melo.music, dạng base64
# Cách tạo các file này trên Windows (không cần Mac): docs/CAI_DAT.md.
#
# scripts/adhoc-sign.sh Melo.ipa Melo-adhoc.ipa
set -euo pipefail

IN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="$(pwd)/$2"
: "${SIGNING_CERT_P12_BASE64:?thiếu SIGNING_CERT_P12_BASE64}"
: "${SIGNING_CERT_PASSWORD:?thiếu SIGNING_CERT_PASSWORD}"
: "${ADHOC_PROFILE_BASE64:?thiếu ADHOC_PROFILE_BASE64}"

WORK="$(mktemp -d)"
KEYCHAIN="$WORK/melo-signing.keychain-db"
KEYCHAIN_PASSWORD="$(uuidgen)"
cleanup() {
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

printf '%s' "$SIGNING_CERT_P12_BASE64" | base64 --decode > "$WORK/cert.p12"
printf '%s' "$ADHOC_PROFILE_BASE64" | base64 --decode > "$WORK/profile.mobileprovision"

# Keychain tạm, chỉ sống trong lượt build này.
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 3600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$WORK/cert.p12" -k "$KEYCHAIN" -P "$SIGNING_CERT_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
# shellcheck disable=SC2046
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')

IDENTITY="$(security find-identity -v -p codesigning "$KEYCHAIN" | awk -F'"' '/Apple Distribution|iPhone Distribution/ { print $2; exit }')"
if [ -z "$IDENTITY" ]; then
  echo "::error::File .p12 không chứa chứng chỉ Apple Distribution hợp lệ"
  exit 1
fi

# Đọc hồ sơ: phải là Ad Hoc (có danh sách thiết bị), đúng mã app, còn hạn.
security cms -D -i "$WORK/profile.mobileprovision" > "$WORK/profile.plist"
/usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$WORK/profile.plist" > "$WORK/entitlements.plist"
APP_IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$WORK/profile.plist")"
DEVICE_COUNT="$(/usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices' "$WORK/profile.plist" 2>/dev/null | grep -c '^ ' || true)"
EXPIRES="$(/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' "$WORK/profile.plist")"
GET_TASK_ALLOW="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:get-task-allow' "$WORK/profile.plist" 2>/dev/null || echo false)"
echo "Hồ sơ: $APP_IDENTIFIER · $DEVICE_COUNT thiết bị · hết hạn $EXPIRES"
if [ "$DEVICE_COUNT" -lt 1 ]; then
  echo "::error::Hồ sơ không có thiết bị nào (cần hồ sơ Ad Hoc có UDID iPhone của bạn)"
  exit 1
fi
if [ "$GET_TASK_ALLOW" = "true" ]; then
  echo "::warning::Đây là hồ sơ Development, không phải Ad Hoc — vẫn cài được nhưng nên dùng hồ sơ Ad Hoc"
fi

unzip -q "$IN" -d "$WORK/ipa"
APP="$WORK/ipa/Payload/App.app"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
case "$APP_IDENTIFIER" in
  *".$BUNDLE_ID") ;;
  *)
    echo "::error::Hồ sơ dành cho $APP_IDENTIFIER, không phải $BUNDLE_ID"
    exit 1
    ;;
esac

cp "$WORK/profile.mobileprovision" "$APP/embedded.mobileprovision"

# Ký framework bên trong trước, app sau cùng (kèm entitlements của hồ sơ).
if [ -d "$APP/Frameworks" ]; then
  find "$APP/Frameworks" -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -print0 |
    while IFS= read -r -d '' item; do
      codesign --force --sign "$IDENTITY" --keychain "$KEYCHAIN" --timestamp=none "$item"
    done
fi
codesign --force --sign "$IDENTITY" --keychain "$KEYCHAIN" --entitlements "$WORK/entitlements.plist" --timestamp=none "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

rm -f "$OUT"
(cd "$WORK/ipa" && zip -qry "$OUT" Payload)
echo "Đã ký: $OUT ($(du -h "$OUT" | cut -f1))"
