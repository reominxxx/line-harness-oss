/**
 * リッチメニュー画像の AI 生成エンドポイント
 *
 * POST /api/rich-menu-images/generate
 *   body:
 *     - prompt: string                   ユーザー入力プロンプト
 *     - size: 'large' | 'compact'        リッチメニューサイズ
 *     - variationIndex?: number          バリエーション # (0-based)
 *     - totalCount?: number              総生成枚数（VARIATION_HINTS を入れる時用）
 *     - revisionRequest?: string         修正依頼文
 *     - previousImageBase64?: string     修正対象の元画像 (revisionRequest と一緒に渡す)
 *     - defaultsText?: string            スタイルガイド (毎回入れたい訴求)
 *     - template?: 'cv_rich_menu'        CV 特化リッチメニューのマスタープロンプトを使う
 *     - menuItems?: Array<{name, subcopy}> 各タイルに描画する文言 (template=cv_rich_menu 時)
 *     - brandContext?: string            参考 HP から読み取ったブランド情報 (template=cv_rich_menu 時)
 *   resp: { success: true, imageBase64: string, mimeType: string }
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const richMenuImagesAi = new Hono<Env & { Bindings: { OPENAI_API_KEY?: string } }>();

// 画像生成の「用途」。用途ごとに最適なプロンプト座組みを切り替える。
type ImagePurpose =
  | 'rich_menu'
  | 'coupon'
  | 'card_message'
  | 'broadcast'
  | 'event'
  | 'scenario'
  | 'template';

const VALID_PURPOSES: ImagePurpose[] = [
  'rich_menu',
  'coupon',
  'card_message',
  'broadcast',
  'event',
  'scenario',
  'template',
];

// rich_menu 以外の用途ごとの作り込みルール。
// 「クーポンにはクーポンの座組み」を実現するための要。
const PURPOSE_RULES: Record<Exclude<ImagePurpose, 'rich_menu'>, { intent: string; rules: string }> = {
  coupon: {
    intent: 'LINE で配布するクーポンのビジュアル。「お得感」と「今すぐ使いたい」という気持ちの喚起が最優先。',
    rules: `- 中央に大きめの余白を確保し、後から「〇〇%OFF」「無料」などの特典テキストを重ねられる空間を残す
- 割引・特典を象徴するモチーフ（リボン、チケットの切り取り線、ギフト、スタンプ風の丸枠など）を上品に効かせる
- 高揚感のある配色で訴求するが、安っぽいセール感は避け、ブランドの世界観は保つ
- クーポンの対象（商品・メニュー・店内）が一目で伝わる魅力的な被写体`,
  },
  card_message: {
    intent: 'LINE のカードタイプメッセージ（Flex）のヒーロー画像。トーク内で角丸カードとして表示される。',
    rules: `- カード上部のヒーロー画像として成立する構図。下に見出し・説明・ボタンが続く前提で、画像内に文字は入れない
- 主役の被写体を中央に大きく配置し、背景はシンプルにして主役を立たせる
- 角丸表示でも破綻しないよう、四隅に重要要素を置かない
- 1 枚で世界観が伝わる、雑誌の表紙のような完成度`,
  },
  broadcast: {
    intent: 'LINE 一斉配信／セグメント配信のクリエイティブ。トーク一覧で目を留めさせ、開封・タップを促す。',
    rules: `- スクロール中の指を止めさせるインパクト。第一印象で「自分ゴト」と感じさせる
- 主役（商品・サービス・オファー）を中央〜やや上に、余白を残して配置
- 文字は入れない（キャッチコピーは配信本文側で訴求する）。画像は世界観づくりに専念
- 配色はブランド準拠で 2〜3 色。清潔感と上質感を優先`,
  },
  event: {
    intent: 'イベント／キャンペーンの告知ビジュアル。非日常感・限定感・参加したい気持ちを演出する。',
    rules: `- イベントの非日常感・限定感を演出。背景に華やかさや季節感を持たせてよい
- 後から「日時」「会場」「参加特典」などを重ねられる余白を確保
- イベント内容や会場の雰囲気が一目で伝わる構図
- ワクワク感のある配色。ただしブランドの世界観は崩さない`,
  },
  scenario: {
    intent: 'ステップ配信（シナリオ）1 通分のクリエイティブ。読者との関係構築・育成を意識する。',
    rules: `- 押し売り感を抑え、読み手に寄り添う温度感。シナリオの文脈に自然になじむビジュアル
- 主役を中央に、余白を残して配置。文字は入れない
- 配色はブランド準拠で 2〜3 色。一貫した世界観でシリーズ感を出す`,
  },
  template: {
    intent: '再利用するメッセージテンプレートのクリエイティブ。汎用的に使い回せる完成度を重視する。',
    rules: `- 特定の日付・特典に依存しない、汎用的に使える構図
- 主役を中央に、余白を残して配置。文字は入れない
- 配色はブランド準拠で 2〜3 色。清潔感と上質感を優先`,
  },
};

function purposeBlock(purpose: ImagePurpose): string {
  if (purpose === 'rich_menu') return '';
  const rule = PURPOSE_RULES[purpose];
  if (!rule) return '';
  return `\n【この画像の用途と狙い】\n${rule.intent}\n\n【用途別の作り込みルール（必ず守る）】\n${rule.rules}\n`;
}

function brandBlock(brandContext: string): string {
  return brandContext ? `\n【参考リンクから読み取ったブランド・お店の情報】\n${brandContext}\n` : '';
}

const VARIATION_HINTS = [
  'シンプル・ミニマルで余白を活かしたレイアウト。洗練されたスペースの使い方を意識する',
  'ビビッドなカラーとインパクト重視の大胆な構成。視線を一瞬でつかむデザイン',
  'ナチュラルで温かみのある雰囲気。柔らかいトーンと自然素材感のあるデザイン',
  'ダークトーンで高級感・上質感を演出。黒や深いネイビーを基調とした洗練されたデザイン',
  'パステルカラーで柔らかく親しみやすい印象。明るく爽やかなデザイン',
  '幾何学的なシェイプを活用したモダンなデザイン。直線や円を効果的に使用',
  'グラデーション背景を活用した洗練されたデザイン。色の移り変わりが印象的',
  'ポップでカジュアル、幅広い層に親しみやすいデザイン。カラフルで明るい雰囲気',
];

// CV 特化リッチメニューの初期文言 (フロントの 6 枠と一致させる)
const DEFAULT_CV_MENU_ITEMS: Array<{ name: string; subcopy: string }> = [
  { name: '無料診断', subcopy: 'LINE改善ポイントがわかる' },
  { name: '料金プラン', subcopy: '月額・内容を見る' },
  { name: '実績を見る', subcopy: '改善事例を確認' },
  { name: '無料相談', subcopy: 'まずは相談する' },
  { name: 'サービス資料', subcopy: '詳しい内容をDL' },
  { name: 'よくある質問', subcopy: '不安を解消' },
];

richMenuImagesAi.post('/api/rich-menu-images/generate', async (c) => {
  const apiKey = c.env.OPENAI_API_KEY;
  if (!apiKey) {
    return c.json(
      { success: false, error: 'OPENAI_API_KEY が未設定です。管理者にお問い合わせください。' },
      503,
    );
  }

  const body = await c.req.json<{
    prompt?: string;
    size?: 'large' | 'compact' | 'square' | 'landscape' | 'portrait' | 'banner_wide';
    variationIndex?: number;
    totalCount?: number;
    revisionRequest?: string;
    previousImageBase64?: string;
    referenceImageBase64?: string;
    defaultsText?: string;
    template?: 'cv_rich_menu';
    menuItems?: Array<{ name?: string; subcopy?: string }>;
    brandContext?: string;
    purpose?: ImagePurpose;
  }>();
  const prompt = (body.prompt ?? '').trim();
  const size = body.size ?? 'large';
  const variationIndex = typeof body.variationIndex === 'number' ? body.variationIndex : undefined;
  const totalCount = typeof body.totalCount === 'number' ? body.totalCount : undefined;
  const revisionRequest = (body.revisionRequest ?? '').trim();
  const previousImageBase64 = body.previousImageBase64 ?? '';
  const referenceImageBase64 = body.referenceImageBase64 ?? '';
  const defaultsText = (body.defaultsText ?? '').trim();
  const cvTemplate = body.template === 'cv_rich_menu';
  const menuItems = Array.isArray(body.menuItems)
    ? body.menuItems
        .map((it) => ({ name: (it?.name ?? '').trim(), subcopy: (it?.subcopy ?? '').trim() }))
        .filter((it) => it.name)
    : [];
  const brandContext = (body.brandContext ?? '').trim();
  const purpose: ImagePurpose = VALID_PURPOSES.includes(body.purpose as ImagePurpose)
    ? (body.purpose as ImagePurpose)
    : 'rich_menu';

  if (!prompt && !revisionRequest && !cvTemplate) {
    return c.json({ success: false, error: 'prompt or revisionRequest is required' }, 400);
  }
  if (prompt.length > 4000 || revisionRequest.length > 4000) {
    return c.json({ success: false, error: 'prompt too long (max 4000 chars)' }, 400);
  }

  // gpt-image-2 対応サイズ: 1024x1024 / 1024x1536 / 1536x1024
  // size 種別ごとにマッピング:
  //   - large / compact / landscape / banner_wide: 横長 (1536x1024)
  //   - square: 正方形 (1024x1024)
  //   - portrait: 縦長 (1024x1536)
  const apiSize: '1024x1024' | '1024x1536' | '1536x1024' =
    size === 'square' ? '1024x1024'
    : size === 'portrait' ? '1024x1536'
    : '1536x1024';

  const hasReference = !revisionRequest && !!referenceImageBase64;
  const fullPrompt = revisionRequest
    ? buildRevisionPrompt(prompt, revisionRequest, defaultsText, size, cvTemplate, purpose, brandContext)
    : cvTemplate
    ? buildCvRichMenuPrompt(menuItems, size, defaultsText, brandContext, variationIndex, totalCount, hasReference)
    : hasReference
    ? buildReferencePrompt(prompt, size, defaultsText, variationIndex, totalCount, purpose, brandContext)
    : buildGenerationPrompt(prompt, size, defaultsText, variationIndex, totalCount, purpose, brandContext);

  try {
    let imageBase64: string;

    if (hasReference) {
      // 参考画像モード: images/edits API で参考画像を踏まえて新規生成
      const formData = new FormData();
      formData.append('model', 'gpt-image-2');
      formData.append('prompt', fullPrompt);
      formData.append('size', apiSize);
      const bin = base64ToUint8Array(referenceImageBase64);
      formData.append('image', new Blob([bin], { type: 'image/png' }), 'reference.png');

      const resp = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[rich-menu-image-ai] OpenAI ref-edit error', resp.status, errText.slice(0, 500));
        return c.json({ success: false, error: parseOpenAiError(errText) }, 502);
      }
      const json = (await resp.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      imageBase64 = await extractBase64(json);
    } else if (revisionRequest && previousImageBase64) {
      // 修正モード: images/edits API
      const formData = new FormData();
      formData.append('model', 'gpt-image-2');
      formData.append('prompt', fullPrompt);
      formData.append('size', apiSize);
      // base64 → Blob → File
      const bin = base64ToUint8Array(previousImageBase64);
      formData.append('image', new Blob([bin], { type: 'image/png' }), 'previous.png');

      const resp = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[rich-menu-image-ai] OpenAI edit error', resp.status, errText.slice(0, 500));
        return c.json({ success: false, error: parseOpenAiError(errText) }, 502);
      }
      const json = (await resp.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      imageBase64 = await extractBase64(json);
    } else {
      // 新規生成
      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt: fullPrompt,
          size: apiSize,
          n: 1,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[rich-menu-image-ai] OpenAI gen error', resp.status, errText.slice(0, 500));
        return c.json({ success: false, error: parseOpenAiError(errText) }, 502);
      }
      const json = (await resp.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      imageBase64 = await extractBase64(json);
    }

    return c.json({ success: true, imageBase64, mimeType: 'image/png' });
  } catch (e) {
    console.error('[rich-menu-image-ai] generate failed:', e);
    return c.json(
      { success: false, error: e instanceof Error ? e.message : 'generate failed' },
      500,
    );
  }
});

type ImageContext = 'rich_menu' | 'broadcast';
function imageContext(size: string): ImageContext {
  return size === 'large' || size === 'compact' ? 'rich_menu' : 'broadcast';
}

function broadcastLayoutHint(size: string): string {
  switch (size) {
    case 'square':
      return '画像は正方形 (1:1)。LINE 配信メッセージ用のクリエイティブ。SNS 投稿風のレイアウト。';
    case 'landscape':
      return '画像は横長 (3:2)。LINE 配信用のヘッダー/告知バナー。';
    case 'banner_wide':
      return '画像はワイド横長 (16:9)。YouTube サムネ風のヘッダー型配信バナー。';
    case 'portrait':
      return '画像は縦長 (2:3)。縦型ポスター/ストーリー風の告知ビジュアル。';
    default:
      return '画像はバナー。LINE 配信用クリエイティブ。';
  }
}

function buildGenerationPrompt(
  userPrompt: string,
  size: 'large' | 'compact' | 'square' | 'landscape' | 'portrait' | 'banner_wide',
  defaultsText: string,
  variationIndex?: number,
  totalCount?: number,
  purpose: ImagePurpose = 'rich_menu',
  brandContext = '',
): string {
  const ctx = imageContext(size);
  const isRichMenu = ctx === 'rich_menu';
  const layout = isRichMenu
    ? (size === 'large'
        ? '画像はアスペクト比 3:2 の横長。LINE リッチメニュー Large (2500×1686) として使う前提。3×2 (6 タイル) または 2×3 のグリッド配置を意識した構成にすること。'
        : '画像は超横長（≒3:1 アスペクト）。LINE リッチメニュー Compact (2500×843) として使う前提。1×3 (3 タイル横並び) のグリッド配置を意識した構成にすること。')
    : broadcastLayoutHint(size);

  const variationHint =
    variationIndex !== undefined && totalCount !== undefined && totalCount > 1
      ? `\n【デザインバリエーション ${variationIndex + 1}/${totalCount}】\n${VARIATION_HINTS[variationIndex % VARIATION_HINTS.length]}\n`
      : '';

  const defaultsBlock = defaultsText
    ? `\n【スタイルガイド（必ず守る）】\n${defaultsText}\n`
    : '';

  const purposeLine = isRichMenu
    ? 'LINE 公式アカウントのリッチメニュー画像を生成してください。'
    : 'LINE 配信用のクリエイティブ画像 (バナー / 告知 / 商品ビジュアル) を生成してください。';

  const richMenuRules = `- 文字は入れない（後でタップ領域に応じてオーバーレイで配置するため）
- グリッドの境界が視覚的に分かるように、各タイルにアイコン的なシンボルを 1 つずつ配置
- 重要な要素を画像端ギリギリに置かない（LINE で表示時に切れる可能性）
- プロフェッショナルで品のあるデザイン、過度な装飾は避ける
- 配色は 2〜3 色に絞り、ブランドの世界観を保つ`;

  const broadcastRules = `- 文字 (キャッチコピー・価格等) は AI が苦手なので極力入れない。テキストは後で別途追加する想定
- 主役の被写体 (商品 / 人物 / モチーフ) を中央〜やや上に置き、余白を残す
- 重要な要素を画像端ギリギリに置かない (LINE トーク内で角丸表示・トリミングされる)
- 配色は 2〜3 色に絞り、ブランドの世界観を統一
- 過度な装飾は避け、清潔感と上質感を優先`;

  return `${purposeLine}
${variationHint}${purposeBlock(purpose)}
【ユーザーからの依頼】
${userPrompt}

【レイアウト要件】
${layout}

【共通ルール】
${isRichMenu ? richMenuRules : broadcastRules}
${brandBlock(brandContext)}${defaultsBlock}`;
}

// CV 特化リッチメニューのマスタープロンプト。
// 文字 (各タイルの見出し+サブコピー) を画像内に正確に描画させる点が通常モードと決定的に違う。
function buildCvRichMenuPrompt(
  menuItems: Array<{ name: string; subcopy: string }>,
  size: 'large' | 'compact' | 'square' | 'landscape' | 'portrait' | 'banner_wide',
  defaultsText: string,
  brandContext: string,
  variationIndex?: number,
  totalCount?: number,
  hasReference?: boolean,
): string {
  const isCompact = size === 'compact';
  const tileCount = isCompact ? 3 : 6;
  const items = (menuItems.length ? menuItems : DEFAULT_CV_MENU_ITEMS).slice(0, tileCount);

  const gridSpec = isCompact
    ? 'アスペクト比 3:1 の超横長 (LINE リッチメニュー Compact・2500×843)。横一列に均等幅で 3 分割した 1×3 グリッド。各セルは完全に同じ幅・高さ。'
    : 'アスペクト比 3:2 の横長 (LINE リッチメニュー Large・2500×1686)。上下 2 段 × 左右 3 列の均等な 6 分割グリッド (3×2)。各セルは完全に同じ大きさで、隣り合うセルとの境界が視覚的に明確。';

  const cells = items
    .map((it, i) => {
      const sub = it.subcopy ? `、サブコピー「${it.subcopy}」` : '';
      return `  ${isCompact ? `${i + 1}番目` : `セル${i + 1}`}: 見出し「${it.name}」${sub}`;
    })
    .join('\n');

  const variationHint =
    variationIndex !== undefined && totalCount !== undefined && totalCount > 1
      ? `\n【デザインのバリエーション ${variationIndex + 1}/${totalCount}】\n${VARIATION_HINTS[variationIndex % VARIATION_HINTS.length]}\n`
      : '';

  const brandBlock = brandContext ? `\n【参考にするブランドの世界観】\n${brandContext}\n` : '';
  const defaultsBlock = defaultsText ? `\n【スタイルガイド（必ず守る）】\n${defaultsText}\n` : '';
  const referenceNote = hasReference
    ? '添付画像の色合い・トーン・雰囲気を参考にしてください（複製・流用はしない）。\n'
    : '';

  return `LINE 公式アカウント用の、コンバージョン（予約・問い合わせ・購入）に最適化したリッチメニュー画像を 1 枚生成してください。
${referenceNote}${variationHint}
【レイアウト要件】
${gridSpec}

【各セルに配置する内容（${tileCount} 個）】
${cells}

【テキスト描画ルール（最重要）】
- 上記の見出し・サブコピーの日本語を、表記を一字一句変えずに正確に描画する。文字化け・誤字・英語化・記号の混入は絶対に不可。
- 文字は大きく、太く、可読性最優先。背景と十分なコントラスト（明暗差）を確保する。
- 見出しはサブコピーより明確に大きく。1 セル内で見出し→サブコピーの視線誘導が成立する配置。
- 余計な文字（ダミーテキスト、英語のキャッチ、ロゴ風文字、価格、URL）は一切入れない。

【デザインルール】
- 各セルに、その行動を表す上品でシンプルなアイコン（線画または面塗りのピクトグラム）を 1 つずつ配置し、見出しと組み合わせる。
- セルごとの境界（区切り線または余白）を明確にし、6 つ（または 3 つ）のタップ領域だと一目で分かる構成にする。
- 配色は 2〜3 色に絞り、ブランドの世界観を統一。清潔感・信頼感・プロフェッショナルな印象を最優先。
- 「無料」「相談」など主要 CV 導線のセルはわずかに強調（色や明度で目立たせる）してよい。
- 重要な要素（文字・アイコン）を画像の端ギリギリに置かない（LINE 表示時に切れるため、各セル内に十分なマージン）。
- 過度な装飾・グラデーションの多用・ごちゃついた背景は避ける。
${brandBlock}${defaultsBlock}`;
}

function buildReferencePrompt(
  userPrompt: string,
  size: 'large' | 'compact' | 'square' | 'landscape' | 'portrait' | 'banner_wide',
  defaultsText: string,
  variationIndex?: number,
  totalCount?: number,
  purpose: ImagePurpose = 'rich_menu',
  brandContext = '',
): string {
  const layout = imageContext(size) === 'rich_menu'
    ? (size === 'large'
        ? '出力は 3:2 横長 (LINE リッチメニュー Large・2500×1686)'
        : '出力は 3:1 超横長 (LINE リッチメニュー Compact・2500×843)')
    : broadcastLayoutHint(size);

  const variationHint =
    variationIndex !== undefined && totalCount !== undefined && totalCount > 1
      ? `\n【デザインバリエーション ${variationIndex + 1}/${totalCount}】\n${VARIATION_HINTS[variationIndex % VARIATION_HINTS.length]}\n`
      : '';

  const defaultsBlock = defaultsText
    ? `\n【スタイルガイド（必ず守る）】\n${defaultsText}\n`
    : '';

  return `添付画像の **色合い・雰囲気・トーン** を参考にしながら、新しい画像を生成してください。
添付画像をそのまま流用したり、複製したりはしないでください。
${variationHint}${purposeBlock(purpose)}
【今回作るもの】
${userPrompt}

【レイアウト要件】
${layout}

【共通ルール】
- 重要な要素を画像端ギリギリに置かない
- 配色は 2〜3 色に絞り、参考画像とブランドの世界観を保つ
${brandBlock(brandContext)}${defaultsBlock}`;
}

function buildRevisionPrompt(
  basePrompt: string,
  revisionRequest: string,
  defaultsText: string,
  size: 'large' | 'compact' | 'square' | 'landscape' | 'portrait' | 'banner_wide',
  cvTemplate?: boolean,
  purpose: ImagePurpose = 'rich_menu',
  brandContext = '',
): string {
  const layout = imageContext(size) === 'rich_menu'
    ? (size === 'large' ? '3×2 (6 タイル) 配置の横長 (3:2)' : '1×3 (3 タイル) 配置の超横長 (3:1)')
    : broadcastLayoutHint(size);
  const defaultsBlock = defaultsText ? `\n【維持すべきスタイルガイド】\n${defaultsText}\n` : '';
  const textRule = cvTemplate
    ? '- 画像内の日本語の見出し・サブコピーは表記を一字一句変えず、正確で可読性の高い文字のまま維持する（文字化け・誤字・英語化は不可）'
    : '- 文字を入れない';
  return `以下の画像を修正してください。
${purposeBlock(purpose)}
【修正内容】
${revisionRequest}

【元の依頼】
${basePrompt}

【守るべき要件】
- レイアウト: ${layout}
${textRule}
- 重要要素を端ギリギリに置かない
${brandBlock(brandContext)}${defaultsBlock}`;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function extractBase64(json: { data?: Array<{ b64_json?: string; url?: string }> }): Promise<string> {
  const item = json.data?.[0];
  if (!item) throw new Error('画像データが空でした');
  if (item.b64_json) return item.b64_json;
  if (item.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error('画像ダウンロードに失敗');
    const buf = await r.arrayBuffer();
    return arrayBufferToBase64(buf);
  }
  throw new Error('画像データ形式不明');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseOpenAiError(errText: string): string {
  try {
    const parsed = JSON.parse(errText) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    /* ignore */
  }
  return 'OpenAI 画像生成に失敗しました';
}
