import type {
  AddCartItemBody,
  AddCredentialBody,
  AssignRoleBody,
  AuditLogEntry,
  CartResponse,
  CheckoutPreview,
  ClientErrorReport,
  ConsentsResponse,
  DeleteAccountBody,
  EntitlementsResponse,
  PlanForClient,
  DeleteAccountResponse,
  FeatureFlagAdmin,
  FeatureFlags,
  RecordConsentBody,
  ClinicianDashboard,
  CreateHealthEntryBody,
  CreatePatientBody,
  CredentialDecisionBody,
  Credential,
  EarningsSummary,
  HealthEntry,
  MeResponse,
  MyProviderProfile,
  NursingService,
  PatientAccessGrant,
  PatientDashboard,
  PatientSummary,
  ProductCard,
  ProductDetail,
  ProviderCard,
  ProviderDetail,
  ProviderSearchQuery,
  ProviderServicesBody,
  SystemStatus,
  UpdateAvailabilityBody,
  UpdateMeBody,
  UpdatePatientBody,
  UpsertProviderProfileBody,
  VerificationDecisionBody,
  VerificationQueueItem,
  WorkingHoursBody,
  AdminProduct,
  AdminProductListItem,
  Brand,
  Bundle,
  CatalogAnalytics,
  Category,
  Discount,
  StoreBundle,
  StoreCategory,
  AccountStatusActionBody,
  AdminUserDetail,
  AdminUserListItem,
  Appeal,
  MyAccountStatus,
  AiAssistantStatus,
  AiControlCentre,
  AiConversation,
  AiConversationDetail,
  AiModelAdmin,
  AiReply,
  AiEvalCase,
  AiEvalResult,
  AiEvalRun,
  AiEvaluationOverview,
} from '@ghayarly/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  /** Extra headers per request (e.g. the Better Auth cookie on native). */
  getHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  /** `include` for browsers so the session cookie is sent cross-origin. */
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
};

type Query = Record<string, string | number | boolean | undefined | null>;

export type AdminProviderSubmission = {
  profile: Record<string, unknown> & {
    userId: string;
    providerType: 'DOCTOR' | 'NURSE';
    displayNameAr: string;
    displayNameEn: string;
    verificationStatus: string;
    verificationNote: string | null;
    specialty: string | null;
    subspecialty: string | null;
    yearsExperience: number;
    governorate: string;
    city: string;
    currentAffiliation: string | null;
    feePiasters: number | null;
    gender: string;
    isDemo: boolean;
    submittedAt: string | null;
  };
  credentials: Credential[];
  events: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string; actorUserId: string | null }[];
  workingHours: { weekday: number; startMinute: number; endMinute: number }[];
  missingApprovedCredentials: string[];
  isSelf: boolean;
};

