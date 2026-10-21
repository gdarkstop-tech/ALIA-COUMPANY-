/**
 * Release readiness checks that can be automated (run in CI: `pnpm release:check`).
 * Each failure names the rule; nothing here talks to Apple or Google.
 *
 *   1. Brand: no forbidden spellings of the product name in user-facing sources; canonical names.
 *   2. Store metadata: lengths within App Store Connect / Play Console limits (EN + AR); no claims
 *      about features that are switched off; no placeholders when submitting.
 *   3. Icons: App Store icon 1024×1024 without alpha or transparency; Play icon 512×512 8-bit RGBA;
 *      feature graphic 1024×500 8-bit RGB.
 *   4. Native config invariants (resolved production app config).
 *   5. No signing keys / service-account credentials / personal e-mail addresses committed.
 *
 * `--submission` additionally fails on placeholders (legal entity, support URLs, contact e-mail) that
 * are acceptable during development but must be gone before a build goes to Apple or Google.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_NAME_AR, BRAND_NAME_EN } from '../../packages/shared/src/brand.ts';
import { LEGAL_DOCUMENTS } from '../../packages/shared/src/legal.ts';
import { brandConfig } from '../../packages/tokens/src/brand.ts';
import { FORBIDDEN_BRAND_SPELLINGS, OFF_BY_DEFAULT_FEATURE_CLAIMS } from './brand-rules.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const failures: string[] = [];
const ok: string[] = [];
const warnings: string[] = [];
const submission = process.argv.includes('--submission');
const check = (name: string, pass: boolean, detail = '') => (pass ? ok.push(name) : failures.push(`${name}${detail ? ` — ${detail}` : ''}`));
/** Fails only with --submission; otherwise reported as a warning. */
const gate = (name: string, pass: boolean, detail = '') => (pass ? ok.push(name) : (submission ? failures : warnings).push(`${name}${detail ? ` — ${detail}` : ''}`));

// ---------------------------------------------------------------- 1. brand spelling
// -z: non-ASCII (e.g. Arabic) file names are not C-quoted, so no file escapes the scans below.
const tracked = execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const userFacing = tracked.filter(
  (f) =>
    /^(apps\/(mobile|admin|site)\/(src|app\.config\.ts|build\.ts)|apps\/api\/src|packages\/(i18n|shared|tokens)\/src|store\/metadata)/.test(f) &&
    /\.(ts|tsx|json|md|html)$/.test(f),
);
for (const f of userFacing) {
  const text = readFileSync(join(root, f), 'utf8');
  for (const bad of FORBIDDEN_BRAND_SPELLINGS) if (text.includes(bad)) failures.push(`brand: "${bad}" found in ${f} (official names: Dress My Wound | غير لي)`);
}
ok.push(`brand spelling (${userFacing.length} user-facing files)`);
check('canonical names: Dress My Wound | غير لي', BRAND_NAME_EN === 'Dress My Wound' && BRAND_NAME_AR === 'غير لي' && brandConfig.product.nameAr === 'غير لي' && brandConfig.product.nameEn === 'Dress My Wound');

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
  // Apple 2.3.1 / Google metadata policy: the listing may only promise what the build does. Features
  // that are OFF by default need RELEASE_ENABLED_FEATURES=<flag key> to be advertised.
  const enabled = (process.env.RELEASE_ENABLED_FEATURES ?? '').split(',').map((s) => s.trim());
  const listing = [a.name, a.subtitle, a.keywords, a.promotionalText, a.description, g.title, g.shortDescription, g.fullDescription].join('\n');
  for (const claim of OFF_BY_DEFAULT_FEATURE_CLAIMS) {
    const hit = listing.match(claim.pattern);
    check(`${lang} listing does not advertise ${claim.flag} (off)`, enabled.includes(claim.flag) || !hit, hit?.[0]);
  }
  gate(`${lang} listing has no placeholders`, !/<[A-Z_]+_TO_CONFIRM>|to be confirmed|\[to confirm/i.test(JSON.stringify(m)));
}
gate('legal texts have no placeholders', !/to be confirmed|\[to confirm/i.test(JSON.stringify(LEGAL_DOCUMENTS)));

// ---------------------------------------------------------------- 3. icons (PNG header: width/height at 16/20, colour type at 25)
function png(path: string) {
  const b = readFileSync(join(root, path));
  if (!b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error(`${path} is not a PNG`);
  const chunks: string[] = [];
  for (let i = 8; i + 8 <= b.length; ) {
    const len = b.readUInt32BE(i);
    chunks.push(b.toString('latin1', i + 4, i + 8));
    i += 12 + len;
  }
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bitDepth: b[24]!, colorType: b[25]!, transparent: chunks.includes('tRNS') };
}
const ios = png('apps/mobile/assets/icon.png');
check('App Store icon 1024×1024', ios.w === 1024 && ios.h === 1024, `${ios.w}×${ios.h}`);
check('App Store icon has no alpha channel or transparency', ios.colorType === 2 && !ios.transparent, `PNG colour type ${ios.colorType}${ios.transparent ? ' + tRNS' : ''}`);
const play = png('store/assets/google-play/icon-512.png');
check('Play icon 512×512, 32-bit PNG', play.w === 512 && play.h === 512 && play.colorType === 6 && play.bitDepth === 8);
const fg = png('store/assets/google-play/feature-graphic-1024x500.png');
check('Play feature graphic 1024×500, 24-bit (no alpha)', fg.w === 1024 && fg.h === 500 && fg.colorType === 2 && fg.bitDepth === 8 && !fg.transparent);
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
// Real people's addresses (developer-account logins, staff) never belong in the repository.
const personal = tracked
  .filter((f) => /\.(ts|tsx|js|json|md|yml|yaml|html|txt)$/.test(f) && !f.includes('node_modules'))
  .filter((f) => /[\w.+-]+@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me)\.com\b/i.test(readFileSync(join(root, f), 'utf8')));
check('no personal e-mail addresses in tracked files', personal.length === 0, personal.join(', '));

// ---------------------------------------------------------------- report
for (const name of ok) console.log(`✓ ${name}`);
for (const w of warnings) console.warn(`! ${w} (blocks --submission)`);
for (const f of failures) console.error(`✗ ${f}`);
console.log(`\n${ok.length} passed, ${failures.length} failed${warnings.length ? `, ${warnings.length} submission blockers` : ''}`);
process.exit(failures.length ? 1 : 0);
