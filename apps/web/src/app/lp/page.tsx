import Link from 'next/link'

const NAV_LINKS = [
  { href: '#features', label: '機能' },
  { href: '#industries', label: '業界別対応' },
  { href: '#compare', label: '比較' },
  { href: '#pricing', label: '料金' },
  { href: '#bridge', label: 'L ステップ連携' },
  { href: '#flow', label: '導入の流れ' },
  { href: '#faq', label: 'FAQ' },
]

const PAINS = [
  { icon: '💸', title: '月 20 万円の運用代行費が重い', body: '成果が見えづらいまま、毎月固定費だけが膨らんでいる。' },
  { icon: '🌙', title: '24h お客様対応で時間がない', body: '夜中の問い合わせや予約確認に追われ、肝心の事業に集中できない。' },
  { icon: '🪫', title: '配信ネタが毎月切れる', body: '「今月何を送ろう」で時間を溶かし、似たような配信の繰り返しになる。' },
  { icon: '🗣️', title: '業界トーンが分からない代行に任せている', body: '美容/整体/EC など、業界特有の言い回しを理解しない外注に高額を払い続けている。' },
  { icon: '🚫', title: 'BAN リスクで夜眠れない', body: 'メッセージ単価上昇・通報リスクなど、運用ミスで凍結される不安が常にある。' },
  { icon: '📉', title: '効果測定ができていない', body: '誰が買いそうか、誰が休眠しているか、肌感覚でしか分からない。' },
]

const FEATURES = [
  {
    badge: '01',
    title: 'AI 接客チャット',
    sub: '24h 自動応答 × 業界トーン制御',
    points: [
      '深夜・早朝でも自然な日本語で自動応答',
      '業界別の敬語・トーン・専門用語まで完全カスタム',
      'クレーム・複雑要件は人間にエスカレーション',
      'ナレッジベース連携で「うちのお店だけの回答」を生成',
    ],
  },
  {
    badge: '02',
    title: 'AI 配信案作成',
    sub: 'KPI から逆算した自動配信',
    points: [
      '月初に「今月 8 本」と決めるだけで AI が配信案を自動生成',
      '業界別のネタ循環（季節 / イベント / お客様の声 等）',
      '配信時間も過去データから自動最適化',
      'ワンタップ承認で予約配信まで完結',
    ],
  },
  {
    badge: '03',
    title: 'AI 顧客分析・レポート',
    sub: '"今すぐ買いそうな人" を自動抽出',
    points: [
      'インテントスコアで HOT/WARM/COLD を自動判定',
      'HOT リードを LINE に即時通知',
      '休眠顧客への掘り起こし文面も自動作成',
      '月次レポートを毎月 1 日に自動送付',
    ],
  },
]

const INDUSTRIES = [
  { emoji: '💇', name: '美容', sub: '美容室・ネイル・エステ・まつげ', ready: true },
  { emoji: '🧘', name: '整体', sub: '整体・治療院・パーソナルジム', ready: true },
  { emoji: '🛍️', name: 'EC・物販', sub: 'D2C ブランド・Shopify 店舗', ready: true },
  { emoji: '🎓', name: 'スクール', sub: '習い事・塾・オンライン教室', ready: true },
  { emoji: '⚖️', name: '士業', sub: '弁護士・税理士・司法書士', ready: true },
  { emoji: '🍴', name: '飲食', sub: 'カフェ・居酒屋・レストラン', ready: false },
]

const COMPARE_ROWS: Array<{ label: string; lstep: string; agency: string; lassist: string; highlight?: boolean }> = [
  { label: '月額', lstep: '¥21,780〜', agency: '¥150,000〜250,000', lassist: '¥39,800〜', highlight: true },
  { label: '24h AI 自動応答', lstep: '✕', agency: '✕（営業時間内のみ）', lassist: '◯', highlight: true },
  { label: '配信文の AI 自動作成', lstep: '✕', agency: '△（人手依存）', lassist: '◯' },
  { label: '業界トーンの完全制御', lstep: '✕', agency: '△（代行者依存）', lassist: '◯' },
  { label: '月次レポート自動生成', lstep: '✕', agency: '◯（手作業）', lassist: '◯（自動）' },
  { label: 'BAN リスク検知', lstep: '✕', agency: '✕', lassist: '◯' },
  { label: 'マルチアカウント運用', lstep: '別契約', agency: '別契約', lassist: '◯' },
  { label: '導入までの期間', lstep: '2〜4 週間', agency: '1〜2 ヶ月', lassist: '最短 5 日' },
  { label: 'ベンダーロックイン', lstep: '中', agency: '高', lassist: '低（OSS ベース）' },
]

