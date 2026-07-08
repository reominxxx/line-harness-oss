import Link from 'next/link'

// ─────────────────────────────────────────────────────────────────────────────
// L-port LP — Editorial-grade Japanese SaaS aesthetic.
//
// Design direction (intentional choices, not generic defaults):
//   - Display 書体: Shippori Mincho (明朝) で出版的重み + 信頼感
//   - Body 書体: Noto Sans JP
//   - 配色: warm off-white #FAFAF7 base / charcoal #0F1419 dark blocks /
//           emerald→cyan-blue gradient (ロゴ由来) を accent に限定使用
//   - Layout: asymmetric grid, editorial section labels (FEATURE 01 形式),
//             generous negative space, 数字を大きく
//   - 区切り: 斜めライン (diagonal "L" stroke を section divider に再利用)
// ─────────────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: '#problem', label: '課題' },
  { href: '#features', label: '機能' },
  { href: '#industries', label: '業界' },
  { href: '#compare', label: '比較' },
  { href: '#pricing', label: '料金' },
  { href: '#bridge', label: 'L ステップ移行' },
  { href: '#faq', label: 'FAQ' },
]

const PROBLEMS = [
  {
    num: '01',
    title: '運用代行に月 20 万円払って\nも、成果が見えてこない',
    body: '配信本数だけが KPI になり、何が売上に効いたか誰も追えていない。担当者が辞めたら知見はリセット。毎月「同じような配信」が繰り返される。',
  },
  {
    num: '02',
    title: '自分で運用しようとしたが、\n本業を圧迫している',
    body: 'L ステップを契約したが、配信文を考える時間が取れない。深夜の予約問合せにも対応できず、本来集中したい施術・接客の時間が削られていく。',
  },
  {
    num: '03',
    title: 'AI ツールを入れたが、\n結局「使える人」がいない',
    body: 'チャットボットや配信ツールは導入したが、設定が複雑で結局放置。最新機能をキャッチアップする余裕もなく、宝の持ち腐れになっている。',
  },
]

const FEATURES = [
  {
    num: 'FEATURE 01',
    title: '専属チームが、\n全運用を代行します',
    lead: 'お客様は LINE 公式アカウントを共有するだけ。配信設計・クーポン作成・シナリオ・リッチメニュー設置・AI 設定まで、L-port チームが全部代行。お客様は「結果が出る LINE 運用」だけを受け取れます。',
    bullets: [
      '触る必要なし: お客様は管理画面を覚えなくていい',
      '専属担当 + AI チームの二重体制で毎月の運用を回す',
      '毎月、ダッシュボードに「結果」だけが届く',
    ],
  },
  {
    num: 'FEATURE 02',
    title: 'AI を駆使するから、\n月 ¥19,800〜で代行できる',
    lead: '通常の運用代行が高い理由は「人手」だから。L-port は自社開発の AI 基盤 (配信案生成・AI 接客・録音→設計書) を使うため、人件費が 1/10。同じ品質の運用を、価格 1/10 で提供できます。',
    bullets: [
      'ヒアリング録音 → AI が月 N 本の配信設計書を生成',
      '24h AI 接客で深夜の問合せもゼロ取りこぼし',
      'AI が下書き → 人間が承認 → 配信。品質と速度の両立',
    ],
  },
  {
    num: 'FEATURE 03',
    title: 'お客様画面は、\n結果が見えるダッシュボードだけ',
    lead: 'お客様には「自分の店の結果が見える」シンプルなダッシュボードのみ。配信実績 / クーポン使用率 / 友だち増減 / AI 接客件数 / 月次レポートを、いつでも 1 画面で確認できます。複雑な機能は一切表示しません。',
    bullets: [
      '管理画面のログインも顧客アカウントを別途発行',
      'スマホでサクッと結果確認、報告会議の時間も削減',
      'チャットで担当者に質問可能、ヒアリング・要望伝達もここで',
    ],
  },
]

const INDUSTRIES = [
  { mark: '美', name: '美容室', sub: 'カット予約 / リピート促進 / 季節キャンペーン', ready: true },
  { mark: '整', name: '整体・治療院', sub: '症状別フォロー / 通院継続 / 紹介促進', ready: true },
  { mark: 'EC', name: 'EC / D2C', sub: 'Shopify 連携 / 商品提案 / 休眠掘り起こし', ready: true },
  { mark: '学', name: 'スクール・教室', sub: '体験予約 / 入会促進 / 継続フォロー', ready: true },
  { mark: '士', name: '士業', sub: '初回相談予約 / 顧問契約フォロー', ready: true },
  { mark: '食', name: '飲食店', sub: '予約 / 来店促進 / 限定クーポン', ready: false },
]

