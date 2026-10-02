// Chuẩn hoá chữ dùng chung: so khớp tên bài (lời bài hát, đồng bộ Spotify, tìm kiếm mẫu).

/** Chữ thường, bỏ dấu, bỏ ký tự đặc biệt: "Sơn Tùng M-TP" → "son tung m tp". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Bỏ phần thừa trong tên bài YouTube: "(Official Video)", "[MV]", "| Lyrics", "ft. …". */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([【](official|lyrics?|mv|m\/v|audio|video|visuali[sz]er|live|4k|hd|karaoke|vietsub|lyric video|official music video|official audio)[^)\]】]*[)\]】]/gi, '')
    .replace(/\s*[|｜].*$/, '')
    .replace(/\s+(ft\.?|feat\.?|featuring)\s.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Bỏ hậu tố " - Topic" của kênh nghệ sĩ tự tạo. */
export function cleanArtist(name: string): string {
  return name.replace(/\s+-\s+Topic$/i, '').trim();
}

/** Độ giống nhau 0..1 theo từ (hệ số Dice); chuỗi này nằm trọn trong chuỗi kia thì ≥ 0.9. */
export function similarity(a: string, b: string): number {
  const A = fold(a);
  const B = fold(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const ta = A.split(' ');
  const tb = B.split(' ');
  const pool = new Map<string, number>();
  for (const t of tb) pool.set(t, (pool.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of ta) {
    const left = pool.get(t) ?? 0;
    if (left > 0) {
      common += 1;
      pool.set(t, left - 1);
    }
  }
  const dice = (2 * common) / (ta.length + tb.length);
  const contained = ` ${B} `.includes(` ${A} `) || ` ${A} `.includes(` ${B} `);
  return contained ? Math.max(dice, 0.9) : dice;
}
