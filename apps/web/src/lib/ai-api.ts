/**
 * L-アシスト AI 機能用 API クライアント
 *
 * 既存 api.ts と分離して、テナント分離は X-Line-Account-Id ヘッダで行う。
 * fetchApi の薄いラッパー。
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL is not set')
}

function getApiKey(): string {
  if (typeof window !== 'undefined') return localStorage.getItem('lh_api_key') || ''
  return ''
}

async function aiFetch<T>(
  path: string,
  accountId: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
      'X-Line-Account-Id': accountId,
      ...options?.headers,
    },
  })
  if (!res.ok) {
    let body = ''
    try {
      body = await res.text()
    } catch {
      /* ignore */
    }
    throw new Error(`API ${res.status}: ${body || res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptModuleType =
  | 'personality'
  | 'voice_tone'
  | 'business_kb'
  | 'faq'
  | 'restrictions'
  | 'scenario'
  | 'escalation'
  | 'industry_preset'
  | 'internal_manual'
  | 'product_recommend'

export interface PromptModule {
  id: string
  line_account_id: string
  module_type: PromptModuleType
  current_version_id: string | null
  active: number
  created_at: string
  updated_at: string
}

export interface PromptModuleVersion {
  id: string
  module_id: string
  version: number
  content: string
  author_id: string | null
  note: string | null
  created_at: string
}

export type KbSourceType =
  | 'faq'
  | 'product'
  | 'brand_guide'
  | 'manual'
  | 'policy'
  | 'external_url'
  | 'past_broadcast'
  | 'past_scenario'
  | 'past_chat'

export interface KbDocument {
  id: string
  line_account_id: string
  source_type: KbSourceType
  title: string
  content: string
  source_url: string | null
  metadata_json: string | null
  active: number
  vector_indexed: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AiProduct {
  id: string
  line_account_id: string
  sku: string | null
  name: string
  description: string | null
  price_yen: number | null
  stock: number | null
  image_url: string | null
  product_url: string | null
  category: string | null
  tags_json: string | null
  active: number
  vector_indexed: number
  created_at: string
  updated_at: string
}

export interface AiFriendSignal {
  friend_id: string
  line_account_id: string
  purchase_intent: number
  churn_risk: number
  ltv_estimate_yen: number | null
  vip_rank: 'vip' | 'hot' | 'warm' | 'cold' | 'dormant' | 'new' | null
  sentiment: 'positive' | 'neutral' | 'negative' | 'angry' | null
  signal_summary: string | null
  last_chat_at: string | null
  last_calculated_at: string
}

export type KpiMetric =
  | 'broadcast_count'
  | 'friend_growth'
  | 'cv_count'
  | 'reactivation_count'
  | 'open_rate'
  | 'click_rate'
  | 'nps'
  | 'reservation_count'
  | 'review_count'

export interface KpiGoal {
  id: string
  line_account_id: string
  year_month: string
  metric: KpiMetric
  target_value: number
  current_value: number
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type AgentJobStatus =
  | 'pending'
  | 'running'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AgentJob {
  id: string
  line_account_id: string
  job_type: string
  input_json: string
  origin: 'kpi_planner' | 'manual' | 'automation' | 'cron' | 'webhook'
  related_kpi_id: string | null
  status: AgentJobStatus
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  output_json: string | null
  cost_yen_x100: number
  retries: number
  max_retries: number
  error: string | null
  reviewer_id: string | null
  reviewed_at: string | null
  notes: string | null
  created_at: string
}

export interface AutomationPolicy {
  line_account_id: string
  plan_tier: 'starter' | 'pro' | 'enterprise'
  monthly_broadcast_count: number
  automation_level: 'careful' | 'standard' | 'aggressive'
  job_overrides_json: string | null
  notification_channel: string | null
  notification_target: string | null
  updated_at: string
}

export interface AgencyExample {
  id: string
  industry: string | null
  broadcast_type: string | null
  time_of_day: string | null
  weekday: string | null
  season: string | null
  title: string | null
  content: string
  image_url: string | null
  source_url: string | null
  notes: string | null
  tags_json: string | null
  is_public: number
  added_by: string | null
  created_at: string
  updated_at: string
}

export interface AgencyExampleInput {
  industry?: string | null
  broadcast_type?: string | null
  time_of_day?: string | null
  weekday?: string | null
  season?: string | null
  title?: string | null
  content?: string
  image_url?: string | null
  source_url?: string | null
  notes?: string | null
  tags?: string[]
  is_public?: boolean
}

export interface TenantMetering {
  line_account_id: string
  plan: 'lite' | 'standard' | 'pro' | 'enterprise'
  monthly_broadcast_quota: number
  monthly_chat_quota: number
  monthly_vision_quota: number
  monthly_imagegen_quota: number
  monthly_kb_doc_quota: number
  current_month: string
  used_broadcast: number
  used_chat: number
  used_vision: number
  used_imagegen: number
  used_kb_doc: number
  overage_charge_yen: number
  monthly_budget_cap_yen: number | null
  alert_threshold_yen: number | null
  auto_fallback_at_limit: number
  /** 営業時に個別決定した月額料金 (運用代行費)。NULL なら未設定 */
  monthly_fee_yen: number | null
  updated_at: string
}

// ---------------------------------------------------------------------------
// API namespaces
// ---------------------------------------------------------------------------

export const aiApi = {
  prompts: {
    list: (accountId: string) =>
      aiFetch<{ success: boolean; modules: PromptModule[]; types: PromptModuleType[] }>(
        '/api/prompts',
        accountId,
      ),
    get: (accountId: string, type: PromptModuleType) =>
      aiFetch<{ success: boolean; module: PromptModule | null; currentVersion: PromptModuleVersion | null }>(
        `/api/prompts/${type}`,
        accountId,
      ),
    save: (accountId: string, type: PromptModuleType, content: string, note?: string) =>
      aiFetch<{ success: boolean; module: PromptModule; version: PromptModuleVersion }>(
        `/api/prompts/${type}`,
        accountId,
        { method: 'PUT', body: JSON.stringify({ content, note }) },
      ),
    draft: (accountId: string, type: PromptModuleType, input?: { industry?: string; existingContent?: string }) =>
      aiFetch<{ success: boolean; content: string; costYen: number; model: string }>(
        `/api/prompts/${type}/draft`,
        accountId,
        { method: 'POST', body: JSON.stringify(input ?? {}) },
      ),
    versions: (accountId: string, type: PromptModuleType) =>
      aiFetch<{ success: boolean; versions: PromptModuleVersion[] }>(
        `/api/prompts/${type}/versions`,
        accountId,
      ),
    revert: (accountId: string, type: PromptModuleType, versionId: string) =>
      aiFetch<{ success: boolean }>(`/api/prompts/${type}/revert/${versionId}`, accountId, {
        method: 'POST',
      }),
    setActive: (accountId: string, type: PromptModuleType, active: boolean) =>
      aiFetch<{ success: boolean }>(`/api/prompts/${type}/active`, accountId, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      }),
    assemblePreview: (accountId: string) =>
      aiFetch<{ success: boolean; systemPrompt: string; usedVersions: Array<{ moduleType: PromptModuleType; versionId: string | null; version: number | null }> }>(
        '/api/prompts/assemble/preview',
        accountId,
      ),
  },

  kb: {
    list: (accountId: string, params?: { sourceType?: KbSourceType; activeOnly?: boolean }) => {
      const q = new URLSearchParams()
      if (params?.sourceType) q.set('source_type', params.sourceType)
      if (params?.activeOnly === false) q.set('active_only', 'false')
      const qs = q.toString()
      return aiFetch<{ success: boolean; documents: KbDocument[] }>(
        `/api/kb/documents${qs ? '?' + qs : ''}`,
        accountId,
      )
    },
    get: (accountId: string, id: string) =>
      aiFetch<{ success: boolean; document: KbDocument }>(`/api/kb/documents/${id}`, accountId),
    create: (
      accountId: string,
      input: {
        source_type: KbSourceType
        title: string
        content: string
        source_url?: string
        metadata?: Record<string, unknown>
      },
    ) =>
      aiFetch<{ success: boolean; document: KbDocument }>('/api/kb/documents', accountId, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (
      accountId: string,
      id: string,
      input: Partial<Omit<KbDocument, 'id' | 'line_account_id' | 'created_at' | 'updated_at'>>,
    ) =>
      aiFetch<{ success: boolean; document: KbDocument }>(`/api/kb/documents/${id}`, accountId, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    delete: (accountId: string, id: string) =>
      aiFetch<{ success: boolean }>(`/api/kb/documents/${id}`, accountId, { method: 'DELETE' }),
  },

  products: {
    list: (accountId: string, params?: { category?: string; q?: string; limit?: number }) => {
      const sp = new URLSearchParams()
      if (params?.category) sp.set('category', params.category)
      if (params?.q) sp.set('q', params.q)
      if (params?.limit) sp.set('limit', String(params.limit))
      const qs = sp.toString()
      return aiFetch<{ success: boolean; products: AiProduct[] }>(
        `/api/ai-products${qs ? '?' + qs : ''}`,
        accountId,
      )
    },
    create: (accountId: string, input: { name: string; description?: string; price_yen?: number; image_url?: string; product_url?: string; category?: string; sku?: string; tags?: string[] }) =>
      aiFetch<{ success: boolean; product: AiProduct }>('/api/ai-products', accountId, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (accountId: string, id: string, input: { name?: string; description?: string; price_yen?: number | null; image_url?: string; product_url?: string; category?: string; sku?: string; tags?: string[] }) =>
      aiFetch<{ success: boolean; product: AiProduct }>(`/api/ai-products/${id}`, accountId, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    delete: (accountId: string, id: string) =>
      aiFetch<{ success: boolean }>(`/api/ai-products/${id}`, accountId, { method: 'DELETE' }),
    parse: (accountId: string, input: { source: 'text' | 'image' | 'url' | 'csv'; text?: string; image_url?: string; url?: string; csv?: string }) =>
      aiFetch<{
        success: boolean
        products: Array<{ name: string; price_yen: number | null; description: string; category: string; sku: string }>
        meta?: { model: string; costYen: number; inputTokens: number; outputTokens: number }
        error?: string
        raw?: string
      }>('/api/ai-products/parse', accountId, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    bulkImport: (accountId: string, products: Array<{ name: string; price_yen?: number | null; description?: string; category?: string; sku?: string; image_url?: string; stock?: number; tags?: string[] }>, skipDuplicates = true) =>
      aiFetch<{
        success: boolean
        summary: { created: number; skipped: number; errors: number }
        errors: Array<{ index: number; reason: string }>
      }>('/api/ai-products/bulk-import', accountId, {
        method: 'POST',
        body: JSON.stringify({ products, skipDuplicates }),
      }),
    shopifyFetch: (accountId: string, input: { shop_domain: string; access_token: string; limit?: number }) =>
      aiFetch<{
        success: boolean
        products: Array<{ name: string; price_yen: number | null; description: string; category: string; sku: string; image_url: string | null; stock?: number; tags: string[] }>
        meta?: { source: string; count: number }
        error?: string
      }>('/api/ai-products/shopify-fetch', accountId, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  signals: {
    summary: (accountId: string) =>
      aiFetch<{
        success: boolean
        rank_counts: Record<string, number>
        avg_purchase_intent: number
        avg_churn_risk: number
        avg_ltv_estimate_yen: number
      }>('/api/ai-signals/summary', accountId),
    hot: (accountId: string, minIntent = 60, limit = 50) =>
      aiFetch<{ success: boolean; items: AiFriendSignal[] }>(
        `/api/ai-signals/hot?min_intent=${minIntent}&limit=${limit}`,
        accountId,
      ),
    byRank: (accountId: string, rank: AiFriendSignal['vip_rank'], limit = 100) =>
      aiFetch<{ success: boolean; items: AiFriendSignal[] }>(
        `/api/ai-signals/rank/${rank}?limit=${limit}`,
        accountId,
      ),
  },

  assistant: {
    execute: (
      accountId: string,
      input: {
        context?: { page?: string; selectedFriendId?: string | null; selectedBroadcastId?: string | null }
        message: string
        history?: Array<{ role: 'user' | 'assistant'; content: string }>
      },
    ) =>
      aiFetch<{
        success: boolean
        text: string
        actions: Array<{ label: string; type: string; payload?: Record<string, unknown> }>
        followUp: string[]
        costYen: number
        model: string
        error?: string
      }>('/api/ai-assistant/execute', accountId, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  chat: {
    respond: (accountId: string, friendId: string, message: string, imageUrl?: string) =>
      aiFetch<{
        success: boolean
        reply: string
        intent: string
        model: string
        cached: boolean
        costYen: number
        kbReferences: string[]
        productSuggestions: Array<{ id: string; name: string; price_yen: number | null; image_url: string | null; product_url: string | null; description: string | null }>
        escalated: boolean
      }>('/api/ai-chat/respond', accountId, {
        method: 'POST',
        body: JSON.stringify({ friend_id: friendId, message, image_url: imageUrl }),
      }),
    preview: (accountId: string, message: string) =>
      aiFetch<{
        success: boolean
        reply: string
        intent: string
        model: string
        costYen: number
        productSuggestions?: Array<{
          id: string
          name: string
          price_yen: number | null
          image_url: string | null
          product_url: string | null
          description: string | null
        }>
      }>('/api/ai-chat/preview', accountId, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    recent: (accountId: string, params?: { limit?: number; rating?: -1 | 0 | 1 }) => {
      const sp = new URLSearchParams()
      if (params?.limit) sp.set('limit', String(params.limit))
      if (params?.rating !== undefined) sp.set('rating', String(params.rating))
      const qs = sp.toString()
      return aiFetch<{
        success: boolean
        items: Array<{
          id: string
          friend_id: string
          message_text: string | null
          intent: string | null
          model_used: string | null
          cost_yen_x100: number | null
          cached_response: number
          escalated: number
          vision_used: number
          quality_rating: number
          quality_note: string | null
          rated_at: string | null
          created_at: string
        }>
      }>(`/api/ai-chat/recent${qs ? '?' + qs : ''}`, accountId)
    },
    rate: (accountId: string, id: string, rating: -1 | 1, note?: string) =>
      aiFetch<{ success: boolean }>(`/api/ai-chat/${id}/rate`, accountId, {
        method: 'POST',
        body: JSON.stringify({ rating, note }),
      }),
    qualitySummary: (accountId: string) =>
      aiFetch<{
        success: boolean
        summary: { total: number; positive: number; negative: number; unrated: number }
      }>('/api/ai-chat/quality-summary', accountId),
  },

  kpi: {
    list: (accountId: string, yearMonth?: string) =>
      aiFetch<{ success: boolean; goals: KpiGoal[]; metrics: KpiMetric[] }>(
        `/api/kpi${yearMonth ? `?year_month=${yearMonth}` : ''}`,
        accountId,
      ),
    upsert: (accountId: string, input: { year_month: string; metric: KpiMetric; target_value: number; notes?: string }) =>
      aiFetch<{ success: boolean; goal: KpiGoal }>('/api/kpi', accountId, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    delete: (accountId: string, id: string) =>
      aiFetch<{ success: boolean }>(`/api/kpi/${id}`, accountId, { method: 'DELETE' }),
    runPlanner: (accountId: string, yearMonth?: string) =>
      aiFetch<{ success: boolean; jobsCreated: number; jobIds: string[]; year_month: string }>(
        '/api/kpi/plan',
        accountId,
        { method: 'POST', body: JSON.stringify({ year_month: yearMonth }) },
      ),
  },

  agentJobs: {
    list: (accountId: string, params?: { status?: AgentJobStatus; jobType?: string; limit?: number }) => {
      const sp = new URLSearchParams()
      if (params?.status) sp.set('status', params.status)
      if (params?.jobType) sp.set('job_type', params.jobType)
      if (params?.limit) sp.set('limit', String(params.limit))
      const qs = sp.toString()
      return aiFetch<{ success: boolean; jobs: AgentJob[] }>(
        `/api/agent-jobs${qs ? '?' + qs : ''}`,
        accountId,
      )
    },
    get: (accountId: string, id: string) =>
      aiFetch<{ success: boolean; job: AgentJob }>(`/api/agent-jobs/${id}`, accountId),
    create: (accountId: string, input: { job_type: string; input?: Record<string, unknown>; scheduled_at?: string }) =>
      aiFetch<{ success: boolean; job: AgentJob }>('/api/agent-jobs', accountId, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    run: (accountId: string, id: string) =>
      aiFetch<{ success: boolean; job: AgentJob; status: string; error?: string }>(
        `/api/agent-jobs/${id}/run`,
        accountId,
        { method: 'POST' },
      ),
    approve: (
      accountId: string,
      id: string,
      notes?: string,
      output_overrides?: Record<string, unknown>,
    ) =>
      aiFetch<{
        success: boolean
        postAction?: {
          ok: boolean
          createdResource?: string
          createdResourceType?: string
          notes?: string
          error?: string
        }
      }>(`/api/agent-jobs/${id}/approve`, accountId, {
        method: 'POST',
        body: JSON.stringify({ notes, output_overrides }),
      }),
    reject: (accountId: string, id: string, notes?: string) =>
      aiFetch<{ success: boolean }>(`/api/agent-jobs/${id}/reject`, accountId, {
        method: 'POST',
        body: JSON.stringify({ notes }),
      }),
    updateOutput: (accountId: string, id: string, output: Record<string, unknown>) =>
      aiFetch<{ success: boolean; job: AgentJob }>(`/api/agent-jobs/${id}/output`, accountId, {
        method: 'PATCH',
        body: JSON.stringify(output),
      }),
    cancel: (accountId: string, id: string) =>
      aiFetch<{ success: boolean }>(`/api/agent-jobs/${id}/cancel`, accountId, { method: 'POST' }),
    executorTick: (accountId: string) =>
      aiFetch<{ success: boolean; picked: number; succeeded: number; reviewQueued: number; failed: number; skipped: number }>(
        '/api/agent-jobs/executor/tick',
        accountId,
        { method: 'POST' },
      ),
    types: (accountId: string) =>
      aiFetch<{ success: boolean; types: string[] }>('/api/agent-jobs/types', accountId),
    dailyStats: (accountId: string, days = 14) =>
      aiFetch<{
        success: boolean
        days: number
        stats: Array<{
          date: string
          total: number
          completed: number
          failed: number
          review: number
          cost_yen_x100: number
        }>
      }>(`/api/agent-jobs/daily-stats?days=${days}`, accountId),
  },

  automationPolicy: {
    get: (accountId: string) =>
      aiFetch<{ success: boolean; policy: AutomationPolicy | null }>('/api/automation-policy', accountId),
    upsert: (accountId: string, input: {
      plan_tier?: 'starter' | 'pro' | 'enterprise';
      monthly_broadcast_count?: number;
      automation_level?: 'careful' | 'standard' | 'aggressive';
      job_overrides?: Record<string, 'auto' | 'review'>;
      notification_channel?: string;
      notification_target?: string;
    }) =>
      aiFetch<{ success: boolean; policy: AutomationPolicy }>('/api/automation-policy', accountId, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
  },

  audit: {
    list: (accountId: string, params?: { result?: 'success' | 'failed' | 'denied'; resourceType?: string; limit?: number }) => {
      const sp = new URLSearchParams()
      if (params?.result) sp.set('result', params.result)
      if (params?.resourceType) sp.set('resource_type', params.resourceType)
      if (params?.limit) sp.set('limit', String(params.limit))
      const qs = sp.toString()
      return aiFetch<{ success: boolean; logs: Array<{ id: string; line_account_id: string | null; staff_id: string | null; action: string; resource_type: string | null; resource_id: string | null; ip_address: string | null; user_agent: string | null; result: string; created_at: string; details_json: string | null }> }>(
        `/api/audit-log${qs ? '?' + qs : ''}`,
        accountId,
      )
    },
  },

  consents: {
    list: (accountId: string, friendId: string) =>
      aiFetch<{ success: boolean; consents: Array<{ id: string; friend_id: string; consent_type: string; granted: number; granted_at: string | null; revoked_at: string | null; created_at: string }> }>(
        `/api/consents/${friendId}`,
        accountId,
      ),
    record: (accountId: string, input: { friend_id: string; consent_type: 'ai_chat_processing' | 'data_storage' | 'marketing_delivery' | 'profile_analysis'; granted: boolean }) =>
      aiFetch<{ success: boolean }>('/api/consents', accountId, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  piiDeletions: {
    list: (accountId: string, status?: 'pending' | 'processing' | 'completed' | 'denied' | 'cancelled') =>
      aiFetch<{ success: boolean; requests: Array<{ id: string; line_account_id: string; friend_id: string | null; requested_at: string; requested_by: string; reason: string | null; status: string; processed_at: string | null }> }>(
        `/api/pii-deletions${status ? `?status=${status}` : ''}`,
        accountId,
      ),
    create: (accountId: string, input: { friend_id?: string; reason?: string }) =>
      aiFetch<{ success: boolean; request: { id: string } }>('/api/pii-deletions', accountId, {
        method: 'POST',
        body: JSON.stringify({ ...input, requested_by: 'staff' }),
      }),
    updateStatus: (accountId: string, id: string, status: 'pending' | 'processing' | 'completed' | 'denied' | 'cancelled') =>
      aiFetch<{ success: boolean }>(`/api/pii-deletions/${id}`, accountId, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
  },

  playbooks: {
    list: (accountId: string) =>
      aiFetch<{ success: boolean; playbooks: Array<{ key: string; label: string; emoji: string; description: string; promptModuleCount: number; kpiCount: number; scenarioCount: number }> }>(
        '/api/playbooks',
        accountId,
      ),
    get: (accountId: string, key: string) =>
      aiFetch<{ success: boolean; playbook: { key: string; label: string; emoji: string; description: string; promptModules: Array<{ type: string; content: string }>; kpis: Array<{ metric: string; recommendedTarget: number; notes: string }>; scenarios: Array<{ name: string; description: string; triggerType: string; steps: Array<{ stepIndex: number; name: string; delayMinutes: number; messageContent: string }> }> } }>(
        `/api/playbooks/${key}`,
        accountId,
      ),
    apply: (accountId: string, key: string, options?: { year_month?: string }) =>
      aiFetch<{ success: boolean; playbook: { key: string; label: string }; promptsApplied: number; kpisApplied: number; scenariosApplied: number; scenariosSkipped: number; errors: string[] }>(
        `/api/playbooks/${key}/apply`,
        accountId,
        { method: 'POST', body: JSON.stringify(options ?? {}) },
      ),
    suggest: (accountId: string) =>
      aiFetch<{
        success: boolean
        suggestion: {
          suggestedKey: string
          label: string
          emoji: string
          confidence: 'high' | 'medium' | 'low'
          reasoning: string
        }
        costYen?: number
      }>('/api/playbooks/suggest', accountId, { method: 'POST', body: '{}' }),
  },

  agencyExamples: {
    list: (params?: {
      industry?: string
      broadcast_type?: string
      time_of_day?: string
      q?: string
      limit?: number
      offset?: number
      include_private?: boolean
    }) => {
      const sp = new URLSearchParams()
      if (params?.industry) sp.set('industry', params.industry)
      if (params?.broadcast_type) sp.set('broadcast_type', params.broadcast_type)
      if (params?.time_of_day) sp.set('time_of_day', params.time_of_day)
      if (params?.q) sp.set('q', params.q)
      if (params?.limit) sp.set('limit', String(params.limit))
      if (params?.offset) sp.set('offset', String(params.offset))
      if (params?.include_private) sp.set('include_private', '1')
      const qs = sp.toString()
      // accountId はサーバ側で必須でないが、ai-fetch は header に必要なので一つ送る
      return aiFetch<{
        success: boolean
        examples: AgencyExample[]
        total: number
      }>(`/api/agency-examples${qs ? '?' + qs : ''}`, 'global')
    },
    get: (id: string) =>
      aiFetch<{ success: boolean; example: AgencyExample }>(`/api/agency-examples/${id}`, 'global'),
    create: (input: AgencyExampleInput) =>
      aiFetch<{ success: boolean; example: AgencyExample }>('/api/agency-examples', 'global', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, input: Partial<AgencyExampleInput>) =>
      aiFetch<{ success: boolean; example: AgencyExample }>(`/api/agency-examples/${id}`, 'global', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    delete: (id: string) =>
      aiFetch<{ success: boolean }>(`/api/agency-examples/${id}`, 'global', { method: 'DELETE' }),
    parse: (input: { source: 'text' | 'image' | 'url'; text?: string; image_url?: string; url?: string }) =>
      aiFetch<{
        success: boolean
        parsed: {
          industry: string | null
          broadcast_type: string | null
          time_of_day: string | null
          weekday: string | null
          season: string | null
          title: string | null
          content: string
          tags: string[]
          notes: string | null
        }
        meta?: { model: string; costYen: number; inputTokens: number; outputTokens: number }
        error?: string
      }>('/api/agency-examples/parse', 'global', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    uploadImage: (input: { data: string; content_type?: string }) =>
      aiFetch<{ success: boolean; image_url: string; r2_key: string }>(
        '/api/agency-examples/upload-image',
        'global',
        { method: 'POST', body: JSON.stringify(input) },
      ),
  },

  metering: {
    current: (accountId: string) =>
      aiFetch<{ success: boolean; metering: TenantMetering | null; derived?: Record<string, unknown> }>(
        '/api/metering',
        accountId,
      ),
    init: (accountId: string, plan: TenantMetering['plan']) =>
      aiFetch<{ success: boolean; metering: TenantMetering }>('/api/metering/init', accountId, {
        method: 'POST',
        body: JSON.stringify({ plan }),
      }),
    update: (
      accountId: string,
      input: {
        monthly_fee_yen?: number | null
        monthly_broadcast_quota?: number
        monthly_chat_quota?: number
        monthly_vision_quota?: number
        monthly_imagegen_quota?: number
        monthly_kb_doc_quota?: number
        monthly_budget_cap_yen?: number | null
      },
    ) =>
      aiFetch<{ success: boolean; metering: TenantMetering }>('/api/metering', accountId, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    usage: (accountId: string, yearMonth?: string) =>
      aiFetch<{ success: boolean; year_month: string; summary: Record<string, unknown> }>(
        `/api/metering/usage${yearMonth ? `?year_month=${yearMonth}` : ''}`,
        accountId,
      ),
  },
}
