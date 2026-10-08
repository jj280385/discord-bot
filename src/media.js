import sharp from 'sharp';

/**
 * Normalise every image to JPEG: Instagram only accepts JPEG, and the review
 * message re-hosts these files so Meta can fetch them from a public URL.
 */
export async function toJpeg(buffer) {
  const img = sharp(buffer, { animated: false }).rotate();
  const data = await img
    .resize({ width: 1440, withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const { width, height } = await sharp(data).metadata();
  return { data, width, height };
}

/** Instagram rejects images outside 4:5 (portrait) to 1.91:1 (landscape). */
export function igAspectWarning({ width, height }, index) {
  const ratio = width / height;
  if (ratio < 0.8 - 0.01 || ratio > 1.91 + 0.01) {
    return `第 ${index + 1} 張圖比例 ${width}×${height} 超出 IG 允許範圍（4:5～1.91:1），IG 可能會發布失敗`;
  }
  return null;
}

export async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載失敗（HTTP ${res.status}）`);
  return Buffer.from(await res.arrayBuffer());
}
