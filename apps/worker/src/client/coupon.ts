/**
 * LIFF クーポン詳細ページ
 *
 * URL: https://liff.line.me/{liffId}?liffId={liffId}&page=coupon&id={couponId}
 *
 * 挙動:
 *   1. /api/coupons/public/:id でクーポン情報を取得して描画
 *   2. 抽選クーポン (acquisition_condition='lottery') の場合:
 *      - 未挑戦 → 「抽選にチャレンジ」ボタン表示
 *      - チャレンジ中 → ロード画面
 *      - 当選 → クーポン本体を表示
 *      - 落選 → 「次回をお楽しみに」画面
 *   3. 通常クーポンは即座にクーポン本体を表示
 *   4. 「クーポンを使用する」→ 確認モーダル → /api/coupons/public/:id/redeem
 */

// LIFF SDK は main.ts ですでに init 済みなので、グローバルの liff を参照する。
type LiffGlobal = {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  closeWindow(): void;
};
declare const liff: LiffGlobal;

interface CouponPublic {
  id: string;
  name: string;
  acquisition_condition: 'none' | 'lottery' | 'friend_add' | 'tag_added' | 'event_book';
  valid_from: string;
  valid_to: string;
  image_url: string | null;
  usage_guide: string | null;
  coupon_type: string;
  discount_mode: string | null;
  discount_yen: number | null;
  discount_percent: number | null;
  strikethrough_before: number | null;
  strikethrough_after: number | null;
  condition_text: string | null;
  show_code: number;
  code_value: string | null;
  max_uses_per_friend: number;
  lottery_probability: number | null;
  lottery_max_winners: number | null;
  offerText: string;
  // 拡張デザイン項目
  subtitle: string | null;
  template_id: 'simple' | 'bold' | 'elegant' | 'pop' | 'premium' | 'urgent';
  brand_color: string;
  accent_color: string | null;
  button_label: string;
  store_info: { hours?: string; phone?: string; address?: string; map_url?: string; sub_buttons?: Array<{ label: string; url: string }> } | null;
  show_remaining_days: boolean;
  show_lottery_remaining: boolean;
  background_pattern: 'none' | 'stripe' | 'dot' | 'gradient';
  image_position: 'hero' | 'inline';
  lottery_remaining: number | null;
}

interface AccountInfo {
  name: string;
  handle: string;
  picture_url: string | null;
}

interface CouponState {
  active: boolean;
  usedUp: boolean;
  friendUsedCount?: number;
}

