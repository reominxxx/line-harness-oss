// 未使用。無料診断の LIFF 引き継ぎは worker クライアント (apps/worker/src/client/main.ts
// の ?page=diagnosis) 側で実装している。本番 LIFF は apps/liff ではなく worker が配信するため、
// このファイルはルーティングから外してある（削除可）。
export default function Diagnosis() {
  return null;
}
