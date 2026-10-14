import type {
  AddCartItemBody,
  AddCredentialBody,
  AssignRoleBody,
  AuditLogEntry,
  CartResponse,
  CheckoutPreview,
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
  Role,
  SystemStatus,
  UpdateAvailabilityBody,
  UpdateMeBody,
  UpdatePatientBody,
  UpsertProviderProfileBody,
  VerificationDecisionBody,
  VerificationQueueItem,
  WorkingHoursBody,
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

export type AdminUser = { id: string; name: string; email: string; emailVerified: boolean; twoFactorEnabled: boolean; createdAt: string; roles: Role[] };
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
    system: { status: () => get<SystemStatus>('/v1/system/status') },
    me: {
      get: () => get<MeResponse>('/v1/me'),
      update: (body: UpdateMeBody) => patch<MeResponse>('/v1/me', body),
      assignRole: (body: AssignRoleBody) => post<MeResponse>('/v1/me/roles', body),
      completeOnboarding: () => post<{ ok: true }>('/v1/me/onboarding/complete'),
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
      checkoutPreview: () => post<CheckoutPreview>('/v1/store/checkout/preview'),
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
      users: () => get<AdminUser[]>('/v1/admin/users'),
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
