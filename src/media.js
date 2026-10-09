import sharp from 'sharp';

const IG_MIN_RATIO = 0.8; // 4:5 portrait
const IG_MAX_RATIO = 1.91; // landscape
const PAD_COLOR = '#ffffff';

/**
 * Normalise every image to JPEG: Instagram only accepts JPEG, and the review
 * message re-hosts these files so Meta can fetch them from a public URL.
 * Images outside Instagram's allowed ratio are padded (never cropped) to fit.
 */
export async function toJpeg(buffer) {
  const { data: rotated, info } = await sharp(buffer, { animated: false })
    .rotate()
    .toBuffer({ resolveWithObject: true });
  const data = await sharp(rotated)
    .extend({ ...padToIgRatio(info), background: PAD_COLOR })
    .flatten({ background: PAD_COLOR })
    .resize({ width: 1440, withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const { width, height } = await sharp(data).metadata();
  return { data, width, height };
}

/** Padding (px per side) that brings an image inside Instagram's 4:5–1.91:1 range. */
export function padToIgRatio({ width, height }) {
  const pad = { top: 0, bottom: 0, left: 0, right: 0 };
  if (width / height < IG_MIN_RATIO) {
    const extra = Math.ceil(height * IG_MIN_RATIO) - width;
    pad.left = Math.floor(extra / 2);
    pad.right = extra - pad.left;
  } else if (width / height > IG_MAX_RATIO) {
    const extra = Math.ceil(width / IG_MAX_RATIO) - height;
    pad.top = Math.floor(extra / 2);
    pad.bottom = extra - pad.top;
  }
  return pad;
}

/** Instagram rejects images outside 4:5 (portrait) to 1.91:1 (landscape). */
export function igAspectWarning({ width, height }, index) {
  const ratio = width / height;
  if (ratio < IG_MIN_RATIO - 0.01 || ratio > IG_MAX_RATIO + 0.01) {
    return `第 ${index + 1} 張圖比例 ${width}×${height} 超出 IG 允許範圍（4:5～1.91:1），IG 可能會發布失敗`;
  }
  return null;
}

export async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載失敗（HTTP ${res.status}）`);
  return Buffer.from(await res.arrayBuffer());
}
