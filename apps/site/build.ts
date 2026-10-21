/**
 * Builds the public support site (static HTML, no JavaScript, no trackers) into ./dist:
 *   /                    support & contact
 *   /privacy, /terms, /health-consent, /medical-disclaimer   (EN + AR, same source as the app)
 *   /delete-account      web account-deletion instructions (Google Play requires a web URL)
 *   /.well-known/*       ONLY when real values are supplied (APPLE_TEAM_ID, ANDROID_CERT_SHA256)
 *
 *   SUPPORT_EMAIL=support@example.com APPLE_TEAM_ID=ABCDE12345 ANDROID_CERT_SHA256=AA:BB:… pnpm --filter @ghayarly/site build
 *
 * Without SUPPORT_EMAIL the pages show a clearly marked placeholder — they must not be published
 * as store URLs until the contact address is confirmed (docs/release/RELEASE_STATUS.md).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_DOCUMENTS, LEGAL_DOC_IDS, type LegalDocId } from '../../packages/shared/src/legal.ts';
import { BRAND_NAME_AR, BRAND_NAME_EN, CORPORATE_GROUP } from '../../packages/shared/src/brand.ts';
import { brandConfig } from '../../packages/tokens/src/brand.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
const support = process.env.SUPPORT_EMAIL ?? '[support email — to be confirmed]';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const css = `:root{--navy:${brandConfig.hues.navy};--orange:${brandConfig.hues.orange};--stone:${brandConfig.hues.stone};--brass:${brandConfig.hues.brass};--ink:#3A4A60}
*{box-sizing:border-box}body{margin:0;background:var(--stone);color:var(--navy);font:16px/1.65 system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",sans-serif}
header{background:var(--navy);color:#F7F3EC;padding:28px 20px}header a{color:#F7F3EC;text-decoration:none}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}.brand{font-size:22px;font-weight:700}.by{color:var(--brass);font-size:12px;letter-spacing:1.2px;text-transform:uppercase}
main{padding:28px 0 56px}h1{font-size:28px;line-height:1.25}h2{font-size:19px;margin-top:28px}p,li{color:var(--ink)}
.cols{display:grid;gap:32px}@media(min-width:900px){.cols{grid-template-columns:1fr 1fr}}
.note{background:#FFF4D6;border-radius:12px;padding:12px 16px;color:#5c3d00}a{color:var(--navy)}nav a{margin-inline-end:16px}
footer{border-top:1px solid #E5DDD0;padding:20px 0;color:#5A6779;font-size:13px}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${BRAND_NAME_EN} | ${BRAND_NAME_AR}</title><meta name="robots" content="index,follow"><style>${css}</style></head>
<body><header><div class="wrap"><a href="/"><div class="brand">${BRAND_NAME_EN} <span lang="ar" dir="rtl">| ${BRAND_NAME_AR}</span></div><div class="by">by ${CORPORATE_GROUP}</div></a></div></header>
<main class="wrap"><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/delete-account">Delete account</a><a href="/">Support</a></nav>${body}</main>
<footer class="wrap">© ${CORPORATE_GROUP}. ${BRAND_NAME_EN} is not an emergency service — in Egypt call 123 for an ambulance.</footer></body></html>`;
}

function section(doc: (typeof LEGAL_DOCUMENTS)[LegalDocId], lang: 'en' | 'ar'): string {
  const d = doc[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<section lang="${lang}" dir="${dir}"><h1>${esc(d.title)}</h1><p>${esc(d.summary)}</p>${d.sections
    .map((s) => `<h2>${esc(s.heading)}</h2>${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}`)
    .join('')}</section>`;
}

function write(path: string, html: string) {
  const file = join(out, path, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

for (const id of LEGAL_DOC_IDS) {
  const doc = LEGAL_DOCUMENTS[id];
  const draft = doc.status === 'DRAFT_PENDING_LEGAL_REVIEW' ? `<p class="note">Draft ${esc(doc.version)} — pending legal review. · <span lang="ar" dir="rtl">مسودة بانتظار المراجعة القانونية.</span></p>` : '';
  write(id, page(doc.en.title, `${draft}<div class="cols">${section(doc, 'en')}${section(doc, 'ar')}</div>`));
}

write(
  'delete-account',
  page(
    'Delete your account',
    `<div class="cols"><section lang="en"><h1>Delete your Dress My Wound account</h1>
<p><strong>In the app (fastest):</strong> Me → Privacy &amp; consent → Delete account. Confirm with your password (or sign in again if you use a phone number) and type DELETE. Deletion is immediate.</p>
<p><strong>Without the app:</strong> email <a href="mailto:${esc(support)}">${esc(support)}</a> from the email address or include the phone number registered on the account, with the subject “Delete my account”. We verify that the request comes from the account holder before deleting, and confirm by email.</p>
<h2>What is deleted</h2><p>Sign-in details and sessions, your own health profile and records, family profiles only you manage, your cart, and clinician profile data.</p>
<h2>What is kept</h2><p>Profiles shared with another family member stay with them; financial records of completed clinician payouts, the security audit log and consent history are retained as required by law, without your name or contact details.</p>
<p>An App Store or Google Play subscription is billed by Apple or Google — cancel it in your store account settings; deleting the account does not cancel it.</p></section>
<section lang="ar" dir="rtl"><h1>حذف حسابك في غير لي</h1>
<p><strong>من داخل التطبيق (الأسرع):</strong> أنا ← الخصوصية والموافقات ← حذف الحساب. أكّد بكلمة المرور (أو سجّل الدخول مجددًا إذا كنت تستخدم رقم الهاتف) واكتب DELETE. يتم الحذف فورًا.</p>
<p><strong>بدون التطبيق:</strong> راسلنا على <a href="mailto:${esc(support)}">${esc(support)}</a> من البريد المسجّل أو مع ذكر رقم الهاتف المسجّل، بعنوان "حذف حسابي". نتحقق من أن الطلب من صاحب الحساب قبل الحذف ونؤكد بالبريد.</p>
<h2>ما يُحذف</h2><p>بيانات الدخول والجلسات، وملفك الصحي وسجلاتك، وملفات العائلة التي تديرها وحدك، والسلة، وبيانات ملف مقدم الرعاية.</p>
<h2>ما يُحتفظ به</h2><p>تبقى الملفات المشتركة مع فرد آخر من العائلة معه؛ ويُحتفظ بالسجلات المالية لمستحقات مقدمي الرعاية المدفوعة وسجل التدقيق الأمني وسجل الموافقات وفق القانون، دون اسمك أو بيانات التواصل.</p>
<p>اشتراك App Store أو Google Play تديره Apple أو Google — ألغِه من إعدادات حسابك في المتجر؛ حذف الحساب لا يلغيه.</p></section></div>`,
  ),
);

write(
  '',
  page(
    'Support',
    `<div class="cols"><section lang="en"><h1>Support</h1><p>${BRAND_NAME_EN} helps families organise health information and reach verified doctors and nurses in Egypt. It is not an emergency service: in an emergency call <strong>123</strong>.</p>
<p>Contact: <a href="mailto:${esc(support)}">${esc(support)}</a></p></section>
<section lang="ar" dir="rtl"><h1>الدعم</h1><p>يساعد غير لي العائلات على تنظيم المعلومات الصحية والوصول إلى أطباء وتمريض موثَّقين في مصر. ليس خدمة طوارئ: في حالات الطوارئ اتصل بالرقم <strong>١٢٣</strong>.</p>
<p>للتواصل: <a href="mailto:${esc(support)}">${esc(support)}</a></p></section></div>`,
  ),
);

// Verified-link association files only with REAL values — never publish placeholders. The app ID
// must be the one the store build uses (APP_ID_BASE, same default as apps/mobile/app.config.ts).
const team = process.env.APPLE_TEAM_ID;
const certs = process.env.ANDROID_CERT_SHA256;
const appId = process.env.APP_ID_BASE ?? 'com.aliagroup.dressmywound';
if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(appId)) throw new Error(`APP_ID_BASE "${appId}" is not a reverse-DNS identifier`);
if (team && !/^[A-Z0-9]{10}$/.test(team)) throw new Error('APPLE_TEAM_ID must be the 10-character Team ID from the Apple Developer account');
const fingerprints = certs?.split(',').map((c) => c.trim().toUpperCase());
if (fingerprints?.some((c) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(c))) throw new Error('ANDROID_CERT_SHA256 must be SHA-256 fingerprints (AA:BB:…, 32 bytes) from Play Console → App integrity');
mkdirSync(join(out, '.well-known'), { recursive: true });
const template = (name: string) => JSON.parse(readFileSync(join(here, `well-known/${name}`), 'utf8').replaceAll('<APP_ID>', appId));
if (team) {
  const aasa = JSON.parse(JSON.stringify(template('apple-app-site-association.template.json')).replace('<APPLE_TEAM_ID>', team));
  writeFileSync(join(out, '.well-known/apple-app-site-association'), JSON.stringify(aasa, null, 2));
}
if (fingerprints) {
  const links = template('assetlinks.template.json');
  links[0].target.sha256_cert_fingerprints = fingerprints;
  writeFileSync(join(out, '.well-known/assetlinks.json'), JSON.stringify(links, null, 2));
}
console.log(`✓ site built in ${out}${team ? ' (+ apple-app-site-association)' : ''}${certs ? ' (+ assetlinks.json)' : ''}`);
