/**
 * Legal documents shown in the app AND published on the public support site (apps/site).
 * One source → the in-app text and the URL given to Apple / Google never diverge.
 *
 * STATUS: DRAFT — written to describe what this build actually does. NOT reviewed by counsel.
 * Items in [brackets] must be confirmed by Alia Group legal before submission. Bump
 * LEGAL_DOCUMENT_VERSION (and app.settings `consent.current_versions`) on every material change:
 * users are then asked to consent again.
 */
export const LEGAL_DOCUMENT_VERSION = '2026-10-draft';
export const LEGAL_DOCUMENT_STATUS = 'DRAFT_PENDING_LEGAL_REVIEW' as const;
export const LEGAL_DOC_IDS = ['privacy', 'terms', 'health-consent', 'medical-disclaimer'] as const;
export type LegalDocId = (typeof LEGAL_DOC_IDS)[number];

type Section = { heading: string; paragraphs: string[] };
type LocalizedDoc = { title: string; summary: string; sections: Section[] };
export type LegalDocument = { id: LegalDocId; version: string; status: typeof LEGAL_DOCUMENT_STATUS; en: LocalizedDoc; ar: LocalizedDoc };

const CONTROLLER_EN = '[Legal entity name of Alia Group — to be confirmed], Arab Republic of Egypt';
const CONTROLLER_AR = '[الاسم القانوني لكيان Alia Group — يُؤكَّد لاحقاً]، جمهورية مصر العربية';
const CONTACT = '[privacy contact email — to be confirmed]';

