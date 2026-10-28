import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function measureImage(path) {
  try {
    const m = await sharp(path).metadata();
    if (!m.width || !m.height) return null;
    if (m.format !== 'heif') await sharp(path, { failOn: 'error' }).resize(1, 1).toBuffer();
    const swap = (m.orientation ?? 1) >= 5;
    return { width: swap ? m.height : m.width, height: swap ? m.width : m.height, format: m.format, pages: m.pages ?? 1 };
  } catch {
    return null;
  }
}

export async function measureVideo(path) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]);
  const j = JSON.parse(stdout);
  const v = (j.streams ?? []).find(s => s.codec_type === 'video');
  if (!v) throw new Error('no video stream');
  const rotated = (v.side_data_list ?? []).some(s => Math.abs(Number(s.rotation ?? 0)) % 180 === 90);
  const width = rotated ? v.height : v.width;
  const height = rotated ? v.width : v.height;
  const duration = Number.parseFloat(j.format?.duration ?? v.duration);
  return { width: width ?? null, height: height ?? null, duration: Number.isFinite(duration) ? duration : null };
}
