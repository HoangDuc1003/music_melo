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
