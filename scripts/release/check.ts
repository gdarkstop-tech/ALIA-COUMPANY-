/**
 * Release readiness checks that can be automated (run in CI: `pnpm release:check`).
 * Each failure names the rule; nothing here talks to Apple or Google.
 *
 *   1. Brand: no forbidden spellings of the product name in user-facing sources.
 *   2. Store metadata: lengths within App Store Connect / Play Console limits (EN + AR).
 *   3. Icons: App Store icon 1024×1024 without alpha; Play icon 512×512; feature graphic 1024×500.
 *   4. Native config invariants (resolved production app config).
 *   5. No signing keys / service-account credentials committed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_BRAND_SPELLINGS } from '../../packages/shared/src/brand.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const failures: string[] = [];
const ok: string[] = [];
const check = (name: string, pass: boolean, detail = '') => (pass ? ok.push(name) : failures.push(`${name}${detail ? ` — ${detail}` : ''}`));

// ---------------------------------------------------------------- 1. brand spelling
const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const userFacing = tracked.filter(
  (f) =>
    /^(apps\/(mobile|admin|site)\/(src|app\.config\.ts|build\.ts)|packages\/(i18n|shared\/src\/legal)|store\/metadata)/.test(f) &&
    /\.(ts|tsx|json|md|html)$/.test(f),
);
for (const f of userFacing) {
  const text = readFileSync(join(root, f), 'utf8');
  for (const bad of FORBIDDEN_BRAND_SPELLINGS) if (text.includes(bad)) failures.push(`brand: "${bad}" found in ${f} (official names: Dress My Wound | غير لي)`);
}
ok.push(`brand spelling (${userFacing.length} user-facing files)`);

// ---------------------------------------------------------------- 2. store metadata limits
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
for (const lang of ['en', 'ar']) {
  const m = JSON.parse(readFileSync(join(root, `store/metadata/${lang}.json`), 'utf8'));
  const a = m.apple;
  const g = m.google;
  check(`${lang} apple name ≤ 30`, [...a.name].length <= 30, a.name);
  check(`${lang} apple subtitle ≤ 30`, [...a.subtitle].length <= 30, `${[...a.subtitle].length}`);
  check(`${lang} apple promotional text ≤ 170`, [...a.promotionalText].length <= 170);
  check(`${lang} apple description ≤ 4000`, [...a.description].length <= 4000);
  check(`${lang} apple keywords ≤ 100 bytes`, bytes(a.keywords) <= 100, `${bytes(a.keywords)} bytes`);
  check(`${lang} apple keywords: each > 2 chars, no app/company names`, a.keywords.split(',').every((k: string) => [...k.trim()].length > 2 && !/dress my wound|غير لي|tetrasol|alia/i.test(k)));
  check(`${lang} google title ≤ 30`, [...g.title].length <= 30);
  check(`${lang} google short description ≤ 80`, [...g.shortDescription].length <= 80, `${[...g.shortDescription].length}`);
  check(`${lang} google full description ≤ 4000`, [...g.fullDescription].length <= 4000);
  check(`${lang} metadata states the emergency/no-diagnosis limits`, /123|١٢٣/.test(a.description) && /123|١٢٣/.test(g.fullDescription));
}

// ---------------------------------------------------------------- 3. icons (PNG header: width/height at 16/20, colour type at 25)
function png(path: string) {
  const b = readFileSync(join(root, path));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25]! };
}
const ios = png('apps/mobile/assets/icon.png');
check('App Store icon 1024×1024', ios.w === 1024 && ios.h === 1024, `${ios.w}×${ios.h}`);
check('App Store icon has no alpha channel', ios.colorType === 2, `PNG colour type ${ios.colorType}`);
const play = png('store/assets/google-play/icon-512.png');
check('Play icon 512×512, 32-bit PNG', play.w === 512 && play.h === 512 && play.colorType === 6);
const fg = png('store/assets/google-play/feature-graphic-1024x500.png');
check('Play feature graphic 1024×500, 24-bit (no alpha)', fg.w === 1024 && fg.h === 500 && fg.colorType === 2);
const adaptive = png('apps/mobile/assets/adaptive-icon.png');
check('Android adaptive foreground 1024×1024 with transparency', adaptive.w === 1024 && adaptive.colorType === 6);

// ---------------------------------------------------------------- 4. native config (production variant)
const cfgJson = execFileSync('npx', ['expo', 'config', '--type', 'introspect', '--json'], {
  cwd: join(root, 'apps/mobile'),
  env: { ...process.env, APP_VARIANT: 'production', EXPO_PUBLIC_API_URL: 'https://api.release-check.invalid' },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const cfg = JSON.parse(cfgJson);
check('production name is "Dress My Wound"', cfg.name === 'Dress My Wound');
check('Arabic display name is "غير لي"', cfg.locales?.ar?.ios?.CFBundleDisplayName === 'غير لي' && cfg.locales?.ar?.android?.app_name === 'غير لي');
check('iPhone only (no untested iPad layouts)', cfg.ios?.supportsTablet === false);
check('ITSAppUsesNonExemptEncryption declared', cfg.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false);
check('ATS: no arbitrary loads, no local networking in store builds', cfg.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false && !cfg.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsLocalNetworking);
check('no dev-launcher local-network prompt in store builds', !cfg.ios?.infoPlist?.NSLocalNetworkUsageDescription && !cfg.ios?.infoPlist?.NSBonjourServices);
check('no Face ID purpose string (biometrics unused)', !cfg.ios?.infoPlist?.NSFaceIDUsageDescription);
check('privacy manifest: no tracking', cfg.ios?.privacyManifests?.NSPrivacyTracking === false);
check('privacy manifest declares health data', JSON.stringify(cfg.ios?.privacyManifests ?? {}).includes('NSPrivacyCollectedDataTypeHealth'));
check('Android backup disabled (medical data)', cfg.android?.allowBackup === false);
const blocked: string[] = cfg.android?.blockedPermissions ?? [];
for (const p of ['ACCESS_BACKGROUND_LOCATION', 'READ_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'SYSTEM_ALERT_WINDOW', 'USE_BIOMETRIC', 'com.google.android.gms.permission.AD_ID'])
  check(`Android blocks ${p}`, blocked.some((b) => b.endsWith(p)));
check('identifier is reverse-DNS', /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(cfg.ios?.bundleIdentifier ?? '') && cfg.ios?.bundleIdentifier === cfg.android?.package);

// ---------------------------------------------------------------- 5. no committed signing material / credentials
const forbiddenFiles = tracked.filter((f) => /\.(jks|keystore|p8|p12|mobileprovision|pem|cer)$/i.test(f) && !/debug\.keystore$/.test(f) && !/AppleRootCA|apple-root/i.test(f));
check('no signing keys or certificates committed', forbiddenFiles.length === 0, forbiddenFiles.join(', '));
const secretHits = tracked
  .filter((f) => /\.(ts|tsx|js|json|env|example|md|yml|yaml)$/.test(f) && !f.includes('node_modules'))
  .filter((f) => /-----BEGIN (RSA |EC )?PRIVATE KEY-----|"private_key":\s*"-----BEGIN|AIza[0-9A-Za-z_-]{35}/.test(readFileSync(join(root, f), 'utf8')));
check('no private keys / service-account keys / Google API keys in tracked files', secretHits.length === 0, secretHits.join(', '));

// ---------------------------------------------------------------- report
for (const name of ok) console.log(`✓ ${name}`);
for (const f of failures) console.error(`✗ ${f}`);
console.log(`\n${ok.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
