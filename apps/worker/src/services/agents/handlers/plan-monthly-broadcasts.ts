/**
 * 月初配信戦略プランナー (Big Move 1)
 *
 * KPI Planner から呼ばれて、月の配信本数 (例: 8 本) に対して
 * 「何を / 誰に / いつ / どんな種別で」配信するかを AI で戦略的に決定する。
 *
 * 入力:
 *   - yearMonth: "2026-05"
 *   - totalCount: 月の配信本数 (例: 8)
 *   - industry: テナント業種 (任意、業界推測されていれば)
 *
 * 出力 JSON (post-action で各 plan を generate_broadcast ジョブに展開):
 *   {
 *     monthTheme: "...",
 *     broadcasts: [
 *       { slot, broadcastType, topic, targetSegment, scheduledDate, scheduledHour, rationale },
 *       ...
 *     ]
 *   }
 *
 * AI には下記を context として渡す:
 *   - 業界別運用代行ノウハウ (agency-playbook)
 *   - 前月の broadcast_insights (開封率・CV) サマリ
 *   - 現在の友だちセグメント分布 (tag・signal 集計)
 *   - 該当月の祝日・季節イベント (簡易マッピング)
 */

import {
  assembleSystemPrompt,
  listRecentLearningNotes,
  formatLearningContextText,
  type AgencyIndustry,
} from '@line-crm/db';
import { callClaude, type ClaudeSystemBlock } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import { buildAgencyPlaybookText } from '../../agency-playbook/index.js';
import type { JobContext, JobResult } from '../types.js';

const VALID_INDUSTRIES = ['beauty', 'chiropractic', 'ecommerce', 'school', 'legal', 'other'] as const;

const PLAN_SYSTEM = `あなたは LINE 公式アカウント運用代行のチーフプランナーです。
クライアントの月の配信本数 (例: 8 本) を受け取り、業界・前月成績・友だちセグメントを踏まえて
「月全体の配信戦略」を立てる役割。

【L-port で配信できる "メッセージ表現スタイル" — フルに使い分けること】
LINE の配信は単なるテキストだけではなく、以下の表現で訴求できる:
  - text             : 短文テキストのみ。リマインダー / お礼 / 軽い近況に最適
  - text_image       : テキスト + 1 枚画像。雰囲気訴求 / シーズン挨拶
  - flex_single      : Flex バブル 1 枚 (hero 画像 + タイトル + 価格 + CTA ボタン)。
                       新商品 / 1 オファー / イベント告知 / 1 メニュー紹介に最適
  - flex_carousel    : Flex カルーセル (商品/メニュー/事例を最大 12 枚並べる)。
                       新作ラインナップ / メニュー一覧 / before-after / お店紹介に最適
  - coupon           : クーポン Flex (割引券 + 「使う」ボタン → LIFF で消し込み)。
                       期間限定割引 / 友だち追加特典 / 誕生月特典に最適
  - card_message     : カード型メッセージ (公式 LINE カード Flex)。location / person / product。
                       店舗複数 / スタッフ紹介 / 商品ライナップに最適

→ 1 ヶ月 8 本なら、text 系 3-4 本、flex 系 3-4 本、coupon 1 本くらいが理想バランス。
   全部テキストは絶対 NG (LINE 配信の魅力を活かせない)。

【出力 JSON】
{
  "monthTheme": "今月の戦略テーマ (50 字以内、例: '母の日 + 初夏のスキンケア訴求')",
  "broadcasts": [
    {
      "slot": 1,
      "broadcastType": "campaign" | "reminder" | "newsletter" | "event" | "limited_offer" | "aftercare" | "welcome" | "reactivation",
      "messageStyle": "text" | "text_image" | "flex_single" | "flex_carousel" | "coupon" | "card_message",
      "topic": "配信テーマ (30 字以内、例: '母の日キャンペーン告知')",
      "targetSegment": "対象セグメント (例: 'all' / 'tag:VIP' / 'signal:warm' / 'signal:dormant')",
      "scheduledDate": "YYYY-MM-DD (日付のみ)",
      "scheduledHour": 7-22 の整数 (JST、例: 19),
      "rationale": "この配信を選んだ理由 + なぜこの messageStyle か (80 字以内)",
      "imageNeeded": true | false (= この配信に画像を付けるか、後述の指示に従う)
    },
    ...
  ]
}

【戦略立案ルール】
- 配信種別を分散させる: 1 ヶ月のうち キャンペーン 2-3 / リマインダー 2-3 / ニュースレター 1-2 / イベント 0-1
  / 限定オファー 0-1 / ウェルカム 0-1 (新規友だち向け、月初 1 本) / アフターケア 0-1 / 休眠掘り起こし 0-1
- messageStyle も毎本変える: 全部 text にしない。少なくとも 1 本は flex_carousel か coupon を入れる
  (リッチな表現で開封率/反応率が大きく上がる)
- broadcastType × messageStyle の推奨マッピング:
    campaign       → flex_single / flex_carousel / coupon
    limited_offer  → coupon (必須) / flex_single
    newsletter     → text / text_image
    reminder       → text
    event          → flex_single (hero 画像必須)
    welcome        → flex_single (商品紹介を兼ねる) or card_message
    aftercare      → text_image (ケア手順を画像で)
    reactivation   → coupon (戻ってきてもらう動機作り) / flex_carousel
- 業界の季節性を反映 (美容なら母の日・卒入学・夏紫外線等、整体なら花粉・梅雨頭痛等)
- 配信間隔は 3-5 日空ける (連投ブロック対策)
- 配信時刻は業界の golden time (timing playbook 参照、美容なら平日昼休み or 木金夜)
- ターゲットセグメントは「全員」だけでなく、segment 別に最低 1-2 本入れる
- 前月開封率が低い時間帯 / 種別を避ける
- 前月開封率が高い種別を週ピーク (金曜) に配置

JSON のみを出力 (前後の説明文を付けない)。`;