/** @deprecated use AdminUserListItem */
export type AdminUser = AdminUserListItem;
export type ProviderServiceSelection = NursingService & { selected: boolean; pricePiasters: number | null };
export type OutboxMessage = { id: number; channel: 'email' | 'sms'; to: string; subject?: string; body: string; purpose: string; createdAt: string };

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const url = new URL(path, options.baseUrl);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/json', ...(await options.getHeaders?.()) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: options.credentials ?? 'include',
      });
    } catch (err) {
      throw new ApiError(0, 'NETWORK_ERROR', (err as Error).message ?? 'Network error');
    }
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? res.statusText, e?.details);
    }
    return json as T;
  }

  const get = <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query);
  const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
  const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
  const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
  const del = <T>(path: string) => request<T>('DELETE', path);

  return {
    request,
    system: {
      status: () => get<SystemStatus>('/v1/system/status'),
      features: () => get<FeatureFlags>('/v1/system/features'),
      reportError: (body: ClientErrorReport) => post<{ ok: true }>('/v1/telemetry/client-errors', body),
    },
    me: {
      get: () => get<MeResponse>('/v1/me'),
      update: (body: UpdateMeBody) => patch<MeResponse>('/v1/me', body),
      assignRole: (body: AssignRoleBody) => post<MeResponse>('/v1/me/roles', body),
      completeOnboarding: () => post<{ ok: true }>('/v1/me/onboarding/complete'),
      consents: () => get<ConsentsResponse>('/v1/me/consents'),
      recordConsents: (body: RecordConsentBody) => post<ConsentsResponse>('/v1/me/consents', body),
      deleteAccount: (body: DeleteAccountBody) => post<DeleteAccountResponse>('/v1/me/account-deletion', body),
      accountStatus: () => get<MyAccountStatus>('/v1/me/account-status'),
      appeal: (body: { message: string; eventId?: string }) => post<Appeal>('/v1/me/appeals', body),
    },
    billing: {
      plans: (platform: 'ios' | 'android' | 'web') => get<PlanForClient[]>('/v1/billing/plans', { platform }),
      entitlements: () => get<EntitlementsResponse>('/v1/billing/entitlements'),
      accountToken: () => get<{ appAccountToken: string }>('/v1/billing/account-token'),
      verifyApple: (body: { signedTransactionInfo: string }) => post<EntitlementsResponse>('/v1/billing/apple/verify', body),
      verifyGoogle: (body: { productId: string; purchaseToken: string }) => post<EntitlementsResponse>('/v1/billing/google/verify', body),
      restore: (body: { apple: string[]; google: { productId: string; purchaseToken: string }[] }) => post<EntitlementsResponse & { restoreErrors: string[] }>('/v1/billing/restore', body),
    },
    patients: {
      list: () => get<PatientSummary[]>('/v1/patients'),
      create: (body: CreatePatientBody) => post<PatientSummary>('/v1/patients', body),
      get: (id: string) => get<PatientSummary>(`/v1/patients/${id}`),
      update: (id: string, body: UpdatePatientBody) => patch<PatientSummary>(`/v1/patients/${id}`, body),
      healthEntries: (id: string) => get<HealthEntry[]>(`/v1/patients/${id}/health-entries`),
      addHealthEntry: (id: string, body: CreateHealthEntryBody) => post<HealthEntry>(`/v1/patients/${id}/health-entries`, body),
      removeHealthEntry: (id: string, entryId: string) => del<{ ok: true }>(`/v1/patients/${id}/health-entries/${entryId}`),
      access: (id: string) => get<PatientAccessGrant[]>(`/v1/patients/${id}/access`),
      revokeAccess: (id: string, userId: string) => del<{ ok: true }>(`/v1/patients/${id}/access/${encodeURIComponent(userId)}`),
    },
    providers: {
      search: (q: ProviderSearchQuery) => get<ProviderCard[]>('/v1/providers', q),
      get: (userId: string) => get<ProviderDetail>(`/v1/providers/${encodeURIComponent(userId)}`),
    },
    provider: {
      me: () => get<MyProviderProfile>('/v1/provider/me'),
      upsert: (body: UpsertProviderProfileBody) => put<MyProviderProfile>('/v1/provider/me', body),
      addCredential: (body: AddCredentialBody) => post<MyProviderProfile>('/v1/provider/me/credentials', body),
      removeCredential: (id: string) => del<MyProviderProfile>(`/v1/provider/me/credentials/${id}`),
      submit: () => post<MyProviderProfile>('/v1/provider/me/submit'),
      updateAvailability: (body: UpdateAvailabilityBody) => patch<MyProviderProfile>('/v1/provider/me/availability', body),
      setWorkingHours: (body: WorkingHoursBody) => put<MyProviderProfile>('/v1/provider/me/working-hours', body),
      services: () => get<ProviderServiceSelection[]>('/v1/provider/me/services'),
      setServices: (body: ProviderServicesBody) => put<{ ok: true; count: number }>('/v1/provider/me/services', body),
      earnings: () => get<EarningsSummary>('/v1/provider/me/earnings'),
    },
    services: { list: () => get<NursingService[]>('/v1/services') },
    store: {
      products: () => get<ProductCard[]>('/v1/store/products'),
      product: (slug: string) => get<ProductDetail>(`/v1/store/products/${slug}`),
      cart: () => get<CartResponse>('/v1/store/cart'),
      addToCart: (body: AddCartItemBody) => post<CartResponse>('/v1/store/cart/items', body),
      updateCartItem: (id: string, quantity: number) => patch<CartResponse>(`/v1/store/cart/items/${id}`, { quantity }),
      removeCartItem: (id: string) => del<CartResponse>(`/v1/store/cart/items/${id}`),
      checkoutPreview: (body: { discountCode?: string } = {}) => post<CheckoutPreview>('/v1/store/checkout/preview', body),
      bundles: () => get<StoreBundle[]>('/v1/store/bundles'),
      categories: () => get<StoreCategory[]>('/v1/store/categories'),
    },
    /** Patient AI assistant. The server decides availability, quota and safety; the app only renders. */
    ai: {
      assistant: () => get<AiAssistantStatus>('/v1/ai/assistant'),
      conversations: () => get<AiConversation[]>('/v1/ai/conversations'),
      createConversation: (body: { patientId?: string | null } = {}) => post<AiConversation>('/v1/ai/conversations', body),
      conversation: (id: string) => get<AiConversationDetail>(`/v1/ai/conversations/${id}`),
      deleteConversation: (id: string) => del<{ ok: true }>(`/v1/ai/conversations/${id}`),
      send: (id: string, content: string) => post<AiReply>(`/v1/ai/conversations/${id}/messages`, { content }),
    },
    /** AI control centre: configuration only — provider keys never leave the backend. */
    aiAdmin: {
      controlCentre: (days = 30) => get<AiControlCentre>('/v1/admin/ai/control-centre', { days }),
      createModel: (body: Record<string, unknown>) => post<AiModelAdmin>('/v1/admin/ai/models', body),
      updateModel: (id: string, body: Record<string, unknown>) => patch<AiModelAdmin>(`/v1/admin/ai/models/${id}`, body),
      updateRoute: (key: string, body: Record<string, unknown>) => patch<AiControlCentre>(`/v1/admin/ai/routes/${encodeURIComponent(key)}`, body),
      addCandidate: (key: string, body: Record<string, unknown>) => post<AiControlCentre>(`/v1/admin/ai/routes/${encodeURIComponent(key)}/candidates`, body),
      updateCandidate: (id: string, body: Record<string, unknown>) => patch<AiControlCentre>(`/v1/admin/ai/candidates/${id}`, body),
      removeCandidate: (id: string) => del<AiControlCentre>(`/v1/admin/ai/candidates/${id}`),
      updateQuota: (body: { plan?: string; role?: string; metric: string; weeklyLimit: number }) => patch<AiControlCentre>('/v1/admin/ai/quotas', body),
      setBudget: (monthlyLimitMicros: number | null) => put<AiControlCentre>('/v1/admin/ai/budget', { monthlyLimitMicros }),
      setPlanBudget: (body: { plan: string; userMonthlyLimitMicros: number | null; planMonthlyLimitMicros: number | null }) => put<AiControlCentre>('/v1/admin/ai/plan-budgets', body),
      evaluation: () => get<AiEvaluationOverview>('/v1/admin/ai/evaluation'),
      createCase: (body: Record<string, unknown>) => post<AiEvalCase>('/v1/admin/ai/evaluation/cases', body),
      updateCase: (id: string, body: Record<string, unknown>) => patch<AiEvalCase>(`/v1/admin/ai/evaluation/cases/${id}`, body),
      reviewCase: (id: string, decision: 'REVIEWED' | 'RETIRED') => post<AiEvalCase>(`/v1/admin/ai/evaluation/cases/${id}/review`, { decision }),
      startRun: (modelId: string, routeKey = 'patient.chat') => post<AiEvalRun>('/v1/admin/ai/evaluation/runs', { modelId, routeKey }),
      run: (id: string) => get<AiEvalRun & { results: AiEvalResult[] }>(`/v1/admin/ai/evaluation/runs/${id}`),
      reviewResult: (id: string, body: { accuracy: number; hallucination: boolean; unsafe: boolean; arabicQuality?: number | null; notes?: string }) => post<{ ok: true }>(`/v1/admin/ai/evaluation/results/${id}/review`, body),
      approveModel: (body: { routeKey: string; modelId: string; runId: string; note: string }) => post<{ id: string }>('/v1/admin/ai/evaluation/approvals', body),
      revokeApproval: (id: string, note: string) => post<{ ok: true }>(`/v1/admin/ai/evaluation/approvals/${id}/revoke`, { note }),
      healthCheck: (code: string, modelId: string) => post<{ provider: string; configured: boolean; ok: boolean; detail: string; checkedAt: string; environment: string }>(`/v1/admin/ai/providers/${code}/health-check`, { modelId }),
    },
    dashboard: {
      patient: (patientId?: string) => get<PatientDashboard>('/v1/dashboard/patient', { patientId }),
      clinician: () => get<ClinicianDashboard>('/v1/dashboard/clinician'),
    },
    admin: {
      overview: () => get<{ providersByStatus: { status: string; type: string; n: number }[]; mfaEnforcement: string; demoMode: boolean }>('/v1/admin/overview'),
      queue: (status = 'OPEN') => get<VerificationQueueItem[]>('/v1/admin/verification-queue', { status }),
      provider: (userId: string) => get<AdminProviderSubmission>(`/v1/admin/providers/${encodeURIComponent(userId)}`),
      decide: (userId: string, body: VerificationDecisionBody) => post<{ status: string }>(`/v1/admin/providers/${encodeURIComponent(userId)}/decision`, body),
      decideCredential: (id: string, body: CredentialDecisionBody) => post<Credential>(`/v1/admin/credentials/${id}/decision`, body),
      auditLog: (limit = 100) => get<AuditLogEntry[]>('/v1/admin/audit-log', { limit }),
      users: (q: { q?: string; role?: string; status?: string; limit?: number; offset?: number } = {}) => get<AdminUserListItem[]>('/v1/admin/users', q),
      user: (id: string) => get<AdminUserDetail>(`/v1/admin/users/${encodeURIComponent(id)}`),
      setAccountStatus: (id: string, body: AccountStatusActionBody) => post<{ status: string }>(`/v1/admin/users/${encodeURIComponent(id)}/status`, body),
      appeals: (status = 'OPEN') => get<Appeal[]>('/v1/admin/appeals', { status }),
      decideAppeal: (id: string, body: { decision: 'GRANTED' | 'DENIED'; note: string }) => post<{ status: string }>(`/v1/admin/appeals/${id}/decision`, body),
      features: () => get<FeatureFlagAdmin[]>('/v1/admin/features'),
      setFeature: (key: string, body: { enabled: boolean; evidenceRef?: string | null }) => patch<FeatureFlagAdmin>(`/v1/admin/features/${encodeURIComponent(key)}`, body),
    },
    /** Admin Console catalogue (bodies are validated server-side by the zod schemas in @ghayarly/shared). */
    catalog: {
      brands: () => get<Brand[]>('/v1/admin/catalog/brands'),
      createBrand: (body: { name: string; ownerEntity: string; ownershipReference: string }) => post<{ ok: true }>('/v1/admin/catalog/brands', body),
      updateBrand: (name: string, body: { ownerEntity?: string; ownershipReference?: string; active?: boolean }) => patch<{ ok: true }>(`/v1/admin/catalog/brands/${encodeURIComponent(name)}`, body),
      categories: () => get<Category[]>('/v1/admin/catalog/categories'),
      createCategory: (body: { slug: string; nameAr: string; nameEn: string; sortOrder?: number }) => post<Category>('/v1/admin/catalog/categories', body),
      updateCategory: (id: string, body: Partial<{ slug: string; nameAr: string; nameEn: string; sortOrder: number; active: boolean }>) => patch<Category>(`/v1/admin/catalog/categories/${id}`, body),
      products: (q: { status?: string; q?: string } = {}) => get<AdminProductListItem[]>('/v1/admin/catalog/products', q),
      product: (id: string) => get<AdminProduct>(`/v1/admin/catalog/products/${id}`),
      createProduct: (body: Record<string, unknown>) => post<AdminProduct>('/v1/admin/catalog/products', body),
      updateProduct: (id: string, body: Record<string, unknown>) => patch<AdminProduct>(`/v1/admin/catalog/products/${id}`, body),
      approve: (id: string, approvalReference: string) => post<AdminProduct>(`/v1/admin/catalog/products/${id}/approve`, { approvalReference }),
      withdrawApproval: (id: string) => post<AdminProduct>(`/v1/admin/catalog/products/${id}/withdraw-approval`),
      setPublication: (id: string, status: 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED') => post<AdminProduct>(`/v1/admin/catalog/products/${id}/publication`, { status }),
      deleteProduct: (id: string) => del<{ ok: true }>(`/v1/admin/catalog/products/${id}`),
      addVariant: (productId: string, body: Record<string, unknown>) => post<AdminProduct>(`/v1/admin/catalog/products/${productId}/variants`, body),
      updateVariant: (id: string, body: Record<string, unknown>) => patch<AdminProduct>(`/v1/admin/catalog/variants/${id}`, body),
      adjustStock: (id: string, body: { delta: number; reason: string; note?: string }) => post<AdminProduct>(`/v1/admin/catalog/variants/${id}/stock`, body),
      uploadImage: (productId: string, body: { contentType: string; dataBase64: string; altAr?: string; altEn?: string; sortOrder?: number }) => post<AdminProduct>(`/v1/admin/catalog/products/${productId}/images`, body),
      updateImage: (id: string, body: { altAr?: string; altEn?: string; sortOrder?: number }) => patch<AdminProduct>(`/v1/admin/catalog/images/${id}`, body),
      deleteImage: (id: string) => del<AdminProduct>(`/v1/admin/catalog/images/${id}`),
      discounts: () => get<Discount[]>('/v1/admin/catalog/discounts'),
      createDiscount: (body: Record<string, unknown>) => post<Discount>('/v1/admin/catalog/discounts', body),
      updateDiscount: (id: string, body: { active?: boolean; endsAt?: string | null; nameAr?: string; nameEn?: string }) => patch<Discount>(`/v1/admin/catalog/discounts/${id}`, body),
      bundles: () => get<Bundle[]>('/v1/admin/catalog/bundles'),
      createBundle: (body: Record<string, unknown>) => post<Bundle>('/v1/admin/catalog/bundles', body),
      updateBundle: (id: string, body: Record<string, unknown>) => patch<Bundle>(`/v1/admin/catalog/bundles/${id}`, body),
      setBundleItems: (id: string, items: { variantId: string; quantity: number }[]) => put<Bundle>(`/v1/admin/catalog/bundles/${id}/items`, { items }),
      setBundlePublication: (id: string, status: 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED') => post<Bundle>(`/v1/admin/catalog/bundles/${id}/publication`, { status }),
      analytics: (days = 30) => get<CatalogAnalytics>('/v1/admin/catalog/analytics', { days }),
    },
    dev: {
      outbox: (q?: { to?: string; purpose?: string }) => get<{ notice: string; messages: OutboxMessage[] }>('/dev/outbox', q),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { code: 'INVALID_RESPONSE', message: text.slice(0, 200) } };
  }
}