const COMPARE_ROWS = [
  { label: '月額 (初期費別)', lstep: '¥21,780〜 + 自分の時間', agency: '¥150,000〜250,000', lport: '¥19,800〜 (運用込)', highlight: true },
  { label: '誰が運用するか', lstep: '自分', agency: '担当者 (属人化)', lport: '専属チーム + AI', highlight: true },
  { label: '24h AI 自動応答', lstep: '×', agency: '× (営業時間内)', lport: '○' },
  { label: '配信文の作成', lstep: '自分で全部', agency: '担当者の頭次第', lport: 'AI + 専門家レビュー' },
  { label: '配信設計の品質', lstep: '自己流', agency: '担当者次第', lport: 'AI が KPI から逆算' },
  { label: '業界トーンの担保', lstep: '本人次第', agency: '担当者依存', lport: '業界プレイブック標準装備' },
  { label: '月次レポート', lstep: '自分で作る', agency: '○ (手作業)', lport: '○ (自動)' },
  { label: 'L ステップとの並走', lstep: '—', agency: '×', lport: '○ (Bridge)' },
  { label: '導入までの期間', lstep: '2〜4 週間 + 学習', agency: '1〜2 ヶ月', lport: '最短 5 日 (運用開始)' },
  { label: 'お客様の作業時間', lstep: '月 10-30 時間', agency: '月 1-3 時間 (打合せ)', lport: '月 30 分 (レポート確認)' },
]

const PRICING = [
  {
    name: 'A-Lite',
    price: '19,800',
    target: '個人店舗・テスト導入',
    pitch: '最小プラン — まずは LINE 運用を任せたい方',
    features: [
      '初回構築代行 (リッチメニュー / あいさつ)',
      '一斉配信 月 4 回 (チーム代行)',
      'AI 接客 ON (24h 自動応答)',
      '月次サマリーレポート',
      'チャット相談 (土日除く)',
    ],
    featured: false,
  },
  {
    name: 'A-Standard',
    price: '49,800',
    target: '成長フェーズ',
    pitch: '人気プラン — フル運用代行',
    features: [
      'Lite 全機能',
      '一斉配信 月 6 回 / クーポン 月 2 種',
      'AI 接客 月 500 メッセージまで',
      'LINE VOOM 投稿 月 2 本',
      '回答フォーム→セグメント配信',
      '専属担当アサイン',
    ],
    featured: true,
  },
  {
    name: 'A-Pro',
    price: '99,800',
    target: '中堅・複数店舗',
    pitch: '完全代行 + 戦略 MTG + 改善提案',
    features: [
      'Standard 全機能',
      '一斉配信 月 8 回 / クーポン 月 4 種',
      'AI 接客 月 2,000 メッセージまで',
      'LINE VOOM 投稿 月 4 本',
      'DB 設計 + 改善提案レポート',
      '月 1 戦略 MTG (Zoom 30 分)',
    ],
    featured: false,
  },
]

const BRIDGE_REASONS = [
  {
    num: '01',
    title: 'L ステップを解約せず、AI 層だけ追加',
    body: '既存シナリオはそのまま稼働、AI 接客と AI 配信案だけ L-port から提供。「効果が出てから完全移行を判断」できる。',
  },
  {
    num: '02',
    title: 'タグ / 友だち は CSV で移植可能',
    body: 'L ステップから CSV エクスポート → L-port にインポート。並走期間 2 週間で安全に切替。',
  },
  {
    num: '03',
    title: 'リッチメニューは LINE API 経由で取得',
    body: 'LINE 側に登録された既存リッチメニューを L-port が読み取り、編集 / 再配信できる。再作成の手間ゼロ。',
  },
]