function el(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild as HTMLElement;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function mount(node: HTMLElement) {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  app.appendChild(node);
}

function renderLoading(msg = '読み込み中...') {
  mount(
    el(`
      <div class="coupon-loading" style="min-height:60vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;">
        <div class="spinner" style="width:42px;height:42px;border:4px solid #e2e8f0;border-top-color:#06C755;border-radius:50%;animation:spin 0.9s linear infinite;"></div>
        <p style="color:#64748b;font-size:14px;">${escapeHtml(msg)}</p>
        <style>@keyframes spin{to{transform:rotate(360deg);}}</style>
      </div>
    `),
  );
}

function renderError(msg: string) {
  mount(
    el(`
      <div style="padding:40px 20px;text-align:center;">
        <p style="font-size:32px;margin-bottom:12px;">⚠️</p>
        <p style="color:#dc2626;font-size:14px;line-height:1.6;">${escapeHtml(msg)}</p>
      </div>
    `),
  );
}

interface TypeStyle {
  label: string;
  badgeBg: string;
  badgeFg: string;
  offerColor: string;
  icon: string;
}

function getTypeStyle(couponType: string): TypeStyle {
  switch (couponType) {
    case 'free':
      return {
        label: '無料',
        badgeBg: '#fff7ed',
        badgeFg: '#c2410c',
        offerColor: '#c2410c',
        icon: '🆓',
      };
    case 'present':
      return {
        label: 'プレゼント',
        badgeBg: '#fdf2f8',
        badgeFg: '#be185d',
        offerColor: '#be185d',
        icon: '🎁',
      };
    case 'cashback':
      return {
        label: 'キャッシュバック',
        badgeBg: '#eff6ff',
        badgeFg: '#1d4ed8',
        offerColor: '#1d4ed8',
        icon: '💰',
      };
    case 'other':
      return {
        label: 'その他',
        badgeBg: '#f5f3ff',
        badgeFg: '#6d28d9',
        offerColor: '#6d28d9',
        icon: '✨',
      };
    case 'discount':
    default:
      return {
        label: '割引',
        badgeBg: '#dcfce7',
        badgeFg: '#15803d',
        offerColor: '#06C755',
        icon: '🎟️',
      };
  }
}

/** クーポンタイプに応じたオファー(中央の大見出し)を生成 */
function buildOfferDisplay(c: CouponPublic, style: TypeStyle): string {
  switch (c.coupon_type) {
    case 'free':
      return `<p style="font-size:36px;color:${style.offerColor};font-weight:bold;margin:0 0 4px;letter-spacing:-0.02em;">無料</p>
              <p style="font-size:12px;color:#64748b;margin:0 0 16px;">対象商品が無料で受け取れます</p>`;
    case 'present':
      return `<p style="font-size:28px;color:${style.offerColor};font-weight:bold;margin:0 0 4px;">🎁 プレゼント</p>
              <p style="font-size:12px;color:#64748b;margin:0 0 16px;">特別なプレゼントをお受け取りいただけます</p>`;
    case 'cashback':
      // offerText が「¥1,000 OFF」のような割引形式なので、キャッシュバック向けに整形
      return `<p style="font-size:24px;color:${style.offerColor};font-weight:bold;margin:0 0 4px;">${escapeHtml(c.offerText)} キャッシュバック</p>
              <p style="font-size:12px;color:#64748b;margin:0 0 16px;">ご利用後に返金されます</p>`;
    case 'other':
      return `<p style="font-size:22px;color:${style.offerColor};font-weight:bold;margin:0 0 16px;">${escapeHtml(c.offerText || '特典あり')}</p>`;
    case 'discount':
    default:
      return `<p style="font-size:24px;color:${style.offerColor};font-weight:bold;margin:0 0 16px;">${escapeHtml(c.offerText)}</p>`;
  }
}

/** 残り日数を返す (有効期限まで、終了済みなら 0) */
function remainingDays(validTo: string): number {
  const ms = new Date(validTo).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** 公式アカウントクーポン風のトップバー */
function topBarHtml(): string {
  return `
    <div style="position:sticky;top:0;background:white;display:flex;align-items:center;justify-content:center;padding:14px 16px;border-bottom:1px solid #f1f5f9;z-index:10;">
      <p style="font-size:15px;font-weight:600;color:#0f172a;margin:0;">公式アカウントクーポン</p>
      <button onclick="(window.liff&&liff.closeWindow())||window.close()" style="position:absolute;right:16px;background:none;border:none;font-size:24px;color:#475569;cursor:pointer;padding:0;line-height:1;">×</button>
    </div>
  `;
}

/** アカウントヘッダー (アイコン + 名前 + ハンドル) */
function accountHeaderHtml(account: AccountInfo | null, rightBadge?: string): string {
  if (!account) return '';
  const initial = account.name ? account.name.charAt(0) : 'L';
  const avatar = account.picture_url
    ? `<img src="${escapeHtml(account.picture_url)}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;" />`
    : `<div style="width:48px;height:48px;border-radius:50%;background:#06C755;color:white;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:bold;">${escapeHtml(initial)}</div>`;
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:16px 20px 4px;">
      ${avatar}
      <div style="flex:1;min-width:0;">
        <p style="font-size:15px;font-weight:600;color:#0f172a;margin:0;">${escapeHtml(account.name)}</p>
        <p style="font-size:12px;color:#94a3b8;margin:2px 0 0;">${escapeHtml(account.handle)}</p>
      </div>
      ${
        rightBadge
          ? `<div style="border:1px solid #cbd5e1;border-radius:999px;padding:6px 12px;display:flex;align-items:center;gap:4px;font-size:12px;color:#0f172a;">${rightBadge}</div>`
          : ''
      }
    </div>
  `;
}

/** バッジ列 (割引・1回のみ使用可能 etc) */
function badgesHtml(c: CouponPublic, _style: TypeStyle, highlightUseBadge: boolean): string {
  const usesBadge = c.max_uses_per_friend === 1 ? '1回のみ使用可能' : '何回でも使用可能';
  const useBadgeStyle = highlightUseBadge
    ? 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;'
    : 'background:#f1f5f9;color:#475569;';
  const typeBadgeStyle = highlightUseBadge
    ? 'background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;'
    : 'background:#f1f5f9;color:#475569;';
  return `
    <div style="display:flex;gap:6px;padding:8px 20px 0;flex-wrap:wrap;">
      <span style="font-size:12px;${typeBadgeStyle}padding:4px 12px;border-radius:6px;font-weight:600;">割引</span>
      <span style="font-size:12px;${useBadgeStyle}padding:4px 12px;border-radius:6px;font-weight:600;">${escapeHtml(usesBadge)}</span>
    </div>
  `;
}

/** 中央の大きい割引額表示 (LINE 公式のあのデカい数字) */
function bigOfferHtml(c: CouponPublic): string {
  const color = c.accent_color ?? c.brand_color ?? '#06C755';
  switch (c.coupon_type) {
    case 'free':
      return `<p style="font-size:60px;font-weight:900;color:${color};margin:0 0 8px;letter-spacing:-0.04em;line-height:1;">無料</p>`;
    case 'present':
      return `<p style="font-size:40px;font-weight:900;color:${color};margin:0 0 8px;line-height:1;">🎁 プレゼント</p>`;
    case 'cashback':
    case 'discount':
    default: {
      // discount_yen / discount_percent / strikethrough のどれかから表示
      if (c.discount_mode === 'yen' && c.discount_yen) {
        return `<p style="margin:0 0 8px;line-height:1;">
          <span style="font-size:60px;font-weight:900;color:${color};letter-spacing:-0.04em;">${c.discount_yen.toLocaleString('ja-JP')}</span><span style="font-size:24px;font-weight:700;color:${color};margin-left:4px;">円引き</span>
        </p>`;
      }
      if (c.discount_mode === 'percent' && c.discount_percent) {
        return `<p style="margin:0 0 8px;line-height:1;">
          <span style="font-size:60px;font-weight:900;color:${color};letter-spacing:-0.04em;">${c.discount_percent}</span><span style="font-size:24px;font-weight:700;color:${color};margin-left:4px;">% OFF</span>
        </p>`;
      }
      if (c.discount_mode === 'strikethrough' && c.strikethrough_before && c.strikethrough_after) {
        return `<p style="margin:0 0 8px;line-height:1.2;">
          <span style="font-size:20px;color:#94a3b8;text-decoration:line-through;">¥${c.strikethrough_before.toLocaleString('ja-JP')}</span>
          <span style="font-size:28px;font-weight:900;color:${color};margin-left:8px;">¥${c.strikethrough_after.toLocaleString('ja-JP')}</span>
        </p>`;
      }
      return `<p style="font-size:36px;font-weight:900;color:${color};margin:0 0 8px;line-height:1;">${escapeHtml(c.offerText)}</p>`;
    }
  }
}

/** 利用ガイド (LINE 公式風の bullet 文) */
function usageGuideHtml(c: CouponPublic): string {
  const lines = (c.usage_guide ?? '').split('\n').filter((l) => l.trim().length > 0);
  const bullets = lines.length > 0
    ? lines.map((l) => `<p style="font-size:13px;color:#475569;line-height:1.7;margin:0;">${escapeHtml(l)}</p>`).join('')
    : `<p style="font-size:13px;color:#94a3b8;line-height:1.7;margin:0;">（利用ガイド未設定）</p>`;
  return `
    <div style="padding:0 20px 24px;">
      <p style="font-size:14px;color:#0f172a;font-weight:600;margin:0 0 8px;">利用ガイド</p>
      ${bullets}
      <p style="font-size:11px;color:#94a3b8;margin:12px 0 0;">クーポンの有効期間は、UTC+09:00を基準に表示しています。</p>
    </div>
  `;
}

/** 残り日数 / 抽選残枠の警告表示 */
function urgencyHtml(c: CouponPublic): string {
  const parts: string[] = [];
  if (c.show_remaining_days) {
    const days = remainingDays(c.valid_to);
    if (days > 0 && days <= 30) {
      const urgent = days <= 3;
      const color = urgent ? '#dc2626' : '#0f172a';
      const bg = urgent ? '#fef2f2' : '#f8fafc';
      const border = urgent ? '1px solid #fecaca' : '1px solid #e2e8f0';
      parts.push(`<div style="background:${bg};border:${border};border-radius:8px;padding:10px 14px;font-size:13px;color:${color};font-weight:600;">⏰ 有効期限まであと ${days} 日</div>`);
    }
  }
  if (c.show_lottery_remaining && c.lottery_remaining != null && c.lottery_remaining > 0) {
    parts.push(`<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;color:#a16207;font-weight:600;">🎲 残り ${c.lottery_remaining} 名様</div>`);
  }
  if (parts.length === 0) return '';
  return `<div style="display:flex;flex-direction:column;gap:8px;padding:8px 20px 0;">${parts.join('')}</div>`;
}

/** 店舗情報 (任意) */
function storeInfoHtml(c: CouponPublic): string {
  if (!c.store_info) return '';
  const s = c.store_info;
  const items: string[] = [];
  if (s.hours) items.push(`<div style="display:flex;gap:8px;font-size:13px;color:#475569;"><span>🕒</span><span>${escapeHtml(s.hours)}</span></div>`);
  if (s.phone) items.push(`<div style="display:flex;gap:8px;font-size:13px;color:#475569;"><span>📞</span><a href="tel:${escapeHtml(s.phone.replace(/[^\d+]/g, ''))}" style="color:#0284c7;">${escapeHtml(s.phone)}</a></div>`);
  if (s.address) items.push(`<div style="display:flex;gap:8px;font-size:13px;color:#475569;"><span>📍</span><span>${escapeHtml(s.address)}</span></div>`);
  if (s.map_url) items.push(`<a href="${escapeHtml(s.map_url)}" target="_blank" rel="noopener" style="font-size:13px;color:#0284c7;">地図を見る →</a>`);
  if (items.length === 0) return '';
  return `
    <details style="margin:8px 20px 0;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;">
      <summary style="font-size:13px;color:#0f172a;font-weight:600;cursor:pointer;">店舗情報</summary>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">${items.join('')}</div>
    </details>
  `;
}

function couponCardHtml(c: CouponPublic, account: AccountInfo | null, opts: { highlightUseBadge?: boolean; rightBadge?: string } = {}): string {
  const style = getTypeStyle(c.coupon_type);
  const headerImage = c.image_url && c.image_position === 'hero'
    ? `<img src="${escapeHtml(c.image_url)}" alt="" style="width:100%;height:180px;object-fit:cover;background:#f1f5f9;" />`
    : '';
  return `
    ${topBarHtml()}
    ${accountHeaderHtml(account, opts.rightBadge)}
    ${badgesHtml(c, style, opts.highlightUseBadge ?? false)}
    <div style="padding:8px 20px 16px;">
      <h1 style="font-size:18px;color:#0f172a;margin:8px 0 4px;font-weight:500;">${escapeHtml(c.name)}</h1>
      ${c.subtitle ? `<p style="font-size:13px;color:#64748b;margin:0 0 12px;">${escapeHtml(c.subtitle)}</p>` : ''}
      ${bigOfferHtml(c)}
      <div style="display:flex;gap:8px;margin-top:16px;">
        <p style="font-size:13px;color:#94a3b8;margin:0;">有効期間</p>
        <p style="font-size:13px;color:#475569;margin:0;">${formatDate(c.valid_from)} 〜 ${formatDate(c.valid_to)}</p>
      </div>
    </div>
    ${urgencyHtml(c)}
    ${headerImage ? `<div style="padding:0 20px 16px;">${headerImage}</div>` : ''}
    ${
      c.show_code === 1 && c.code_value
        ? `<div style="margin:0 20px 16px;background:#f8fafc;border:1px dashed #94a3b8;border-radius:8px;padding:14px;text-align:center;">
            <p style="font-size:11px;color:#64748b;margin:0 0 6px;">クーポンコード</p>
            <p style="font-size:22px;font-family:'SF Mono','Menlo',monospace;letter-spacing:3px;color:#0f172a;font-weight:700;margin:0;">${escapeHtml(c.code_value)}</p>
          </div>`
        : ''
    }
    ${c.condition_text ? `<p style="font-size:12px;color:#64748b;margin:0 20px 16px;">${escapeHtml(c.condition_text)}</p>` : ''}
    ${usageGuideHtml(c)}
    ${storeInfoHtml(c)}
  `;
}

function renderActiveCoupon(c: CouponPublic, opts: { onUse: () => void }) {
  const account = state?.account ?? null;
  const useLabel = c.button_label && c.button_label !== 'クーポンを見る' ? c.button_label : 'クーポンを使う';
  const brand = c.brand_color ?? '#06C755';
  // 下部のアクションエリア: メインボタン + (任意) 店舗情報サブボタン
  const subButtons = (c.store_info?.sub_buttons ?? [])
    .slice(0, 2)
    .map((b) => `<a href="${escapeHtml(b.url)}" style="display:block;text-align:center;padding:12px;border:1px solid #e2e8f0;border-radius:8px;color:#0f172a;font-size:13px;text-decoration:none;">${escapeHtml(b.label)}</a>`)
    .join('');
  const node = el(`
    <div style="background:white;min-height:100vh;padding-bottom:96px;">
      ${couponCardHtml(c, account)}
      <div style="position:fixed;bottom:0;left:0;right:0;background:white;padding:14px 16px 20px;border-top:1px solid #f1f5f9;display:flex;flex-direction:column;gap:8px;">
        ${subButtons ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">${subButtons}</div>` : ''}
        <button id="use-btn" style="width:100%;background:${brand};color:white;border:none;border-radius:10px;padding:16px;font-size:15px;font-weight:700;cursor:pointer;">
          ${escapeHtml(useLabel)}
        </button>
      </div>
    </div>
  `);
  node.querySelector('#use-btn')?.addEventListener('click', opts.onUse);
  mount(node);
}

function renderUseConfirm(c: CouponPublic, opts: { onConfirm: () => void; onCancel: () => void }) {
  const account = state?.account ?? null;
  // LINE 公式風: 背景にやや薄くしたカード + 下から bottom sheet。
  // grayscale を使うと白黒で怖くなるため、opacity だけ下げてカラーは保つ。
  // overlay も淡い白系にしておき威圧感を抑える。
  const node = el(`
    <div style="background:white;min-height:100vh;position:relative;">
      <div style="opacity:0.5;pointer-events:none;">
        ${couponCardHtml(c, account, { highlightUseBadge: true, rightBadge: '<span style="color:#06C755;">🎟️</span> <span>1枚使用可</span>' })}
      </div>
      <div style="position:fixed;inset:0;background:rgba(255,255,255,0.55);backdrop-filter:saturate(0.85);z-index:40;"></div>
      <div style="position:fixed;left:0;right:0;bottom:0;background:white;border-radius:16px 16px 0 0;padding:24px 20px 28px;z-index:50;box-shadow:0 -4px 20px rgba(0,0,0,0.08);">
        <button id="x-btn" style="position:absolute;top:14px;right:14px;background:none;border:none;font-size:22px;color:#64748b;cursor:pointer;padding:6px;line-height:1;">×</button>
        <p style="font-size:18px;font-weight:700;color:#0f172a;margin:8px 0 12px;text-align:center;">クーポンを使用済みにしますか？</p>
        <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 24px;text-align:center;">この操作は取り消せません。利用ガイドをご確認の上、使用<br/>済みにしてください。</p>
        <button id="confirm-btn" style="width:100%;background:#ef4444;color:white;border:none;border-radius:10px;padding:16px;font-size:15px;font-weight:700;cursor:pointer;">
          使用済みにする
        </button>
      </div>
    </div>
  `);
  node.querySelector('#x-btn')?.addEventListener('click', opts.onCancel);
  node.querySelector('#confirm-btn')?.addEventListener('click', opts.onConfirm);
  mount(node);
}

function renderUsed() {
  mount(
    el(`
      <div style="background:white;min-height:100vh;">
        ${topBarHtml()}
        <div style="padding:80px 24px;text-align:center;">
          <p style="font-size:64px;margin:0 0 16px;">✅</p>
          <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0 0 10px;">使用済みになりました</h1>
          <p style="font-size:14px;color:#64748b;line-height:1.7;">ご利用ありがとうございます。<br/>このクーポンは再度使用できません。</p>
        </div>
      </div>
    `),
  );
}

function renderUsedUp(c?: CouponPublic, account?: AccountInfo | null) {
  if (!c) {
    mount(
      el(`
        <div style="background:white;min-height:100vh;">
          ${topBarHtml()}
          <div style="padding:80px 24px;text-align:center;">
            <p style="font-size:48px;margin:0 0 16px;">🔒</p>
            <h1 style="font-size:18px;font-weight:700;color:#0f172a;margin:0 0 8px;">使用回数に達しています</h1>
            <p style="font-size:12px;color:#64748b;line-height:1.6;">このクーポンは既に使用済み、または使用上限に達しています。</p>
          </div>
        </div>
      `),
    );
    return;
  }
  mount(
    el(`
      <div style="background:white;min-height:100vh;padding-bottom:80px;">
        <div style="filter:grayscale(0.6) brightness(0.8);">${couponCardHtml(c, account ?? null)}</div>
        <div style="position:fixed;bottom:0;left:0;right:0;background:#e2e8f0;color:#64748b;text-align:center;padding:18px;font-size:15px;font-weight:600;">
          使用済みのクーポンです
        </div>
      </div>
    `),
  );
}

function renderInactive(reason: string) {
  mount(
    el(`
      <div style="padding:60px 24px;text-align:center;">
        <p style="font-size:48px;margin:0 0 16px;">⏰</p>
        <h1 style="font-size:18px;font-weight:bold;color:#0f172a;margin:0 0 8px;">${escapeHtml(reason)}</h1>
      </div>
    `),
  );
}

function renderLotteryChallenge(c: CouponPublic, opts: { onChallenge: () => void }) {
  const headerImage = c.image_url
    ? `<img src="${escapeHtml(c.image_url)}" alt="" style="width:100%;height:160px;object-fit:cover;background:#f1f5f9;" />`
    : '';
  const brand = c.brand_color ?? '#06C755';
  const node = el(`
    <div style="background:white;min-height:100vh;padding-bottom:88px;">
      ${headerImage}
      <div style="padding:20px;">
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <span style="font-size:10px;background:#fef3c7;color:#a16207;padding:2px 8px;border-radius:999px;font-weight:600;">抽選クーポン</span>
        </div>
        <h1 style="font-size:18px;font-weight:bold;color:#0f172a;margin:0 0 8px;">${escapeHtml(c.name)}</h1>
        <p style="font-size:24px;color:${c.accent_color ?? brand};font-weight:bold;margin:0 0 16px;">${escapeHtml(c.offerText)}</p>
        <p style="font-size:12px;color:#64748b;margin:0 0 4px;">有効期間</p>
        <p style="font-size:13px;color:#0f172a;margin:0 0 16px;">${formatDate(c.valid_to)} まで</p>
        <div style="background:#fef3c7;border-radius:8px;padding:14px;">
          <p style="font-size:13px;color:#a16207;font-weight:600;margin:0 0 4px;">🎲 抽選にチャレンジしよう</p>
          <p style="font-size:11px;color:#92400e;line-height:1.6;margin:0;">下のボタンから抽選にチャレンジしてください。<br/>挑戦は <strong>1 回のみ</strong>です。</p>
        </div>
      </div>
      <div style="position:fixed;left:0;right:0;bottom:0;background:white;padding:14px 16px 20px;border-top:1px solid #f1f5f9;">
        <button id="lottery-btn" style="width:100%;background:#3b82f6;color:white;border:none;border-radius:10px;padding:16px;font-size:15px;font-weight:700;cursor:pointer;">
          🎲 抽選にチャレンジ
        </button>
      </div>
    </div>
  `);
  node.querySelector('#lottery-btn')?.addEventListener('click', opts.onChallenge);
  mount(node);
}

function renderLotteryDrawing() {
  mount(
    el(`
      <div style="padding:80px 24px;text-align:center;">
        <div class="spinner" style="width:60px;height:60px;border:5px solid #dbeafe;border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 24px;"></div>
        <h1 style="font-size:18px;font-weight:bold;color:#0f172a;margin:0 0 6px;">抽選中...</h1>
        <p style="font-size:12px;color:#64748b;">抽選中です。しばらくお待ちください。</p>
        <style>@keyframes spin{to{transform:rotate(360deg);}}</style>
      </div>
    `),
  );
}

/**
 * 当選画面: LINE 公式風に、上部に大きい「🎉 おめでとうございます」帯 +
 * その下に獲得クーポンの本体カードを表示する。落選画面 (renderLotteryLoseWithCard)
 * と対になる構成で、勝者は本物のクーポンを目で見れるようにする。
 */
function renderLotteryWin(c: CouponPublic, opts: { onCheckCoupon: () => void }) {
  const account = state?.account ?? null;
  const brand = c.brand_color ?? '#06C755';
  // 画像の組み込み背景が #ECECEC 系のため、wrapper も同じ色にして繋ぎ目を消す。
  // 画像下のテキストエリアまで一続きにすることで「色違いの境界」を見せない。
  const node = el(`
    <div style="background:white;min-height:100vh;padding-bottom:100px;">
      <div style="background:#ECECEC;padding:24px 24px 28px;text-align:center;">
        <img src="/images/lottery-win.png" alt="" style="display:block;width:240px;max-width:80%;height:auto;margin:0 auto 8px;mix-blend-mode:multiply;" />
        <h1 style="font-size:22px;font-weight:800;color:#06C755;margin:0 0 6px;letter-spacing:-0.01em;line-height:1.4;">おめでとうございます<br/>当選しました！</h1>
        <p style="font-size:13px;color:#475569;line-height:1.7;margin:12px 0 0;">
          <strong>${escapeHtml(c.name)}</strong> を獲得しました。<br/>
          公式アカウントのトークルームでも獲得したクーポンをチェックできます。
        </p>
      </div>
      ${couponCardHtml(c, account)}
      <div style="position:fixed;left:0;right:0;bottom:0;background:white;padding:14px 16px 20px;border-top:1px solid #f1f5f9;">
        <button id="check-btn" style="width:100%;background:${brand};color:white;border:none;border-radius:10px;padding:16px;font-size:15px;font-weight:700;cursor:pointer;">
          🎟️ 獲得したクーポンを使う
        </button>
      </div>
    </div>
  `);
  node.querySelector('#check-btn')?.addEventListener('click', opts.onCheckCoupon);
  mount(node);
}

function renderLotteryLose(reason?: string) {
  const msg =
    reason === 'max_winners_reached'
      ? '当選者数の上限に達したため、抽選を終了いたしました。'
      : 'またのご応募をお待ちしております。';
  mount(
    el(`
      <div style="background:white;min-height:100vh;">
        ${topBarHtml()}
        <div style="background:#ECECEC;padding:48px 24px;text-align:center;">
          <img src="/images/lottery-lose.png" alt="" style="display:block;width:240px;max-width:80%;height:auto;margin:0 auto 20px;mix-blend-mode:multiply;" />
          <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0 0 12px;line-height:1.4;">残念...<br/>落選しました</h1>
          <p style="font-size:14px;color:#64748b;line-height:1.7;">${escapeHtml(msg)}</p>
        </div>
      </div>
    `),
  );
}

/**
 * LINE 公式風の落選: クーポン詳細をグレーアウトで見せたまま、
 * 画面下に「残念...ハズレです!」バナーを表示する。
 */
function renderLotteryLoseWithCard(c: CouponPublic, account: AccountInfo | null) {
  mount(
    el(`
      <div style="background:white;min-height:100vh;padding-bottom:200px;">
        <div style="background:#ECECEC;padding:24px 24px 28px;text-align:center;">
          <img src="/images/lottery-lose.png" alt="" style="display:block;width:200px;max-width:70%;height:auto;margin:0 auto 12px;mix-blend-mode:multiply;" />
          <h1 style="font-size:20px;font-weight:700;color:#475569;margin:0;line-height:1.4;">残念...ハズレです！</h1>
        </div>
        <div style="filter:grayscale(0.7) brightness(0.85) opacity(0.7);pointer-events:none;">
          ${couponCardHtml(c, account)}
        </div>
      </div>
    `),
  );
}

// ─── メインフロー ───

let state: {
  couponId: string;
  friendId: string;
  coupon: CouponPublic | null;
  account: AccountInfo | null;
  apiCall: (path: string, options?: RequestInit) => Promise<Response>;
} | null = null;

async function fetchCoupon(): Promise<{ coupon: CouponPublic; state: CouponState; account: AccountInfo | null } | null> {
  if (!state) return null;
  const res = await state.apiCall(
    `/api/coupons/public/${encodeURIComponent(state.couponId)}?friendId=${encodeURIComponent(state.friendId)}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    success: boolean;
    coupon?: CouponPublic;
    state?: CouponState;
    account?: AccountInfo | null;
  };
  if (!json.success || !json.coupon || !json.state) return null;
  return { coupon: json.coupon, state: json.state, account: json.account ?? null };
}

