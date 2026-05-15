/**
 * PII（個人情報）マスキング層
 *
 * AI に送るプロンプトから氏名・電話・住所・カード番号・LINE ID などを
 * トークンに置換し、AI からの応答内で参照されたら復号する。
 *
 * 目的:
 *  - 顧客 PII を Anthropic 等のサードパーティ AI プロバイダに渡さない
 *  - ログ・キャッシュに PII を残さない
 *  - 個人情報保護法 / GDPR 対応の最低限の処理
 *
 * 注意:
 *  - 完全な匿名化ではない（context 上で「東京都に住む山田さん」が判別できる
 *    程度の情報は残る）。これは AI 応答の品質と PII 保護のトレードオフ。
 *  - LINE display_name のような「公開前提」の名前はマスキング対象外にできる
 *    （maskOptions で制御）
 */

export interface PiiMaskingResult {
  /** マスキング後のテキスト */
  masked: string;
  /** 置換トークンと元値のマップ（復号に使用） */
  tokens: Map<string, string>;
}

export interface MaskOptions {
  /** display_name 等の表示名をマスキングするか（既定: false） */
  maskDisplayName?: boolean;
  /** メールアドレスをマスキングするか（既定: true） */
  maskEmail?: boolean;
  /** 電話番号をマスキングするか（既定: true） */
  maskPhone?: boolean;
  /** 住所をマスキングするか（既定: true） */
  maskAddress?: boolean;
  /** カード番号をマスキングするか（既定: true） */
  maskCreditCard?: boolean;
  /** LINE user ID をマスキングするか（既定: true） */
  maskLineUserId?: boolean;
}

const DEFAULT_OPTIONS: Required<MaskOptions> = {
  maskDisplayName: false,
  maskEmail: true,
  maskPhone: true,
  maskAddress: true,
  maskCreditCard: true,
  maskLineUserId: true,
};

// ---------------------------------------------------------------------------
// Regex patterns（日本のフォーマット中心）
// ---------------------------------------------------------------------------

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// 日本の電話番号:
//   090-1234-5678 / 03-1234-5678 / 0312345678 / +81-90-1234-5678
const PHONE_JP = /(?:\+?81[-\s]?|0)\d{1,4}[-\s]?\d{2,4}[-\s]?\d{3,4}/g;

// クレジットカード番号 (簡易): 13-19 桁の数字（ハイフン / 空白許容）
const CREDIT_CARD = /\b(?:\d[ -]?){13,19}\b/g;

// LINE user ID は U で始まる 33 文字の英数字
const LINE_USER_ID = /\bU[a-f0-9]{32}\b/g;

// 日本の住所っぽいパターン: 都道府県 + 市/区 + 残り
const JP_ADDRESS = /(?:北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)[^\s,。、]{2,40}/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * テキスト内の PII を検出してトークンに置換する。
 * 復号には返却されたトークンマップを使う。
 */
export function maskPii(input: string, options: MaskOptions = {}): PiiMaskingResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const tokens = new Map<string, string>();
  let counter = 0;
  let result = input;

  const issueToken = (kind: string, value: string): string => {
    // 同じ値は同じトークンに（参照の一貫性のため）
    for (const [tok, original] of tokens) {
      if (original === value) return tok;
    }
    const token = `[${kind}_${counter++}]`;
    tokens.set(token, value);
    return token;
  };

  if (opts.maskEmail) {
    result = result.replace(EMAIL, (m) => issueToken('EMAIL', m));
  }
  if (opts.maskCreditCard) {
    result = result.replace(CREDIT_CARD, (m) => {
      // 短すぎる数字列の誤検知を回避（電話番号と混同しないよう、空白/ハイフン除いて 13 桁以上）
      const digits = m.replace(/[ -]/g, '');
      if (digits.length < 13) return m;
      return issueToken('CARD', m);
    });
  }
  if (opts.maskPhone) {
    result = result.replace(PHONE_JP, (m) => issueToken('PHONE', m));
  }
  if (opts.maskLineUserId) {
    result = result.replace(LINE_USER_ID, (m) => issueToken('LINEUSER', m));
  }
  if (opts.maskAddress) {
    result = result.replace(JP_ADDRESS, (m) => issueToken('ADDRESS', m));
  }

  return { masked: result, tokens };
}

/**
 * AI から返ってきた応答内のトークンを復号して元の PII に戻す。
 */
export function unmaskPii(maskedText: string, tokens: Map<string, string>): string {
  let result = maskedText;
  for (const [token, original] of tokens) {
    result = result.split(token).join(original);
  }
  return result;
}

/**
 * AI 出力にテナント越境がないか検証（簡易版）。
 * 他テナントの固有名詞が混入していないかチェック。
 * 厳密ではないが、典型的な事故を捕まえる。
 */
export function detectTenantLeak(
  output: string,
  expectedTenantTerms: string[],
  forbiddenTenantTerms: string[],
): { ok: boolean; leaked: string[] } {
  const leaked: string[] = [];
  for (const term of forbiddenTenantTerms) {
    if (term && output.includes(term)) {
      leaked.push(term);
    }
  }
  return { ok: leaked.length === 0, leaked };
}