const FLOW = [
  { day: 'Day 1', title: '無料ヒアリング (30 分)', body: 'L-port チームが事業内容を伺います。お客様の作業はこれだけ。' },
  { day: 'Day 2', title: '認証情報のご共有', body: 'LINE 公式アカウントのトークン・シークレットを安全なフォームで送信。' },
  { day: 'Day 3', title: 'L-port チームが初期構築', body: 'リッチメニュー / シナリオ / AI 設定をチームが代行。' },
  { day: 'Day 5', title: '初回配信の承認', body: 'チームが作った配信案を Slack / メールで確認 → 承認 → 配信。' },
  { day: 'Day 7', title: '本格運用開始', body: '以降はチームが毎月の運用を回し、月次レポートが届きます。' },
]

const FAQS = [
  {
    q: '私 (店舗オーナー) は何をすればいいですか?',
    a: '初回ヒアリング (30 分) と LINE 公式アカウントの認証情報のご共有のみです。以降は月 1 回 30 分程度、レポート確認と方向性のご相談だけ。配信文の作成・スケジューリング・お客様対応・分析は全て L-port チームが代行します。',
  },
  {
    q: 'LINE アカウントの情報を渡すのは怖いです',
    a: 'すべての認証情報は Cloudflare の暗号化インフラで管理し、アクセスログを 100% 記録しています。トークンは契約期間中のみ使用、解約時に完全削除します。NDA 締結も対応可能。詳細はお気軽にご相談ください。',
  },
  {
    q: 'AI 接客の品質は本当に大丈夫?',
    a: '業界別プレイブックとお店のナレッジで「お店専属の AI」として応答します。初週は L-port チームがレビュー必須、不適切応答はエスカレ条件で人間に切り替わるためお客様に届く前に止められます。',
  },
  {
    q: 'L ステップから移行できますか?',
    a: 'はい。L ステップ Bridge モードで L ステップを解約せず AI 層だけ追加できます。タグ・友だちリストの CSV インポート対応、リッチメニューも LINE API 経由で取り込み可能。並走期間 2 週間で安全に移行。',
  },
  {
    q: '業界規制 (薬機法・特商法) への対応は?',
    a: 'L-port チームが業界規制を熟知。配信文・AI 応答は NG ワード辞書 + AI 文脈判定で配信前にブロック。万一の場合の責任所在も契約書で明示します。',
  },
  {
    q: '解約はいつでも可能ですか?',
    a: '月単位の契約で、最低利用期間は 3 ヶ月 (Lite は 1 ヶ月)。3 ヶ月以降はいつでも解約可能、解約金は発生しません。解約時はトークン削除 + データ完全消去 (希望に応じて引き継ぎ書類提供)。',
  },
  {
    q: '料金以外に追加コストはありますか?',
    a: 'LINE 公式アカウント側の月額・配信料は別途お客様負担です (LINE 社への直接支払、L-port には入りません)。それ以外の追加料金は発生しません。',
  },
  {
    q: '配信本数が制限を超えたら?',
    a: 'プランの制限を超える場合は事前にご相談 → プランアップグレード or 単発オプション (1 配信 ¥3,000) で対応します。勝手に追加課金することはありません。',
  },
]