interface PlannerOutput {
  monthTheme?: string;
  broadcasts?: Array<{
    slot?: number;
    broadcastType?: string;
    messageStyle?: string;
    topic?: string;
    targetSegment?: string;
    scheduledDate?: string;
    scheduledHour?: number;
    rationale?: string;
    imageNeeded?: boolean;
  }>;
}

export async function handlePlanMonthlyBroadcasts(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as {
    yearMonth?: string;
    totalCount?: number;
    industry?: string;
    hint?: string;
    referenceImageDataUrl?: string;
    imageGenCount?: number;
  };
  const yearMonth = input.yearMonth ?? new Date().toISOString().slice(0, 7);
  const totalCount = Math.min(Math.max(input.totalCount ?? 8, 1), 30);
  const imageGenCount = Math.min(Math.max(input.imageGenCount ?? 0, 0), totalCount);
  const industry = (VALID_INDUSTRIES as readonly string[]).includes(input.industry ?? '')
    ? (input.industry as AgencyIndustry)
    : undefined;

  // ブランド設定 (テナント prompt_modules)
  const { systemPrompt: brandSystemPrompt } = await assembleSystemPrompt(db, lineAccountId);

  // 運用代行ノウハウ (業界別 Markdown)
  const playbookText = buildAgencyPlaybookText(industry);

  // 前月の broadcast_insights 集計
  const prevMonth = previousMonth(yearMonth);
  interface InsightRow {
    message_type: string | null;
    title: string | null;
    created_at: string;
    delivered: number | null;
    open_rate: number | null;
    click_rate: number | null;
  }
  const insightsRaw = await db
    .prepare(
      `SELECT b.message_type, b.title, b.created_at, bi.delivered, bi.open_rate, bi.click_rate
         FROM broadcasts b
         LEFT JOIN broadcast_insights bi ON bi.broadcast_id = b.id
        WHERE substr(b.created_at, 1, 7) = ?
        ORDER BY bi.open_rate DESC LIMIT 30`,
    )
    .bind(prevMonth)
    .all<InsightRow>()
    .catch(() => ({ results: [] as InsightRow[] }));

  // 友だちセグメント分布 (tag 件数 / signal vip_rank 件数)
  const [tagDist, signalDist, totalFriends] = await Promise.all([
    db
      .prepare(
        `SELECT t.name AS name, COUNT(ft.friend_id) AS c
           FROM tags t
           LEFT JOIN friend_tags ft ON ft.tag_id = t.id
           LEFT JOIN friends f ON f.id = ft.friend_id AND f.line_account_id = ?
          WHERE f.id IS NOT NULL
          GROUP BY t.id
          ORDER BY c DESC LIMIT 10`,
      )
      .bind(lineAccountId)
      .all<{ name: string; c: number }>()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT vip_rank, COUNT(*) AS c
           FROM ai_friend_signals
          WHERE line_account_id = ?
          GROUP BY vip_rank`,
      )
      .bind(lineAccountId)
      .all<{ vip_rank: string | null; c: number }>()
      .catch(() => ({ results: [] })),
    db
      .prepare(`SELECT COUNT(*) AS c FROM friends WHERE line_account_id = ?`)
      .bind(lineAccountId)
      .first<{ c: number }>()
      .catch(() => ({ c: 0 })),
  ]);

  const segmentSnapshot = {
    totalFriends: totalFriends?.c ?? 0,
    tagDistribution: tagDist.results.slice(0, 10),
    vipRankDistribution: signalDist.results,
  };

  const insightsSummary = insightsRaw.results.slice(0, 10).map((r) => ({
    title: r.title,
    type: r.message_type,
    openRate: r.open_rate,
    clickRate: r.click_rate,
    deliveredAt: r.created_at?.slice(0, 10),
  }));

  // Big Move 5: テナント固有の学習ノート
  let learningText = '';
  try {
    const notes = await listRecentLearningNotes(db, lineAccountId, 2);
    learningText = formatLearningContextText(notes);
  } catch {
    /* ignore */
  }

  // system は 2-3 ブロック (cache 対象)
  const systemBlocks: ClaudeSystemBlock[] = [
    {
      type: 'text',
      text: `【運用代行ノウハウ (業界別)】\n\n${playbookText}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `${brandSystemPrompt}\n\n---\n\n${PLAN_SYSTEM}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (learningText) {
    systemBlocks.push({
      type: 'text',
      text: learningText,
      cache_control: { type: 'ephemeral' },
    });
  }

  const imageInstruction =
    imageGenCount > 0
      ? `\n【画像生成の指示】\n運営者の指定により、${totalCount} 本のうち ${imageGenCount} 本に画像を付けます (gpt-image-2 で生成)。\n視覚効果が高い種別 (campaign / limited_offer / event / aftercare 等) や、写真があると訴求力が増す配信を ${imageGenCount} 本選び、その broadcasts[i].imageNeeded = true としてください。\n残りは imageNeeded = false。合計の true 件数は必ず ${imageGenCount} 本ちょうどにしてください。`
      : `\n【画像生成の指示】\n今月は画像生成なし。全配信について imageNeeded = false で返してください。`;

  const hintBlock = input.hint
    ? `\n【顧客 / 運営者からの追加ヒント】\n${input.hint}\n上記の依頼を最優先で戦略に反映してください (テーマ・配信タイミング・ターゲット等)。`
    : '';

  const imageContextNote = input.referenceImageDataUrl
    ? `\n【参考画像】\n運営者から参考画像が添付されています (別途 user content として渡されます)。\nこの画像のテイスト・商品・雰囲気を読み取り、月のテーマや配信トピックに織り込んでください。`
    : '';

  const userText = `今月 ${yearMonth} の配信戦略を立ててください。
配信本数: ${totalCount} 本
業界: ${industry ?? '不明'}
${imageInstruction}
${hintBlock}
${imageContextNote}

【前月 ${prevMonth} の配信実績 (上位 10 件、開封率順)】
${insightsSummary.length > 0 ? JSON.stringify(insightsSummary, null, 2) : '(実績なし)'}

【現在の友だちセグメント分布】
${JSON.stringify(segmentSnapshot, null, 2)}

【今月の主要イベント (簡易)】
${getMonthlyEvents(yearMonth)}

業界の季節性・前月実績・セグメント特性を踏まえて、${totalCount} 本の配信プランを JSON で返してください。`;

  // 参考画像があれば multimodal で user に投げる
  const imagePart = parseImageDataUrl(input.referenceImageDataUrl);
  const userContent = imagePart
    ? [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: imagePart.mediaType,
            data: imagePart.base64,
          },
        },
        { type: 'text' as const, text: userText },
      ]
    : userText;

  const result = await callClaude({
    apiKey,
    model: 'claude-sonnet-4-6',
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 2500,
    temperature: 0.6,
  });

  await recordUsage(db, {
    lineAccountId,
    feature: 'batch_analysis',
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
  });

  let parsed: PlannerOutput = {};
  try {
    const m = result.text.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]) as PlannerOutput;
  } catch {
    /* fallback below */
  }

  const VALID_STYLES = ['text', 'text_image', 'flex_single', 'flex_carousel', 'coupon', 'card_message'] as const;
  // バリデーション & デフォルト補完
  let validBroadcasts = Array.isArray(parsed.broadcasts)
    ? parsed.broadcasts.slice(0, totalCount).map((b, i) => {
        const style = typeof b.messageStyle === 'string' && (VALID_STYLES as readonly string[]).includes(b.messageStyle)
          ? b.messageStyle
          : 'text';
        return {
          slot: typeof b.slot === 'number' ? b.slot : i + 1,
          broadcastType: typeof b.broadcastType === 'string' ? b.broadcastType : 'newsletter',
          messageStyle: style,
          topic: typeof b.topic === 'string' ? b.topic : `配信 ${i + 1}`,
          targetSegment: typeof b.targetSegment === 'string' ? b.targetSegment : 'all',
          scheduledDate: typeof b.scheduledDate === 'string' ? b.scheduledDate : null,
          scheduledHour: typeof b.scheduledHour === 'number' ? b.scheduledHour : 19,
          rationale: typeof b.rationale === 'string' ? b.rationale : '',
          // messageStyle が flex/coupon/card 系なら画像必要としてマーク
          imageNeeded: typeof b.imageNeeded === 'boolean'
            ? b.imageNeeded
            : ['text_image', 'flex_single', 'flex_carousel', 'coupon', 'card_message'].includes(style),
        };
      })
    : [];

  // 運営者の指定本数 (imageGenCount) を厳格に守る:
  // - 真の本数を数えて、多すぎたら priority タイプ以外から false に
  // - 少なすぎたら priority タイプから補完
  validBroadcasts = enforceImageGenCount(validBroadcasts, imageGenCount);

  return {
    output: {
      monthTheme: parsed.monthTheme ?? '(月テーマ未生成)',
      yearMonth,
      totalCount,
      industry,
      broadcasts: validBroadcasts,
      meta: {
        prevMonthInsightsCount: insightsRaw.results.length,
        segmentSnapshot,
      },
      generatedAt: new Date().toISOString(),
    },
    costYenX100: result.costYenX100,
    forceStatus: 'completed', // post-action で各 generate_broadcast ジョブを enqueue
  };
}

function previousMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthlyEvents(yearMonth: string): string {
  const [, m] = yearMonth.split('-').map(Number);
  const events: Record<number, string> = {
    1: '元旦・成人の日・センター試験',
    2: '節分・バレンタインデー',
    3: 'ホワイトデー・卒業式・年度末',
    4: '新生活・入学・お花見',
    5: 'GW・母の日・運動会',
    6: '梅雨・父の日・ジューンブライド',
    7: '夏休み・七夕・海開き',
    8: 'お盆・夏祭り・夏期休業',
    9: 'シルバーウィーク・敬老の日・秋分',
    10: 'ハロウィン・スポーツの日',
    11: '七五三・勤労感謝の日',
    12: 'クリスマス・年末・大晦日',
  };
  return events[m] ?? '通常月';
}

/** data:image/png;base64,xxx... を mediaType + base64 に分解 */
function parseImageDataUrl(
  dataUrl: string | undefined,
): { mediaType: string; base64: string } | null {
  if (!dataUrl) return null;
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

/** 視覚効果が高い種別の優先順 (画像が活きやすい配信種別から) */
const IMAGE_PRIORITY_TYPES = [
  'limited_offer',
  'campaign',
  'event',
  'aftercare',
  'welcome',
  'newsletter',
  'reactivation',
  'reminder',
];

/**
 * imageGenCount で指定された本数になるよう broadcasts[i].imageNeeded を補正。
 * 多すぎる場合は優先度の低い種別から false に、少なすぎる場合は優先度の高い種別から true に。
 */
function enforceImageGenCount<
  T extends { broadcastType: string; imageNeeded: boolean },
>(items: T[], targetCount: number): T[] {
  const current = items.filter((i) => i.imageNeeded).length;
  if (current === targetCount) return items;

  const priority = (t: string) => {
    const idx = IMAGE_PRIORITY_TYPES.indexOf(t);
    return idx === -1 ? IMAGE_PRIORITY_TYPES.length : idx;
  };

  if (current > targetCount) {
    // 多すぎ: imageNeeded=true のうち優先度の低い順に false へ
    const indexed = items
      .map((b, i) => ({ i, b, prio: priority(b.broadcastType) }))
      .filter((x) => x.b.imageNeeded)
      .sort((a, b) => b.prio - a.prio); // 低い優先度 = 後ろのインデックスから先に外す
    const toFlip = current - targetCount;
    for (let n = 0; n < toFlip; n++) {
      items[indexed[n].i] = { ...indexed[n].b, imageNeeded: false };
    }
  } else {
    // 少なすぎ: imageNeeded=false のうち優先度の高い順に true へ
    const indexed = items
      .map((b, i) => ({ i, b, prio: priority(b.broadcastType) }))
      .filter((x) => !x.b.imageNeeded)
      .sort((a, b) => a.prio - b.prio);
    const toFlip = targetCount - current;
    for (let n = 0; n < Math.min(toFlip, indexed.length); n++) {
      items[indexed[n].i] = { ...indexed[n].b, imageNeeded: true };
    }
  }
  return items;
}