export const LEGAL_DOCUMENTS: Record<LegalDocId, LegalDocument> = {
  privacy: {
    id: 'privacy',
    version: LEGAL_DOCUMENT_VERSION,
    status: LEGAL_DOCUMENT_STATUS,
    en: {
      title: 'Privacy Policy',
      summary: 'What Dress My Wound collects, why, who can see it, how long we keep it, and how to delete it.',
      sections: [
        { heading: 'Who we are', paragraphs: [`Dress My Wound (غير لي) is operated by ${CONTROLLER_EN} ("we"). Contact: ${CONTACT}.`] },
        {
          heading: 'What we collect',
          paragraphs: [
            'Account: your name, email address and/or Egyptian mobile number, password (stored only as a secure hash) and optional two-step verification settings.',
            'Health information you choose to record: date of birth, sex, blood type, allergies, conditions, medications, past surgeries, governorate and city, and an emergency contact — for yourself and for family members you are authorised to manage.',
            'Clinicians (doctors and nurses): professional profile, licence and qualification details submitted for verification, availability and services.',
            'Store: items in your TetraSol cart. Product payments are not processed in this version.',
            'Subscriptions (where offered): paid plans are bought and paid through the Apple App Store or Google Play — we never receive your card details. We receive the store’s transaction identifiers, the plan and its status (active, renewed, cancelled, refunded) to unlock your plan.',
            'Technical: sign-in sessions (device type and IP address, to protect your account) and anonymous app error reports that contain no account identifier.',
          ],
        },
        {
          heading: 'Why we use it',
          paragraphs: [
            'To provide the service you ask for: your medical timeline, family profiles, finding verified clinicians and the TetraSol store.',
            'Health information is processed only with your explicit consent, which you can withdraw at any time in Privacy & consent. Withdrawing stops new health records from being added.',
            'To keep the platform safe: verifying clinicians, preventing fraud and abuse, and keeping an audit log of access to sensitive data.',
            'We do not sell your data, we do not use it for advertising, and we do not track you across other companies’ apps or websites.',
          ],
        },
        {
          heading: 'Who can see it',
          paragraphs: [
            'Only you and the people you explicitly authorise (for example a family member who manages your profile). Clinicians see a patient’s record only within an active care relationship you start.',
            'Patients see that a clinician’s credentials were verified — never licence numbers.',
            'Infrastructure providers that host and operate the service for us, under contract and only on our instructions: [hosting provider and region — to be confirmed]; SMS/email delivery providers [to be confirmed].',
          ],
        },
        {
          heading: 'How long we keep it',
          paragraphs: [
            'Until you delete it or delete your account. When you delete your account we immediately delete your sign-in credentials and sessions and your own health records, and anonymise your account.',
            'We keep only what the law requires: financial records of completed clinician payouts, the security audit log and the history of consents you gave. These are retained for [retention period — to be confirmed by legal] and are not used for any other purpose.',
          ],
        },
        {
          heading: 'Your rights',
          paragraphs: [
            'You can view and correct your information in the app, withdraw consent, and delete your account in the app (Me → Privacy & consent → Delete account) or by contacting us.',
            'Under Egypt’s Personal Data Protection Law No. 151 of 2020 you may also contact us to exercise your rights, and complain to the competent authority.',
          ],
        },
        { heading: 'Children', paragraphs: ['Accounts are for adults (18+). A parent or legal guardian may create and manage a profile for a child; the guardian is responsible for that profile.'] },
        { heading: 'Security', paragraphs: ['Data is encrypted in transit, access is enforced by the database itself (row-level security), sensitive actions are logged, and staff with elevated access must use two-step verification.'] },
        { heading: 'Changes', paragraphs: ['If we change this policy materially, the app will ask you to review and accept the new version.'] },
      ],
    },
    ar: {
      title: 'سياسة الخصوصية',
      summary: 'ما الذي يجمعه غير لي، ولماذا، ومن يمكنه رؤيته، ومدة الاحتفاظ به، وكيف تحذفه.',
      sections: [
        { heading: 'من نحن', paragraphs: [`يُشغِّل تطبيق غير لي (Dress My Wound) ${CONTROLLER_AR} ("نحن"). للتواصل: ${CONTACT}.`] },
        {
          heading: 'ما الذي نجمعه',
          paragraphs: [
            'الحساب: اسمك، بريدك الإلكتروني و/أو رقم هاتفك المصري، وكلمة المرور (تُحفَظ بصيغة مُشفّرة غير قابلة للاسترجاع فقط)، وإعدادات التحقق بخطوتين الاختيارية.',
            'المعلومات الصحية التي تختار تسجيلها: تاريخ الميلاد، الجنس، فصيلة الدم، الحساسية، الأمراض، الأدوية، العمليات السابقة، المحافظة والمدينة، وجهة اتصال للطوارئ — لك ولأفراد العائلة المُصرَّح لك بإدارة ملفاتهم.',
            'مقدمو الرعاية (الأطباء والتمريض): الملف المهني، وبيانات الترخيص والمؤهلات المقدمة للتحقق، والمواعيد والخدمات.',
            'المتجر: المنتجات في سلة TetraSol. لا تتم معالجة أي مدفوعات للمنتجات في هذا الإصدار.',
            'الاشتراكات (عند توفرها): تُشترى الباقات المدفوعة وتُدفع عبر App Store من Apple أو Google Play، ولا نتلقى بيانات بطاقتك أبداً. نتلقى معرّفات المعاملة من المتجر والباقة وحالتها (نشطة، مُجدَّدة، مُلغاة، مُستردَّة) لتفعيل باقتك.',
            'بيانات تقنية: جلسات تسجيل الدخول (نوع الجهاز وعنوان IP لحماية حسابك) وتقارير أعطال مجهولة لا تحتوي على أي معرّف للحساب.',
          ],
        },
        {
          heading: 'لماذا نستخدمها',
          paragraphs: [
            'لتقديم الخدمة التي تطلبها: سجلك الطبي، ملفات العائلة، الوصول إلى مقدمي رعاية موثَّقين، ومتجر TetraSol.',
            'لا تتم معالجة المعلومات الصحية إلا بموافقتك الصريحة، ويمكنك سحبها في أي وقت من "الخصوصية والموافقات". سحب الموافقة يوقف إضافة سجلات صحية جديدة.',
            'للحفاظ على أمان المنصة: التحقق من مقدمي الرعاية، ومنع الاحتيال وإساءة الاستخدام، والاحتفاظ بسجل تدقيق للوصول إلى البيانات الحساسة.',
            'لا نبيع بياناتك، ولا نستخدمها للإعلانات، ولا نتتبعك عبر تطبيقات أو مواقع الشركات الأخرى.',
          ],
        },
        {
          heading: 'من يمكنه رؤيتها',
          paragraphs: [
            'أنت فقط ومن تُصرِّح لهم صراحةً (مثل فرد من العائلة يدير ملفك). لا يرى مقدم الرعاية سجل المريض إلا ضمن علاقة رعاية فعّالة تبدأها أنت.',
            'يرى المرضى أن بيانات اعتماد مقدم الرعاية تم التحقق منها — ولا يرون أرقام التراخيص أبداً.',
            'مزودو البنية التحتية الذين يستضيفون الخدمة ويشغّلونها لصالحنا بموجب عقود وبناءً على تعليماتنا فقط: [مزود الاستضافة والمنطقة — يُؤكَّد لاحقاً]؛ مزودو الرسائل النصية والبريد [يُؤكَّد لاحقاً].',
          ],
        },
        {
          heading: 'مدة الاحتفاظ',
          paragraphs: [
            'حتى تحذفها أو تحذف حسابك. عند حذف الحساب نحذف فوراً بيانات الدخول والجلسات وسجلاتك الصحية الخاصة، ونجعل الحساب مجهول الهوية.',
            'نحتفظ فقط بما يُلزِمنا به القانون: السجلات المالية لمستحقات مقدمي الرعاية المدفوعة، وسجل التدقيق الأمني، وسجل الموافقات التي منحتها، وذلك لمدة [مدة الاحتفاظ — يحددها الفريق القانوني] ولا تُستخدم لأي غرض آخر.',
          ],
        },
        {
          heading: 'حقوقك',
          paragraphs: [
            'يمكنك عرض بياناتك وتصحيحها داخل التطبيق، وسحب موافقتك، وحذف حسابك من داخل التطبيق (أنا ← الخصوصية والموافقات ← حذف الحساب) أو بالتواصل معنا.',
            'وفقاً لقانون حماية البيانات الشخصية المصري رقم ١٥١ لسنة ٢٠٢٠ يمكنك أيضاً التواصل معنا لممارسة حقوقك، والتقدم بشكوى إلى الجهة المختصة.',
          ],
        },
        { heading: 'الأطفال', paragraphs: ['الحسابات مخصصة للبالغين (١٨ عاماً فأكثر). يمكن للوالد أو الولي القانوني إنشاء ملف لطفل وإدارته، ويكون مسؤولاً عن هذا الملف.'] },
        { heading: 'الأمان', paragraphs: ['البيانات مُشفّرة أثناء النقل، والوصول إليها تفرضه قاعدة البيانات نفسها (أمان على مستوى الصفوف)، وتُسجَّل الإجراءات الحساسة، ويجب على الموظفين ذوي الصلاحيات العليا استخدام التحقق بخطوتين.'] },
        { heading: 'التعديلات', paragraphs: ['إذا عدّلنا هذه السياسة تعديلاً جوهرياً سيطلب منك التطبيق مراجعة النسخة الجديدة والموافقة عليها.'] },
      ],
    },
  },
  terms: {
    id: 'terms',
    version: LEGAL_DOCUMENT_VERSION,
    status: LEGAL_DOCUMENT_STATUS,
    en: {
      title: 'Terms of Use',
      summary: 'The rules for using Dress My Wound.',
      sections: [
        { heading: 'The service', paragraphs: [`Dress My Wound helps you organise health information for yourself and your family, find verified doctors and nurses, and browse TetraSol products. It is operated by ${CONTROLLER_EN}.`] },
        { heading: 'Not an emergency or diagnostic service', paragraphs: ['The app does not provide emergency care, diagnosis or treatment decisions. In an emergency in Egypt call 123 (ambulance). Always follow the advice of a qualified clinician.'] },
        { heading: 'Your account', paragraphs: ['You must be 18 or older, give accurate information, keep your password private, and only manage another person’s profile when you have their consent or legal authority.'] },
        { heading: 'Clinicians', paragraphs: ['Doctors and nurses must hold valid Egyptian licences, submit truthful credentials and keep them current. Verification by us is not a guarantee of clinical outcomes; each clinician remains professionally responsible for their care.'] },
        { heading: 'Store', paragraphs: ['The store lists TetraSol products only. Prices are shown in Egyptian pounds. Ordering and payment are not available in this version; any future purchase terms will be shown before you pay.'] },
        {
          heading: 'Paid plans',
          paragraphs: [
            'Where paid plans are offered in the app, they are auto-renewing subscriptions sold and billed by the Apple App Store or Google Play at the price the store shows before you confirm. Payment is charged to your store account.',
            'A subscription renews automatically for the same period unless you cancel it in your App Store or Google Play account settings at least 24 hours before the current period ends. Deleting your Dress My Wound account does not cancel a store subscription.',
            'Refunds are handled by Apple or Google under their policies. Plans unlock app features only; clinical services and TetraSol products are paid separately when they become available.',
          ],
        },
        { heading: 'Acceptable use', paragraphs: ['Do not misuse the service, attempt to access data that is not yours, or upload unlawful content. We may suspend accounts that put others at risk.'] },
        { heading: 'Ending your account', paragraphs: ['You can delete your account at any time in the app. See the Privacy Policy for what is deleted and what the law requires us to keep.'] },
        { heading: 'Governing law', paragraphs: ['These terms are governed by the laws of the Arab Republic of Egypt. [Dispute resolution clause — to be confirmed by legal.]'] },
      ],
    },
    ar: {
      title: 'شروط الاستخدام',
      summary: 'قواعد استخدام غير لي.',
      sections: [
        { heading: 'الخدمة', paragraphs: [`يساعدك غير لي على تنظيم المعلومات الصحية لك ولعائلتك، والوصول إلى أطباء وتمريض موثَّقين، وتصفح منتجات TetraSol. يُشغِّله ${CONTROLLER_AR}.`] },
        { heading: 'ليس خدمة طوارئ أو تشخيص', paragraphs: ['لا يقدم التطبيق رعاية طارئة أو تشخيصاً أو قرارات علاجية. في حالات الطوارئ داخل مصر اتصل بالرقم ١٢٣ (الإسعاف). اتبع دائماً إرشادات مقدم رعاية مؤهل.'] },
        { heading: 'حسابك', paragraphs: ['يجب أن يكون عمرك ١٨ عاماً أو أكثر، وأن تقدم معلومات صحيحة، وأن تحافظ على سرية كلمة المرور، وألا تدير ملف شخص آخر إلا بموافقته أو بسلطة قانونية.'] },
        { heading: 'مقدمو الرعاية', paragraphs: ['يجب أن يحمل الأطباء والتمريض تراخيص مصرية سارية، وأن يقدموا بيانات اعتماد صحيحة ومحدَّثة. التحقق الذي نجريه لا يضمن النتائج العلاجية، ويظل كل مقدم رعاية مسؤولاً مهنياً عن رعايته.'] },
        { heading: 'المتجر', paragraphs: ['يعرض المتجر منتجات TetraSol فقط، والأسعار بالجنيه المصري. الطلب والدفع غير متاحين في هذا الإصدار، وستُعرض أي شروط شراء مستقبلية قبل الدفع.'] },
        {
          heading: 'الباقات المدفوعة',
          paragraphs: [
            'عند توفر الباقات المدفوعة في التطبيق، تكون اشتراكات تتجدد تلقائياً يبيعها ويحصّل قيمتها App Store من Apple أو Google Play بالسعر الذي يعرضه المتجر قبل تأكيدك، ويُخصم المبلغ من حسابك في المتجر.',
            'يتجدد الاشتراك تلقائياً للمدة نفسها ما لم تُلغِه من إعدادات حسابك في App Store أو Google Play قبل انتهاء المدة الحالية بـ ٢٤ ساعة على الأقل. حذف حسابك في غير لي لا يُلغي الاشتراك في المتجر.',
            'تتولى Apple أو Google طلبات الاسترداد وفق سياساتهما. تفتح الباقات ميزات داخل التطبيق فقط، وتُدفع الخدمات العلاجية ومنتجات TetraSol بشكل منفصل عند توفرها.',
          ],
        },
        { heading: 'الاستخدام المقبول', paragraphs: ['لا تُسئ استخدام الخدمة، ولا تحاول الوصول إلى بيانات لا تخصك، ولا ترفع محتوى غير قانوني. يجوز لنا إيقاف الحسابات التي تعرّض الآخرين للخطر.'] },
        { heading: 'إنهاء الحساب', paragraphs: ['يمكنك حذف حسابك في أي وقت من داخل التطبيق. راجع سياسة الخصوصية لمعرفة ما يُحذف وما يُلزمنا القانون بالاحتفاظ به.'] },
        { heading: 'القانون الحاكم', paragraphs: ['تخضع هذه الشروط لقوانين جمهورية مصر العربية. [بند تسوية النزاعات — يحدده الفريق القانوني.]'] },
      ],
    },
  },
  'health-consent': {
    id: 'health-consent',
    version: LEGAL_DOCUMENT_VERSION,
    status: LEGAL_DOCUMENT_STATUS,
    en: {
      title: 'Consent to process health information',
      summary: 'Health information is sensitive personal data. We store it only with your explicit permission.',
      sections: [
        {
          heading: 'What you agree to',
          paragraphs: [
            'I allow Dress My Wound to store and use the health information I enter (and that I enter for family members I am authorised to manage) to show my medical timeline and to share it only with people and clinicians I choose.',
            'I understand this is optional, that I can withdraw this consent at any time in Privacy & consent, and that withdrawing stops new health records from being stored. I can delete existing records by deleting my account.',
          ],
        },
      ],
    },
    ar: {
      title: 'الموافقة على معالجة المعلومات الصحية',
      summary: 'المعلومات الصحية بيانات شخصية حساسة، ولا نحفظها إلا بإذنك الصريح.',
      sections: [
        {
          heading: 'ما الذي توافق عليه',
          paragraphs: [
            'أسمح لتطبيق غير لي بحفظ واستخدام المعلومات الصحية التي أُدخلها (والتي أُدخلها لأفراد العائلة المُصرَّح لي بإدارة ملفاتهم) لعرض سجلي الطبي، ومشاركتها فقط مع من أختارهم من أشخاص ومقدمي رعاية.',
            'أفهم أن هذه الموافقة اختيارية، وأنه يمكنني سحبها في أي وقت من "الخصوصية والموافقات"، وأن سحبها يوقف حفظ سجلات صحية جديدة، وأنه يمكنني حذف السجلات الحالية بحذف حسابي.',
          ],
        },
      ],
    },
  },
  'medical-disclaimer': {
    id: 'medical-disclaimer',
    version: LEGAL_DOCUMENT_VERSION,
    status: LEGAL_DOCUMENT_STATUS,
    en: {
      title: 'Medical disclaimer',
      summary: 'Dress My Wound organises information and connects you with clinicians. It does not diagnose or treat.',
      sections: [
        {
          heading: 'Please read',
          paragraphs: [
            'Information in the app is entered by you or your family and is marked as self-reported. It is not a diagnosis.',
            'The app does not provide automated diagnosis or treatment advice. Any such feature will only be offered after the required clinical validation and regulatory approval.',
            'In an emergency, call 123 (ambulance, Egypt) or go to the nearest emergency department.',
          ],
        },
      ],
    },
    ar: {
      title: 'إخلاء المسؤولية الطبية',
      summary: 'ينظّم غير لي المعلومات ويوصلك بمقدمي الرعاية، ولا يقدم تشخيصاً أو علاجاً.',
      sections: [
        {
          heading: 'يُرجى القراءة',
          paragraphs: [
            'المعلومات في التطبيق يُدخلها المستخدم أو عائلته، وتُعلَّم بأنها مُبلَّغ عنها ذاتياً، وليست تشخيصاً.',
            'لا يقدم التطبيق تشخيصاً آلياً أو نصائح علاجية. لن تُتاح أي ميزة من هذا النوع إلا بعد التحقق السريري اللازم والحصول على الموافقات التنظيمية المطلوبة.',
            'في حالات الطوارئ اتصل بالرقم ١٢٣ (الإسعاف في مصر) أو توجّه إلى أقرب قسم طوارئ.',
          ],
        },
      ],
    },
  },
};
