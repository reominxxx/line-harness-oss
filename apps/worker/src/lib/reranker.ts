/**
 * Jina AI Reranker v2 (multilingual)
 *
 * KB / 商品検索の候補集合を、クエリに対する関連度で再順位付けする。
 * 単純なキーワード LIKE 検索だと "毛穴洗浄" の質問に "毛穴" だけで全文一致した
 * 関係ない章が混じることが多いが、Reranker を通すと意味的に近い順に並び替わる。
 *
 * 採用理由 (Jina Reranker v2 base multilingual):
 *   - 日本語性能が Cohere / Voyage より優位 (多言語特化)
 *   - 価格: $0.018 / 1M tokens (Cohere の半額以下) + 1M tokens 無料枠
 *   - API レイテンシ ~150ms
 *   - JINA_API_KEY 未設定時は no-op (上位 limit 件を順序維持で返す = 既存挙動)
 *
 * Docs: https://api.jina.ai/redoc#tag/rerank
 */

import { jstNow } from '@line-crm/db';

const JINA_RERANK_ENDPOINT = 'https://api.jina.ai/v1/rerank';
const DEFAULT_MODEL = 'jina-reranker-v2-base-multilingual';

export interface RerankableDocument {
  /** 任意の安定識別子 */
  id: string;
  /** Reranker に渡すテキスト (タイトル + 本文を結合した形が推奨) */
  text: string;
}

export interface RerankResult<T extends RerankableDocument> {
  document: T;
  /** 0.0〜1.0 の関連度スコア (Jina は 0-1 範囲) */
  score: number;
}

export interface RerankOptions {
  /** API key 未設定時の fallback 限度 (元順序で先頭から N 件返す) */
  fallbackLimit?: number;
  /** Reranker に渡す上限。Jina は 1 リクエスト 1000 docs まで */
  maxDocs?: number;
}

/**
 * documents を query との関連度で並び替えて top-K 件返す。
 * JINA_API_KEY が無い / リクエストが失敗した場合は元の順序の先頭 fallbackLimit 件を返す。
 */
export async function rerank<T extends RerankableDocument>(
  apiKey: string | undefined,
  query: string,
  documents: T[],
  topK: number,
  options: RerankOptions = {},
): Promise<RerankResult<T>[]> {
  const fallback = options.fallbackLimit ?? topK;
  if (!apiKey || documents.length === 0) {
    return documents.slice(0, fallback).map((d) => ({ document: d, score: 0 }));
  }

  const maxDocs = options.maxDocs ?? 1000;
  const trimmed = documents.slice(0, maxDocs);

  try {
    const res = await fetch(JINA_RERANK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        query,
        documents: trimmed.map((d) => d.text),
        top_n: Math.min(topK, trimmed.length),
        return_documents: false,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[reranker] Jina API ${res.status}: ${errText.slice(0, 200)} — falling back to original order`);
      return trimmed.slice(0, fallback).map((d) => ({ document: d, score: 0 }));
    }
    const json = (await res.json()) as {
      results?: Array<{ index: number; relevance_score: number }>;
    };
    if (!json.results) {
      console.warn('[reranker] Jina API returned no results — falling back');
      return trimmed.slice(0, fallback).map((d) => ({ document: d, score: 0 }));
    }
    return json.results
      .filter((r) => trimmed[r.index] !== undefined)
      .map((r) => ({ document: trimmed[r.index], score: r.relevance_score }));
  } catch (e) {
    console.warn('[reranker] Jina fetch failed:', e);
    return trimmed.slice(0, fallback).map((d) => ({ document: d, score: 0 }));
  }
}

/** 使用ログ書き込み補助 (cost を ai_usage_log に積みたい時) */
export function estimateRerankCostYenX100(numDocs: number, avgTokensPerDoc: number, queryTokens: number): number {
  // Jina Reranker v2: $0.018 / 1M tokens (input = query + docs)
  // 1 USD = 150 円換算で 150*0.018 = 2.7 円/1Mtok
  // x100 単位の整数なので 270 / 1Mtok
  const totalTokens = queryTokens + numDocs * avgTokensPerDoc;
  return Math.ceil((totalTokens / 1_000_000) * 270);
}

void jstNow;