export default function LandingPage() {
  return (
    <div
      className="min-h-screen bg-[#FAFAF7] text-[#1A1A1A]"
      style={{
        fontFamily: '"Noto Sans JP", system-ui, sans-serif',
      }}
    >
      {/* フォントは @import (レンダリングブロッキング + 直列) をやめ、React 19 が <head> に
          hoist する stylesheet link で読み込む。head の preconnect と並行にフェッチされ初期表示が速い。 */}
      <link
        rel="stylesheet"
        precedence="high"
        href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700;800&family=Noto+Sans+JP:wght@400;500;600;700&display=swap"
      />
      <style dangerouslySetInnerHTML={{ __html: `
        .font-display { font-family: 'Shippori Mincho', serif; letter-spacing: -0.01em; }
        .num-display { font-family: 'Inter', system-ui, sans-serif; font-feature-settings: 'tnum'; letter-spacing: -0.04em; }
        .grad-text { background: linear-gradient(95deg, #10B981 0%, #06B6D4 50%, #3B82F6 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .grad-bg { background: linear-gradient(135deg, #10B981 0%, #06B6D4 50%, #3B82F6 100%); }
        .grad-border { background: linear-gradient(135deg, #10B981 0%, #3B82F6 100%); }
        .l-divider::before { content: ''; display: block; width: 32px; height: 2px; background: #0F1419; margin-bottom: 12px; }
      ` }} />

      {/* ── Nav (sticky, refined) ── */}
      <header className="sticky top-0 z-40 bg-[#FAFAF7]/90 backdrop-blur-md border-b border-[#1A1A1A]/8">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <Link href="/lp" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="L-port" className="w-9 h-9" />
            <span className="font-display text-lg font-bold tracking-tight">L-port</span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-[13px] text-[#1A1A1A]/70">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-[#1A1A1A] transition-colors">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/client/login" className="hidden md:inline-block text-[13px] text-[#1A1A1A]/70 hover:text-[#1A1A1A] px-3 py-1.5">
              お客様ログイン
            </Link>
            <a
              href="/lp/contact"
              className="text-[13px] bg-[#0F1419] hover:bg-[#1A1A1A] text-white px-4 py-2.5 rounded-full font-medium transition-colors"
            >
              無料相談 →
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-[#1A1A1A]/8">
        {/* Subtle gradient mesh background */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 30% 20%, #10B981 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 60%, #3B82F6 0%, transparent 60%)',
          }}
        />
        <div className="relative max-w-7xl mx-auto px-6 lg:px-10 pt-20 pb-24 lg:pt-28 lg:pb-32">
          {/* Editorial label */}
          <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] text-[#1A1A1A]/50 uppercase mb-8">
            <span className="w-8 h-px bg-[#1A1A1A]/30" />
            <span>Done-for-you LINE Operations</span>
          </div>

          {/* Headline (asymmetric, display 明朝 + grad accent) */}
          <h1 className="font-display text-[44px] sm:text-[60px] lg:text-[88px] font-bold leading-[1.05] tracking-tight max-w-5xl">
            LINE 運用、<br className="hidden sm:block" />
            <span className="grad-text">全部こちらが</span>やります。
          </h1>

          <p className="mt-8 max-w-2xl text-[16px] lg:text-[18px] text-[#1A1A1A]/70 leading-relaxed">
            運用代行の <span className="text-[#1A1A1A] font-medium">1/10 の月額</span> で、L-port チームが LINE 公式アカウントを全部運用。
            <br />
            お客様は <span className="text-[#1A1A1A] font-medium">月 30 分</span> レポートを見るだけ。AI を使うから安く、専属チームが運用するから成果が出る。
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a
              href="/lp/contact"
              className="inline-flex items-center gap-2 bg-[#0F1419] hover:bg-[#1A1A1A] text-white px-6 py-3.5 rounded-full text-[14px] font-medium transition-all"
            >
              無料相談を申し込む
              <span className="text-base">→</span>
            </a>
            <a
              href="#features"
              className="inline-flex items-center gap-2 text-[#1A1A1A] hover:text-[#1A1A1A]/60 px-6 py-3.5 rounded-full text-[14px] font-medium border border-[#1A1A1A]/15 hover:border-[#1A1A1A]/30 transition-colors"
            >
              機能を見る
            </a>
          </div>

          {/* Proof strip (numbers as design element) */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-y-8 gap-x-4 border-t border-[#1A1A1A]/10 pt-10">
            {[
              { n: '30', u: '分', l: 'お客様の月当たり作業時間' },
              { n: '5', u: '日', l: '導入から運用開始まで' },
              { n: '¥19,800', u: '〜', l: '月額 (運用代行比 1/10)' },
              { n: '24', u: 'h', l: 'AI 接客稼働' },
            ].map((s) => (
              <div key={s.l}>
                <div className="flex items-baseline gap-1">
                  <span className="num-display text-3xl lg:text-4xl font-bold text-[#0F1419]">{s.n}</span>
                  <span className="text-sm text-[#1A1A1A]/50">{s.u}</span>
                </div>
                <p className="text-[11px] text-[#1A1A1A]/50 mt-1 tracking-wider">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Problem (charcoal dark block — premium contrast) ── */}
      <section id="problem" className="bg-[#0F1419] text-white py-24 lg:py-32">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="grid lg:grid-cols-[1fr_2fr] gap-12 lg:gap-20 mb-16">
            <div>
              <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] text-white/40 uppercase mb-6">
                <span className="w-8 h-px bg-white/30" />
                <span>The Problem</span>
              </div>
              <h2 className="font-display text-3xl lg:text-5xl font-bold leading-[1.15] tracking-tight">
                現状の LINE 運用が、
                <br />
                抱えている 3 つの澱 (おり)。
              </h2>
            </div>
            <p className="text-base lg:text-lg text-white/60 leading-relaxed self-end">
              月 20 万円払って運用代行に丸投げ。L ステップで自分で運用。AI チャットボットで自動化。
              どれも入口は違っても、辿り着く悩みは似ています。
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-px bg-white/10 border border-white/10 rounded-2xl overflow-hidden">
            {PROBLEMS.map((p) => (
              <div key={p.num} className="bg-[#0F1419] p-8 lg:p-10">
                <div className="num-display text-5xl lg:text-6xl font-bold text-white/15 mb-6">{p.num}</div>
                <h3 className="font-display text-xl lg:text-2xl font-bold leading-snug mb-4 whitespace-pre-line">
                  {p.title}
                </h3>
                <p className="text-sm text-white/60 leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features (editorial spread, alternating) ── */}
      <section id="features" className="py-24 lg:py-32 bg-[#FAFAF7]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="mb-20 max-w-3xl">
            <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] text-[#1A1A1A]/50 uppercase mb-6">
              <span className="w-8 h-px bg-[#1A1A1A]/30" />
              <span>Features</span>
            </div>
            <h2 className="font-display text-3xl lg:text-5xl font-bold leading-[1.15] tracking-tight">
              「中の人」が AI に置き換わると、
              <br />
              ここまで変わります。
            </h2>
          </div>

          <div className="space-y-24 lg:space-y-32">
            {FEATURES.map((f, i) => (
              <div
                key={f.num}
                className={`grid lg:grid-cols-[2fr_3fr] gap-8 lg:gap-16 items-start ${
                  i % 2 === 1 ? 'lg:[&>div:first-child]:order-2' : ''
                }`}
              >
                <div>
                  <div className="num-display text-[11px] tracking-[0.25em] text-[#10B981] font-bold mb-4">
                    {f.num}
                  </div>
                  <h3 className="font-display text-2xl lg:text-4xl font-bold leading-snug tracking-tight whitespace-pre-line">
                    {f.title}
                  </h3>
                </div>
                <div className="lg:pt-12">
                  <p className="text-[15px] lg:text-base text-[#1A1A1A]/70 leading-relaxed mb-6">{f.lead}</p>
                  <ul className="space-y-3">
                    {f.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-3 text-sm text-[#1A1A1A]/80">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full grad-bg shrink-0" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Industries (compact grid with monogram marks) ── */}
      <section id="industries" className="py-24 lg:py-32 border-t border-[#1A1A1A]/8">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="mb-14 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] text-[#1A1A1A]/50 uppercase mb-6">
                <span className="w-8 h-px bg-[#1A1A1A]/30" />
                <span>Industries</span>
              </div>
              <h2 className="font-display text-3xl lg:text-5xl font-bold leading-[1.15] tracking-tight">
                業界別プレイブックを、
                <br />
                ワンクリックで投入。
              </h2>
            </div>
            <p className="text-sm text-[#1A1A1A]/60 max-w-md leading-relaxed">
              業界ごとの「言い回し / KPI / シナリオ」を事前に作り込み済み。
              <br />
              導入初日から、その業界の「中の人」レベルで動きます。
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-[#1A1A1A]/10 border border-[#1A1A1A]/10 rounded-2xl overflow-hidden">
            {INDUSTRIES.map((ind) => (
              <div key={ind.name} className="bg-[#FAFAF7] p-6 lg:p-8 group hover:bg-white transition-colors">
                <div className="flex items-start justify-between mb-6">
                  <div className="w-14 h-14 rounded-xl bg-[#0F1419] text-white font-display font-bold text-2xl flex items-center justify-center group-hover:grad-bg group-hover:scale-105 transition-all">
                    {ind.mark}
                  </div>
                  {ind.ready ? (
                    <span className="text-[10px] tracking-wider text-[#10B981] font-medium uppercase">Ready</span>
                  ) : (
                    <span className="text-[10px] tracking-wider text-[#1A1A1A]/40 font-medium uppercase">Soon</span>
                  )}
                </div>
                <h3 className="font-display font-bold text-lg mb-1.5">{ind.name}</h3>
                <p className="text-xs text-[#1A1A1A]/60 leading-relaxed">{ind.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Compare table (refined editorial) ── */}
      <section id="compare" className="py-24 lg:py-32 bg-white border-t border-[#1A1A1A]/8">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="mb-14 max-w-3xl">
            <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] text-[#1A1A1A]/50 uppercase mb-6">
              <span className="w-8 h-px bg-[#1A1A1A]/30" />
              <span>Comparison</span>
            </div>
            <h2 className="font-display text-3xl lg:text-5xl font-bold leading-[1.15] tracking-tight">
              L ステップ / 運用代行 と、
              <br />
              何が違うのか。
            </h2>
          </div>

          <div className="overflow-x-auto -mx-6 lg:mx-0">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b-2 border-[#0F1419]">
                  <th className="text-left py-5 px-4 lg:px-6 font-medium text-[#1A1A1A]/60 text-[11px] tracking-wider uppercase">
                    機能
                  </th>
                  <th className="text-center py-5 px-4 lg:px-6 font-medium text-[#1A1A1A]/60 text-[11px] tracking-wider uppercase">
                    L ステップ
                  </th>
                  <th className="text-center py-5 px-4 lg:px-6 font-medium text-[#1A1A1A]/60 text-[11px] tracking-wider uppercase">
                    運用代行
                  </th>
                  <th className="text-center py-5 px-4 lg:px-6 font-display text-base font-bold text-[#0F1419] bg-[#FAFAF7] border-x border-[#1A1A1A]/10 relative">
                    <span className="grad-text">L-port</span>
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 grad-bg text-white text-[9px] font-bold tracking-wider uppercase rounded-full">
                      Recommended
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((r) => (
                  <tr key={r.label} className={`border-b border-[#1A1A1A]/8 ${r.highlight ? 'bg-amber-50/40' : ''}`}>
                    <td className="py-4 px-4 lg:px-6 font-medium text-[#1A1A1A]">{r.label}</td>
                    <td className="py-4 px-4 lg:px-6 text-center text-[#1A1A1A]/50">{r.lstep}</td>
                    <td className="py-4 px-4 lg:px-6 text-center text-[#1A1A1A]/50">{r.agency}</td>
                    <td className="py-4 px-4 lg:px-6 text-center font-semibold text-[#0F1419] bg-[#FAFAF7] border-x border-[#1A1A1A]/10">
                      {r.lport}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Pricing (3 plans, asymmetric featured) ── */}
      <section id="pricing" className="py-24 lg:py-32 bg-[#FAFAF7] border-t border-[#1A1A1A]/8">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="mb-14 grid lg:grid-cols-2 gap-6 items-end">
            <div>
              <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] text-[#1A1A1A]/50 uppercase mb-6">
                <span className="w-8 h-px bg-[#1A1A1A]/30" />
                <span>Pricing</span>
              </div>
              <h2 className="font-display text-3xl lg:text-5xl font-bold leading-[1.15] tracking-tight">
                AI が回す代わり、
                <br />
                月額は人間運用の <span className="grad-text">1/10</span>。
              </h2>
            </div>
            <p className="text-sm text-[#1A1A1A]/60 lg:text-right">
              全プラン共通: 初回構築・チャット相談・月次レポート・全業種対応・1 アカウント運用
              <br />※ LINE 公式アカウント側の月額・配信料は別途
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {PRICING.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-2xl border p-8 transition-all ${
                  p.featured
                    ? 'border-transparent bg-[#0F1419] text-white scale-[1.02] shadow-2xl shadow-[#0F1419]/20'
                    : 'border-[#1A1A1A]/10 bg-white hover:border-[#1A1A1A]/20'
                }`}
              >
                {p.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 grad-bg text-white text-[10px] font-bold tracking-widest uppercase rounded-full">
                    Most Popular
                  </div>
                )}
                <div className={`text-[11px] tracking-widest uppercase mb-2 ${p.featured ? 'text-white/50' : 'text-[#1A1A1A]/50'}`}>
                  {p.target}
                </div>
                <h3 className={`font-display text-2xl font-bold mb-1 ${p.featured ? 'text-white' : 'text-[#0F1419]'}`}>
                  {p.name}
                </h3>
                <p className={`text-xs mb-6 ${p.featured ? 'text-white/60' : 'text-[#1A1A1A]/60'}`}>{p.pitch}</p>
                <div className="mb-7">
                  <span className={`text-xs ${p.featured ? 'text-white/60' : 'text-[#1A1A1A]/60'}`}>¥</span>
                  <span className={`num-display text-5xl font-bold ${p.featured ? 'text-white' : 'text-[#0F1419]'}`}>
                    {p.price}
                  </span>
                  <span className={`text-sm ml-1 ${p.featured ? 'text-white/60' : 'text-[#1A1A1A]/60'}`}>/ 月</span>
                </div>
                <ul className="space-y-2.5 mb-7">
                  {p.features.map((f) => (
                    <li key={f} className={`flex items-start gap-2 text-[13px] leading-relaxed ${p.featured ? 'text-white/85' : 'text-[#1A1A1A]/80'}`}>
                      <span className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${p.featured ? 'grad-bg' : 'bg-[#0F1419]'}`} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="/lp/contact"
                  className={`block text-center py-3 rounded-full text-sm font-medium transition-all ${
                    p.featured
                      ? 'bg-white text-[#0F1419] hover:bg-white/90'
                      : 'border border-[#0F1419] text-[#0F1419] hover:bg-[#0F1419] hover:text-white'
                  }`}
                >
                  このプランで相談
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── L-step Bridge (special highlight section) ── */}
      <section id="bridge" className="py-24 lg:py-32 bg-white border-t border-[#1A1A1A]/8 relative overflow-hidden">
        <div
          className="absolute right-0 top-0 w-1/2 h-full opacity-[0.04] pointer-events-none"
          style={{ background: 'linear-gradient(135deg, #10B981 0%, #3B82F6 100%)' }}
        />
        <div className="relative max-w-7xl mx-auto px-6 lg:px-10">
          <div className="grid lg:grid-cols-[1fr_1.5fr] gap-12 lg:gap-20 mb-14">
            <div>
              <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] text-[#1A1A1A]/50 uppercase mb-6">
                <span className="w-8 h-px bg-[#1A1A1A]/30" />
                <span>Bridge Mode</span>
              </div>
              <h2 className="font-display text-3xl lg:text-5xl font-bold leading-[1.15] tracking-tight">
                L ステップを <br />
                解約せずに <br />
                試せます。
              </h2>
            </div>
            <p className="text-base lg:text-lg text-[#1A1A1A]/70 leading-relaxed self-end">
              「移行リスクが怖い」「シナリオを再構築する余裕がない」 — そんな声に応えて、L-port は L ステップと並走できる Bridge モードを提供します。
              既存運用を止めずに AI 層だけ追加。効果が出てから完全移行を判断できます。
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-px bg-[#1A1A1A]/10 border border-[#1A1A1A]/10 rounded-2xl overflow-hidden">
            {BRIDGE_REASONS.map((b) => (
              <div key={b.num} className="bg-white p-8 lg:p-10">
                <div className="num-display text-5xl font-bold grad-text mb-4">{b.num}</div>
                <h3 className="font-display text-lg lg:text-xl font-bold mb-3 leading-snug">{b.title}</h3>
                <p className="text-sm text-[#1A1A1A]/60 leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Flow / Timeline ── */}
      <section id="flow" className="py-24 lg:py-32 bg-[#FAFAF7] border-t border-[#1A1A1A]/8">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="mb-14 max-w-3xl">
            <div className="flex items-center gap-3 text-[11px] tracking-[0.2em] text-[#1A1A1A]/50 uppercase mb-6">
              <span className="w-8 h-px bg-[#1A1A1A]/30" />
              <span>Onboarding</span>
            </div>
            <h2 className="font-display text-3xl lg:text-5xl font-bold leading-[1.15] tracking-tight">
              最短 5 日で、
              <br />
              「AI が運用を回している」状態へ。
            </h2>
          </div>
          <div className="relative">
            <div className="absolute left-[27px] top-3 bottom-3 w-px bg-[#1A1A1A]/15 hidden md:block" />
            <ul className="space-y-6">
              {FLOW.map((s, i) => (
                <li key={s.day} className="flex gap-5 md:gap-7 items-start">
                  <div className="shrink-0 w-14 h-14 rounded-full bg-white border-2 border-[#0F1419] text-[#0F1419] flex items-center justify-center font-display font-bold text-[11px] z-10 relative">
                    <span className="num-display">{s.day.replace('Day ', 'D')}</span>
                  </div>
                  <div className="flex-1 bg-white border border-[#1A1A1A]/10 rounded-2xl p-6 lg:p-7">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="num-display text-[10px] tracking-widest text-[#1A1A1A]/40 uppercase">
                        STEP {String(i + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <h3 className="font-display text-lg lg:text-xl font-bold mb-1.5">{s.title}</h3>
                    <p className="text-sm text-[#1A1A1A]/60 leading-relaxed">{s.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-24 lg:py-32 border-t border-[#1A1A1A]/8">
        <div className="max-w-4xl mx-auto px-6 lg:px-10">
          <div className="mb-14 text-center">
            <div className="inline-flex items-center gap-3 text-[11px] tracking-[0.2em] text-[#1A1A1A]/50 uppercase mb-6">
              <span className="w-8 h-px bg-[#1A1A1A]/30" />
              <span>FAQ</span>
              <span className="w-8 h-px bg-[#1A1A1A]/30" />
            </div>
            <h2 className="font-display text-3xl lg:text-5xl font-bold leading-[1.15] tracking-tight">
              よくあるご質問
            </h2>
          </div>
          <div className="divide-y divide-[#1A1A1A]/10 border-y border-[#1A1A1A]/10">
            {FAQS.map((f, i) => (
              <details key={i} className="group py-6">
                <summary className="flex items-start justify-between gap-6 cursor-pointer list-none">
                  <h3 className="font-display text-base lg:text-lg font-bold text-[#0F1419] leading-snug">
                    {f.q}
                  </h3>
                  <div className="shrink-0 w-7 h-7 rounded-full border border-[#0F1419] flex items-center justify-center group-open:rotate-45 transition-transform">
                    <span className="text-[#0F1419] text-sm">+</span>
                  </div>
                </summary>
                <p className="mt-4 text-sm text-[#1A1A1A]/70 leading-relaxed pr-12">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA (final) ── */}
      <section className="bg-[#0F1419] text-white py-24 lg:py-32">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 text-center">
          <div className="inline-flex items-center gap-3 text-[11px] tracking-[0.2em] text-white/40 uppercase mb-8">
            <span className="w-8 h-px bg-white/30" />
            <span>Get Started</span>
            <span className="w-8 h-px bg-white/30" />
          </div>
          <h2 className="font-display text-4xl lg:text-6xl font-bold leading-[1.1] tracking-tight mb-6">
            まずは <span className="grad-text">30 分の無料相談</span> から。
          </h2>
          <p className="text-base lg:text-lg text-white/60 max-w-2xl mx-auto leading-relaxed mb-10">
            事業内容と現状の運用を伺った上で、
            <br className="hidden sm:block" />
            L-port で何が変わるかをお見積りと合わせてお伝えします。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="/lp/contact"
              className="inline-flex items-center gap-2 bg-white text-[#0F1419] hover:bg-white/90 px-7 py-4 rounded-full text-[14px] font-medium transition-all"
            >
              無料相談を申し込む
              <span className="text-base">→</span>
            </a>
            <a
              href="#features"
              className="inline-flex items-center gap-2 text-white/80 hover:text-white px-6 py-4 rounded-full text-[14px] font-medium border border-white/20 hover:border-white/40 transition-colors"
            >
              機能をもう一度見る
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-[#0A0E13] text-white/60 py-14">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="grid md:grid-cols-4 gap-10 mb-10">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5 mb-4">
                <img src="/logo.png" alt="L-port" className="w-9 h-9 bg-white rounded-lg p-0.5" />
                <span className="font-display text-lg font-bold text-white">L-port</span>
              </div>
              <p className="text-sm leading-relaxed max-w-md">
                AI が「中の人」として 24h 動く、次世代 LINE 運用プラットフォーム。
              </p>
            </div>
            <div>
              <h4 className="text-white text-[11px] tracking-widest uppercase font-bold mb-4">サービス</h4>
              <ul className="space-y-2.5 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">機能</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">料金</a></li>
                <li><a href="#bridge" className="hover:text-white transition-colors">L ステップ移行</a></li>
                <li><a href="#faq" className="hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white text-[11px] tracking-widest uppercase font-bold mb-4">お問い合わせ</h4>
              <ul className="space-y-2.5 text-sm">
                <li><a href="/lp/contact" className="hover:text-white transition-colors">無料相談</a></li>
                <li><Link href="/login" className="hover:text-white transition-colors">管理画面ログイン</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between gap-4 text-xs">
            <span className="text-white/40">© {new Date().getFullYear()} L-port</span>
            <span className="text-white/40">LINE は LINE 株式会社の登録商標です</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
