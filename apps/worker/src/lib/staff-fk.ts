/**
 * staff_members への外部キー用の安全な ID を返す。
 *
 * middleware/auth.ts で env.API_KEY 認証時に c.set('staff', { id: 'env-owner', ... }) を
 * セットするが、'env-owner' は staff_members テーブルに実レコードが無い疑似 ID。
 * これを FK カラム（created_by / author_id / reviewer_id / processed_by 等）に
 * そのまま入れると FOREIGN KEY 違反で 500 になる。
 *
 * このヘルパーを通すと、env-owner は null に置換され、実 staff の場合だけ ID が残る。
 */

export function staffIdForFk(staff: { id: string } | null | undefined): string | null {
  if (!staff?.id) return null;
  if (staff.id === 'env-owner') return null;
  return staff.id;
}
