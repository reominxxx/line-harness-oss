// 動的ルートは Next.js static export では使用不可なので、
// /c?id=... のクエリパラメータ版 (/c/page.tsx) にリダイレクトする。
// このファイルは generateStaticParams で空配列を返してビルドを通すためだけのプレースホルダ。

export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default async function CouponLegacyRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="text-center">
        <p className="text-sm text-gray-500 mb-2">読み込み中…</p>
        <noscript>JavaScript を有効にしてください</noscript>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                var path = window.location.pathname;
                var match = path.match(/\\/c\\/([^/?]+)/);
                if (match && match[1] && match[1] !== 'placeholder') {
                  var search = window.location.search || '';
                  var sep = search ? '&' : '?';
                  window.location.replace('/c' + search + sep + 'id=' + encodeURIComponent(match[1]));
                }
              })();
            `,
          }}
        />
        <p className="text-xs text-gray-400 mt-4">id: {id}</p>
      </div>
    </div>
  )
}