async function handleUse() {
  if (!state) return;
  renderLoading('処理中...');
  try {
    const res = await state.apiCall(`/api/coupons/public/${state.couponId}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId: state.friendId }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      renderError(json.error ?? '使用記録に失敗しました');
      return;
    }
    renderUsed();
  } catch (err) {
    renderError(err instanceof Error ? err.message : '使用記録に失敗しました');
  }
}

async function handleLotteryChallenge() {
  if (!state) return;
  renderLotteryDrawing();
  try {
    const res = await state.apiCall(
      `/api/coupons/public/${state.couponId}/lottery-challenge`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId: state.friendId }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      result?: 'won' | 'lost';
      reason?: string;
      error?: string;
    };
    if (!json.success) {
      renderError(json.error ?? '抽選に失敗しました');
      return;
    }
    // 演出のため 1.2 秒待つ
    await new Promise((r) => setTimeout(r, 1200));
    if (json.result === 'won' && state.coupon) {
      renderLotteryWin(state.coupon, {
        onCheckCoupon: () => showCouponBody(state!.coupon!),
      });
    } else {
      renderLotteryLose(json.reason);
    }
  } catch (err) {
    renderError(err instanceof Error ? err.message : '抽選に失敗しました');
  }
}

function showCouponBody(coupon: CouponPublic) {
  renderActiveCoupon(coupon, {
    onUse: () =>
      renderUseConfirm(coupon, {
        onConfirm: () => void handleUse(),
        onCancel: () => showCouponBody(coupon),
      }),
  });
}

export async function initCoupon(
  couponId: string | null,
  apiCall: (path: string, options?: RequestInit) => Promise<Response>,
): Promise<void> {
  if (!couponId) {
    renderError('クーポン ID が指定されていません');
    return;
  }
  renderLoading();

  const profile = await liff.getProfile();
  // friendId = LINE userId(L-port側で friend.line_user_id が一致するレコードを使う)
  // ただし API は friend.id (UUID) を期待する場合があるので、
  // userId で friend を引いて id を取得する処理が必要。
  // ここでは LIFF userId をそのまま friendId として渡し、worker 側で解決する想定。
  const friendId = profile.userId;

  state = { couponId, friendId, coupon: null, account: null, apiCall };

  const data = await fetchCoupon();
  if (!data) {
    renderError('クーポン情報の取得に失敗しました');
    return;
  }
  state.coupon = data.coupon;
  state.account = data.account;

  // 期間チェック
  const now = Date.now();
  if (new Date(data.coupon.valid_from).getTime() > now) {
    renderInactive('まだ開始されていません');
    return;
  }
  if (new Date(data.coupon.valid_to).getTime() < now) {
    renderInactive('有効期限が切れています');
    return;
  }
  if (data.state.usedUp) {
    renderUsedUp(data.coupon, data.account);
    return;
  }

  // 抽選クーポンの分岐
  if (data.coupon.acquisition_condition === 'lottery') {
    const statusRes = await apiCall(
      `/api/coupons/public/${couponId}/lottery-status?friendId=${encodeURIComponent(friendId)}`,
    );
    const statusJson = (await statusRes.json().catch(() => ({}))) as {
      attempted?: boolean;
      result?: 'won' | 'lost';
    };
    if (statusJson.attempted) {
      if (statusJson.result === 'won') {
        showCouponBody(data.coupon);
      } else {
        renderLotteryLoseWithCard(data.coupon, data.account);
      }
      return;
    }
    renderLotteryChallenge(data.coupon, {
      onChallenge: () => void handleLotteryChallenge(),
    });
    return;
  }

  // 通常クーポン
  showCouponBody(data.coupon);
}