const BRIDGE_PLANS: Array<{
  name: string
  subtitle: string
  price: string
  totalPrice: string
  features: readonly string[]
  featured?: boolean
}> = [
  {
    name: 'Lite Bridge',
    subtitle: 'AI 接客プラン',
    price: '19,800',
    totalPrice: '52,580',
    features: [
      '✅ L ステップ API 連携',
      '✅ AI 接客 24h 自動応答（月 500 件）',
      '✅ 月次レポート',
      '✅ 月 1 回 運用相談（30 分）',
    ],
  },
  {
    name: 'Standard Bridge',
    subtitle: 'AI フル機能プラン',
    price: '39,800',
    totalPrice: '72,580',
    features: [
      '✅ Lite Bridge 全機能',
      '✅ AI 接客 月 2,000 件',
      '✅ AI 配信案 月 8 本（L ステップ経由）',
      '✅ 配信前の業界専門家レビュー',
      '✅ 業界プレイブック フルセット',
    ],
    featured: true,
  },
  {
    name: 'Pro Bridge',
    subtitle: '完全運用代行プラン',
    price: '79,800',
    totalPrice: '112,580',
    features: [
      '✅ Standard Bridge 全機能',
      '✅ AI 接客 月 5,000 件',
      '✅ AI 配信案 月 12 本（完全代行）',
      '✅ L ステップのシナリオ最適化',
      '✅ 月 2 回 戦略 MTG',
    ],
  },
]

const PLANS = [
  {
    name: 'Starter',
    subtitle: '標準運用代行プラン',
    price: '39,800',
    target: '個人店舗・スモールビジネス',
    description: '基本機能をすべてお任せしたい方向け',
    features: [
      '✅ 初期セットアップ代行（業界プレイブック適用）',
      '✅ AI 接客チャット 24h 自動応答',
      '✅ AI 配信案の自動生成・配信代行',
      '✅ 月次レポート 自動生成',
    ],
    cta: '無料相談する',
    featured: false,
  },
  {
    name: 'Pro',
    subtitle: '品質保証 + 戦略運用プラン',
    price: '98,000',
    target: '中堅・成長フェーズ',
    description: '配信品質と戦略的な運用改善を求める方向け（一番人気）',
    features: [
      '✅ Starter 全機能',
      '✅ **配信前の業界専門家レビュー**（AI 案を必ず目視チェック）',
      '✅ **プロンプトモジュールの月次最適化**',
      '✅ **業界プレイブックの個別カスタマイズ**',
      '✅ 月次レポートの解説（MTG 内）',
      '✅ **API 連携 1 つ**（Shopify / Square / Stripe / Google カレンダー等、API 提供ツール）',
    ],
    cta: '無料相談する',
    featured: true,
  },
  {
    name: 'Enterprise',
    subtitle: 'カスタム設計 + DB 連携プラン',
    price: '198,000〜',
    target: 'EC・D2C・法人・専門業種',
    description: 'DB 連携や業界カスタム設計が必要な事業向け（個別見積もり）',
    features: [
      '✅ Pro 全機能',
      '✅ **業界カスタムプレイブック設計**（既存業種で対応困難な業界をゼロから構築）',
      '✅ **外部 DB / API 連携**（連携可否は事前ヒアリングで判定）',
      '✅ **A/B テスト設計・実施・分析**',
      '✅ **売上連動レポート**（CV / LTV / ROAS 分析）',
      '✅ プロンプト継続調整（必要時随時）',
    ],
    cta: '相談する',
    featured: false,
  },
]

