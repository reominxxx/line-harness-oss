// 削除済み機能 — リダイレクト
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default async function HearingLegacyRemoved() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-gray-500">この機能は削除されました</p>
        <script dangerouslySetInnerHTML={{ __html: `window.location.replace('/broadcasts');` }} />
      </div>
    </div>
  )
}
