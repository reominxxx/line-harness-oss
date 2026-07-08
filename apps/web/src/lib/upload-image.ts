/**
 * 生成・アップロードされた画像 File を R2 公開 URL に変換するヘルパー。
 *
 * AiImageGenerateModal の onSelect で受け取った File は、まだクライアント側に
 * しかいない (data URL)。これを `/api/images` にPOST して R2 に保存し、
 * <img src> でブラウザから取れる公開 URL を返す。
 */

export async function uploadGeneratedImageToR2(file: File): Promise<string> {
  const reader = new FileReader()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
  const res = await fetch(`${apiUrl}/api/images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ data: dataUrl, mimeType: file.type, filename: file.name }),
  })
  const json = (await res.json()) as { success: boolean; data?: { url: string }; error?: string }
  if (!res.ok || !json.success || !json.data?.url) {
    throw new Error(json.error ?? '画像アップロードに失敗しました')
  }
  return json.data.url
}