const FLOW = [
  { day: 'Day 1', title: 'キックオフ MTG', body: '30 分で事業内容・現状ヒアリング。LINE 公式アカウントへ接続。' },
  { day: 'Day 2', title: 'プレイブック適用', body: '業界別の AI プロンプト・KPI・シナリオをワンクリック投入。' },
  { day: 'Day 3', title: 'ナレッジ構築', body: 'メニュー / FAQ / トーンガイドを登録（既存資料をそのままアップ可）。' },
  { day: 'Day 5', title: '初回配信レビュー', body: 'AI が作った配信案を確認 → 承認 → 配信開始。' },
  { day: 'Day 7', title: '本格運用開始', body: '初週レポートを確認しながら、AI が回す日常運用に移行。' },
]

const FAQS = [
  {
    q: 'AI の応答品質は本当に大丈夫ですか？',
    a: '業界別プレイブックとナレッジベースで、お店の世界観に合わせて精度を制御します。初週はレビュー必須にすることで品質を担保しつつ、AI を「学習」させていきます。不適切応答が出るケースはエスカレ条件で人手に切り替わるので、お客様に届く前に止められます。',
  },
  {
    q: '既存の L ステップから移行できますか？',
    a: 'はい、移行サポートを提供しています。シナリオ・タグ・配信履歴・友だちリストをエクスポートして L-アシスト に取り込めます。並走期間（2 週間）を設けることもできます。',
  },
  {
    q: '業界規制（薬機法・特商法）への対応は？',
    a: '配信文・自動応答に対する規制チェック機能を内蔵しています。NG ワード辞書 + AI による文脈判定で、リスクのある文言は配信前にブロック・修正提案します。',
  },
  {
    q: '解約はいつでも可能ですか？',
    a: '月単位の契約で、最低利用期間は 3 ヶ月（Lite は 1 ヶ月）です。3 ヶ月以降はいつでも解約可能で、解約金は発生しません。',
  },
  {
    q: '料金以外に追加コストはありますか？',
    a: 'LINE 公式アカウント側の月額・配信料は別途お客様負担です（プラン内に LINE 料金は含まれません）。それ以外の追加料金は発生しません。',
  },
  {
    q: 'データのセキュリティはどうなっていますか？',
    a: 'Cloudflare の暗号化されたインフラ上で運用し、お客様の個人情報は自動的にマスキングされた上で AI に渡されます。お客様データの AI 学習への利用は一切ありません。',
  },
  {
    q: '自分の業界のプレイブックがまだ無いのですが？',
    a: '美容・整体は実装済み、EC・スクール・士業・飲食は順次リリース予定です。先行導入のご相談を頂ければ、業界カスタムプレイブックを優先的に整備します。',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "'Noto Sans JP', system-ui, sans-serif" }}>
      {/* ── Nav ── */}
      <header className="sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link href="/lp" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center text-white font-bold text-sm">L</div>
            <span className="font-semibold tracking-tight">L-アシスト</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-slate-900 transition-colors">{l.label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden md:inline-block text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5">ログイン</Link>
            <a href="/lp/contact" className="text-sm bg-slate-900 hover:bg-slate-700 text-white px-4 py-2 rounded-md font-medium transition-colors">無料相談</a>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-100" />
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-50" />
        <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-emerald-100 rounded-full blur-3xl opacity-40" />
        <div className="relative max-w-6xl mx-auto px-5 pt-20 pb-24 lg:pt-28 lg:pb-32 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 shadow-sm text-xs text-slate-600 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            業界初・AI エージェント型 LINE 運用プラットフォーム
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight mb-6">
            月 20 万円の運用代行を、<br className="hidden md:block" />
            <span className="bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">AI が月 39,800 円で。</span>
          </h1>
          <p className="text-base md:text-lg text-slate-600 max-w-2xl mx-auto mb-10 leading-relaxed">
            LINE 公式アカウントの配信・接客・分析を、24 時間 AI が「中の人」として代行。<br />
            L ステップ + 運用代行会社を 1 つに置き換える、次世代 LINE 運用プラットフォーム。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
            <a href="/lp/contact" className="bg-slate-900 hover:bg-slate-700 text-white px-8 py-3.5 rounded-md font-medium text-base transition-colors shadow-sm">
              30 分の無料相談を予約する →
            </a>
            <a href="#features" className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-900 px-8 py-3.5 rounded-md font-medium text-base transition-colors">
              できることを見る
            </a>
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
            <span>✓ 最短 5 日で導入</span>
            <span>✓ 既存 L ステップから移行可</span>
            <span>✓ 解約金なし</span>
            <span>✓ 業界別プレイブック標準搭載</span>
          </div>
        </div>
      </section>

      {/* ── Pain ── */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-12">
            <p className="text-sm text-slate-500 mb-2">— こんなお悩みありませんか？ —</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">LINE 運用、ぜんぶ自分で抱えていませんか</h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PAINS.map((p) => (
              <div key={p.title} className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl mb-3">{p.icon}</div>
                <h3 className="font-semibold mb-2">{p.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="text-center mt-10 text-slate-700">
            それ全部、<span className="font-bold text-slate-900">L-アシストの AI が代わりに動きます。</span>
          </p>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-14">
            <p className="text-sm text-slate-500 mb-2">— 主な機能 —</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">3 つの AI が、24 時間あなたの代わりに動く</h2>
            <p className="text-slate-600">月初に目標を決めるだけ。あとは AI が分解・実行・改善まで全部やります。</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div key={f.badge} className="bg-gradient-to-br from-white to-slate-50 rounded-2xl p-7 border border-slate-200 shadow-sm hover:shadow-lg transition-all">
                <div className="text-xs font-mono text-slate-400 mb-3">{f.badge}</div>
                <h3 className="text-xl font-bold mb-1">{f.title}</h3>
                <p className="text-sm text-slate-500 mb-5">{f.sub}</p>
                <ul className="space-y-2.5">
                  {f.points.map((p) => (
                    <li key={p} className="flex gap-2 text-sm text-slate-700">
                      <span className="text-emerald-600 shrink-0 mt-0.5">✓</span>
                      <span className="leading-relaxed">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-14 bg-slate-900 text-white rounded-2xl p-8 md:p-10 text-center">
            <p className="text-sm text-slate-400 mb-2">— その他、こんなこともできます —</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 text-sm">
              {[
                'ホットリード自動通知', 'BAN リスク検知', 'シナリオ自動最適化', '休眠掘り起こし配信',
                'タグ自動付与', 'リッチメニュー連携', '予約フォーム LIFF', '誕生日メッセージ',
                'NPS 計測', '監査ログ', 'PII 自動マスキング', 'マルチアカウント',
              ].map((t) => (
                <div key={t} className="bg-white/5 rounded-md py-2.5 px-3 border border-white/10">{t}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Industries ── */}
      <section id="industries" className="py-24 bg-slate-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-14">
            <p className="text-sm text-slate-500 mb-2">— 業界別対応 —</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">あなたの業界、AI がもう知っています</h2>
            <p className="text-slate-600">業界別のプレイブック（プロンプト・KPI・シナリオ・敬語レベル）をワンクリックで適用。</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {INDUSTRIES.map((i) => (
              <div key={i.name} className="bg-white rounded-xl p-6 border border-slate-200 relative">
                <div className="text-4xl mb-3">{i.emoji}</div>
                <h3 className="font-bold text-lg mb-1">{i.name}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{i.sub}</p>
                <div className="absolute top-4 right-4">
                  {i.ready ? (
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">提供中</span>
                  ) : (
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">準備中</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-slate-500 mt-8">
            ※ 上記以外の業界も、ヒアリングの上でカスタムプレイブックを構築可能です
          </p>
        </div>
      </section>

      {/* ── Compare ── */}
      <section id="compare" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-14">
            <p className="text-sm text-slate-500 mb-2">— 既存サービスとの比較 —</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">L ステップ / 運用代行と何が違う？</h2>
          </div>
          <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left py-4 px-5 font-medium text-slate-700"></th>
                  <th className="text-center py-4 px-5 font-medium text-slate-600">L ステップ</th>
                  <th className="text-center py-4 px-5 font-medium text-slate-600">運用代行（人手）</th>
                  <th className="text-center py-4 px-5 font-bold text-slate-900 bg-gradient-to-b from-slate-100 to-white">
                    L-アシスト
                    <div className="text-[10px] font-normal text-emerald-700 mt-0.5">おすすめ</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {COMPARE_ROWS.map((r) => (
                  <tr key={r.label} className={r.highlight ? 'bg-amber-50/30' : ''}>
                    <td className="py-3.5 px-5 font-medium text-slate-700">{r.label}</td>
                    <td className="py-3.5 px-5 text-center text-slate-500">{r.lstep}</td>
                    <td className="py-3.5 px-5 text-center text-slate-500">{r.agency}</td>
                    <td className="py-3.5 px-5 text-center font-semibold text-slate-900 bg-slate-50/50">{r.lassist}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24 bg-slate-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-14">
            <p className="text-sm text-slate-500 mb-2">— 料金プラン —</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">業務範囲で 3 プラン</h2>
            <p className="text-slate-600">運用代行を完全に置き換えても、月 39,800 円〜。AI なので 24h 稼働します。</p>
            <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-full text-xs text-slate-700">
              <span className="text-slate-900 font-semibold">全プラン共通:</span>
              <span>月 1 回の戦略 MTG (Zoom 30 分) / LINE 随時サポート / 全業種対応 / 1 LINE 公式アカウントあたり 1 契約</span>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-2xl p-7 border ${
                  p.featured
                    ? 'bg-gradient-to-br from-slate-900 to-slate-800 text-white border-slate-900 shadow-xl scale-105'
                    : 'bg-white border-slate-200 shadow-sm'
                }`}
              >
                {p.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-slate-900 text-[11px] font-bold px-3 py-1 rounded-full">
                    人気
                  </div>
                )}
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className={`text-xl font-bold ${p.featured ? 'text-white' : 'text-slate-900'}`}>{p.name}</h3>
                  <span className={`text-xs ${p.featured ? 'text-slate-300' : 'text-slate-500'}`}>{p.subtitle}</span>
                </div>
                <p className={`text-xs mb-1 ${p.featured ? 'text-slate-300' : 'text-slate-500'}`}>{p.target}</p>
                {p.description && (
                  <p className={`text-[11px] leading-relaxed mt-2 ${p.featured ? 'text-slate-300/80' : 'text-slate-500'}`}>
                    {p.description}
                  </p>
                )}
                <div className="mt-5 mb-6">
                  <span className={`text-xs ${p.featured ? 'text-slate-300' : 'text-slate-500'}`}>¥</span>
                  <span className={`text-4xl font-bold tabular-nums ${p.featured ? 'text-white' : 'text-slate-900'}`}>{p.price}</span>
                  <span className={`text-sm ml-1 ${p.featured ? 'text-slate-300' : 'text-slate-500'}`}>/ 月</span>
                </div>
                <ul className="space-y-2 mb-7">
                  {p.features.map((f) => (
                    <li
                      key={f}
                      className={`text-xs leading-relaxed ${p.featured ? 'text-slate-200' : 'text-slate-700'}`}
                      dangerouslySetInnerHTML={{
                        __html: f.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>'),
                      }}
                    />
                  ))}
                </ul>
                <a
                  href="/lp/contact"
                  className={`block text-center py-3 rounded-md font-medium text-sm transition-colors ${
                    p.featured
                      ? 'bg-white text-slate-900 hover:bg-slate-100'
                      : 'bg-slate-900 text-white hover:bg-slate-700'
                  }`}
                >
                  {p.cta}
                </a>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-slate-500 mt-8">
            ※ 表示価格はすべて税抜です。LINE 公式アカウントの月額・配信料は別途お客様ご負担となります。
          </p>
        </div>
      </section>

      {/* ── Bridge Plans (L ステップ連携) ── */}
      <section id="bridge" className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-800 mb-4">
              <span>🔗</span>
              L ステップ既存ユーザー向け
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
              L ステップを使い続けたまま、<br className="hidden md:block" />
              AI 機能だけ追加できます
            </h2>
            <p className="text-slate-600 leading-relaxed">
              既存の L ステップ運用は維持。AI 接客 / AI 配信 / 自動レポート だけ L-アシスト から追加。<br />
              移行コストゼロで、すぐ AI 化が始められます。
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {BRIDGE_PLANS.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-2xl p-6 border ${
                  p.featured
                    ? 'bg-gradient-to-br from-slate-900 to-slate-800 text-white border-slate-900 shadow-lg scale-105'
                    : 'bg-white border-slate-200 shadow-sm'
                }`}
              >
                {p.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-slate-900 text-[11px] font-bold px-3 py-1 rounded-full">
                    人気
                  </div>
                )}
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className={`text-lg font-bold ${p.featured ? 'text-white' : 'text-slate-900'}`}>{p.name}</h3>
                </div>
                <p className={`text-xs mb-4 ${p.featured ? 'text-slate-300' : 'text-slate-500'}`}>{p.subtitle}</p>

                <div className="mb-4">
                  <div className={`text-[11px] ${p.featured ? 'text-slate-400' : 'text-slate-500'}`}>L-アシスト 月額</div>
                  <div className="flex items-baseline">
                    <span className={`text-xs ${p.featured ? 'text-slate-300' : 'text-slate-500'}`}>¥</span>
                    <span className={`text-3xl font-bold tabular-nums ${p.featured ? 'text-white' : 'text-slate-900'}`}>{p.price}</span>
                    <span className={`text-xs ml-1 ${p.featured ? 'text-slate-300' : 'text-slate-500'}`}>/ 月</span>
                  </div>
                </div>

                <div className={`text-[11px] p-2.5 rounded mb-4 ${p.featured ? 'bg-white/10 text-slate-200' : 'bg-slate-50 text-slate-600'}`}>
                  + L ステップ プロ ¥32,780<br />
                  <span className={`font-semibold ${p.featured ? 'text-white' : 'text-slate-900'}`}>
                    顧客負担合計 ¥{p.totalPrice} / 月
                  </span>
                </div>

                <ul className="space-y-1.5 mb-5">
                  {p.features.map((f) => (
                    <li
                      key={f}
                      className={`text-xs leading-relaxed ${p.featured ? 'text-slate-200' : 'text-slate-700'}`}
                    >
                      {f}
                    </li>
                  ))}
                </ul>

                <a
                  href="/lp/contact"
                  className={`block text-center py-2.5 rounded-md font-medium text-xs transition-colors ${
                    p.featured
                      ? 'bg-white text-slate-900 hover:bg-slate-100'
                      : 'bg-slate-900 text-white hover:bg-slate-700'
                  }`}
                >
                  無料相談する
                </a>
              </div>
            ))}
          </div>

          <div className="mt-10 grid md:grid-cols-3 gap-4 text-xs">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <div className="font-semibold text-emerald-900 mb-1">🔄 移行不要</div>
              <p className="text-emerald-800 leading-relaxed">既存のシナリオ・タグ・配信履歴はそのまま維持。L ステップを使い続けられます。</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="font-semibold text-blue-900 mb-1">💰 大幅コスト削減</div>
              <p className="text-blue-800 leading-relaxed">「L ステップ + 運用代行 ¥20 万」から年 100〜200 万円削減できる事例多数。</p>
            </div>
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
              <div className="font-semibold text-violet-900 mb-1">⚡ 最短 3 日で稼働</div>
              <p className="text-violet-800 leading-relaxed">L ステップ API トークンを発行いただくだけで連携完了。学習コストゼロ。</p>
            </div>
          </div>

          <p className="text-center text-xs text-slate-500 mt-8">
            ※ L ステップ API は L ステップ プロプラン（¥32,780/月）以上が必要です
          </p>
        </div>
      </section>

      {/* ── Flow ── */}
      <section id="flow" className="py-24 bg-white">
        <div className="max-w-5xl mx-auto px-5">
          <div className="text-center mb-14">
            <p className="text-sm text-slate-500 mb-2">— 導入の流れ —</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">最短 5 日で「AI が運用を回している」状態に</h2>
            <p className="text-slate-600">複雑な設定も、業界プレイブックでワンクリックで完了します。</p>
          </div>
          <div className="relative">
            <div className="absolute left-[27px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-slate-300 to-slate-200 hidden md:block" />
            <ul className="space-y-5">
              {FLOW.map((s, i) => (
                <li key={s.day} className="flex gap-5 md:gap-7 items-start">
                  <div className="shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-slate-800 to-slate-600 text-white flex items-center justify-center font-bold text-xs shadow-md z-10">
                    {s.day}
                  </div>
                  <div className="flex-1 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-slate-400">STEP {i + 1}</span>
                    </div>
                    <h3 className="font-bold text-lg mb-1">{s.title}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-24 bg-slate-50">
        <div className="max-w-3xl mx-auto px-5">
          <div className="text-center mb-12">
            <p className="text-sm text-slate-500 mb-2">— よくあるご質問 —</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">FAQ</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <details key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden group">
                <summary className="cursor-pointer px-6 py-4 font-medium text-slate-900 flex items-center justify-between list-none hover:bg-slate-50">
                  <span className="flex gap-3 items-start">
                    <span className="text-slate-400 font-mono text-sm shrink-0 mt-0.5">Q.</span>
                    <span>{f.q}</span>
                  </span>
                  <span className="text-slate-400 text-xl shrink-0 transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-5 pt-1 text-sm text-slate-600 leading-relaxed">
                  <div className="flex gap-3">
                    <span className="text-emerald-600 font-mono text-sm shrink-0">A.</span>
                    <span>{f.a}</span>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section id="cta" className="py-24 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="relative max-w-3xl mx-auto px-5 text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-5 leading-tight">
            30 分の無料相談で、<br />あなたの事業に合うか確認しませんか？
          </h2>
          <p className="text-slate-300 mb-10 leading-relaxed">
            導入を強引に勧めることは一切ありません。<br />
            「うちの業界で本当に成立するか」「いくらコストが下がるか」を、その場で算出します。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/lp/contact" className="bg-white text-slate-900 hover:bg-slate-100 px-8 py-4 rounded-md font-bold text-base transition-colors shadow-lg">
              📅 無料相談を予約する
            </Link>
            <a href="mailto:info@yohaku.co" className="bg-white/10 hover:bg-white/15 border border-white/20 text-white px-8 py-4 rounded-md font-medium text-base transition-colors backdrop-blur">
              ✉️ メールで資料請求
            </a>
          </div>
          <p className="text-xs text-slate-400 mt-8">通常 1 営業日以内にご返信いたします</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-slate-950 text-slate-400 py-12">
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-500 flex items-center justify-center text-white font-bold text-sm">L</div>
                <span className="font-semibold text-white">L-アシスト</span>
              </div>
              <p className="text-sm leading-relaxed">
                AI が「中の人」として 24h 動く、<br />
                次世代 LINE 運用プラットフォーム
              </p>
            </div>
            <div>
              <h4 className="text-white text-sm font-semibold mb-3">サービス</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white">機能</a></li>
                <li><a href="#pricing" className="hover:text-white">料金プラン</a></li>
                <li><a href="#industries" className="hover:text-white">業界別対応</a></li>
                <li><a href="#flow" className="hover:text-white">導入の流れ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white text-sm font-semibold mb-3">サポート</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#faq" className="hover:text-white">よくあるご質問</a></li>
                <li><a href="mailto:info@yohaku.co" className="hover:text-white">お問い合わせ</a></li>
                <li><Link href="/login" className="hover:text-white">ログイン</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-6 flex flex-col md:flex-row justify-between text-xs">
            <p>© 2026 L-アシスト. All rights reserved.</p>
            <div className="flex gap-4 mt-3 md:mt-0">
              <a href="#" className="hover:text-white">利用規約</a>
              <a href="#" className="hover:text-white">プライバシーポリシー</a>
              <a href="#" className="hover:text-white">特定商取引法に基づく表記</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
