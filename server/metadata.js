import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rename, rm } from 'node:fs/promises';
import { extname } from 'node:path';

const run = promisify(execFile);
const BIG = { maxBuffer: 64 * 1024 * 1024 };
const DROP = new Set(['SourceFile', 'File:FileName', 'File:Directory', 'File:FilePermissions', 'File:FileModifyDate', 'File:FileAccessDate', 'File:FileInodeChangeDate']);

export async function readMeta(path) {
  let stdout;
  try {
    ({ stdout } = await run('exiftool', ['-json', '-G', '-n', '-api', 'largefilesupport=1', path], BIG));
  } catch (e) {
    // exiftool exits 1 on a file it does not recognise but still prints its JSON; bytes it cannot name are still a file.
    if (/Unknown file type/.test(String(e.stdout ?? ''))) return { meta: {}, mime: 'application/octet-stream', ext: null, takenAt: null };
    throw e;
  }
  const raw = JSON.parse(stdout)[0] ?? {};
  if (raw['ExifTool:Error']) throw new Error(String(raw['ExifTool:Error']));
  const meta = {};
  for (const [k, v] of Object.entries(raw)) {
    if (DROP.has(k) || k.startsWith('ExifTool:')) continue;
    meta[k] = v;
  }
  const mime = typeof raw['File:MIMEType'] === 'string' ? raw['File:MIMEType'] : 'application/octet-stream';
  const ext = typeof raw['File:FileTypeExtension'] === 'string' ? raw['File:FileTypeExtension'].toLowerCase() : null;
  return { meta, mime, ext, takenAt: takenAtFrom(meta) };
}

// Tag names, in any exiftool group, that must never survive a strip. Two survivors are not personal: the ICC profile
// (kept on purpose; its header names a creator and a copyright) and the mandatory MP4 header dates ffmpeg can only zero.
const PERSONAL = /GPS|Location|Make$|Model$|Serial|Artist|Owner|Creator|DateTimeOriginal|CreateDate|ModifyDate|Software|HostComputer|DocumentName|Copyright|ImageDescription|UserComment|ImageUniqueID/i;
const ZEROED_DATE = /^QuickTime:(Track|Media)?(Create|Modify)Date$/;

export function personalTags(meta) {
  return Object.keys(meta).filter(k =>
    (PERSONAL.test(k) || /:XP/.test(k)) &&
    !k.startsWith('ICC_Profile:') &&
    !(ZEROED_DATE.test(k) && meta[k] === '0000:00:00 00:00:00'));
}

export function kindFromMime(mime) {
  if (typeof mime !== 'string') return 'file';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

const EXIF_KEYS = ['EXIF:DateTimeOriginal', 'XMP:DateTimeOriginal', 'EXIF:CreateDate'];
const QT_KEYS = ['QuickTime:CreationDate', 'QuickTime:CreateDate', 'QuickTime:MediaCreateDate'];

// readMeta passes -n, which also turns off -d date formatting, so dates arrive in exiftool's raw
// "YYYY:MM:DD HH:MM:SS" form. Accept that or ISO, return ISO without a zone, or null for a zeroed date.
function isoDate(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(v);
  if (!m || m[1] === '0000') return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}`;
}

export function takenAtFrom(meta) {
  for (const k of EXIF_KEYS) {
    const v = isoDate(meta[k]);
    if (v) {
      const off = meta['EXIF:OffsetTimeOriginal'] ?? meta['EXIF:OffsetTime'];
      return v + (typeof off === 'string' && /^[+-]\d{2}:\d{2}$/.test(off) ? off : '');
    }
  }
  for (const k of QT_KEYS) {
    const v = isoDate(meta[k]);
    if (v) return v + 'Z';
  }
  return null;
}

// Lossless: exiftool rewrites metadata segments only. The ICC profile and the orientation flag are copied back
// because they change how the pixels are displayed and carry nothing personal.
// -all= cannot delete IFD0 in a TIFF (or a TIFF-based RAW): its personal tags are removed one by one, and ingest
// re-reads the result and refuses anything that still carries a personal tag.
export async function stripImage(path) {
  await run('exiftool', ['-all=', '-tagsfromfile', '@', '-ICC_Profile', '-Orientation',
    '-IFD0:Make=', '-IFD0:Model=', '-IFD0:Artist=', '-IFD0:Copyright=', '-IFD0:HostComputer=', '-IFD0:DocumentName=',
    '-IFD0:ImageDescription=', '-IFD0:Software=', '-IFD0:ModifyDate=', '-IFD0:XP*=',
    '-overwrite_original', '-q', '-api', 'largefilesupport=1', path], BIG);
}

// Lossless: streams are copied, container and stream metadata and chapters dropped. Real video and audio only, so
// phone "mebx" data tracks (motion metadata) and attached cover pictures (which carry their own EXIF) go too.
// ffmpeg picks the muxer from the output name, so the caller passes the detected extension (temp files have none).
export async function stripVideo(path, ext = extname(path).slice(1)) {
  const out = `${path}.strip.${ext}`;
  try {
    // 0:V (capital) selects real video streams only: attached pictures (cover art) are JPEGs with their own EXIF and must not be copied.
    await run('ffmpeg', ['-y', '-v', 'error', '-i', path, '-map', '0:V', '-map', '0:a?', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', out], BIG);
    await rename(out, path);
  } catch (e) {
    await rm(out, { force: true }); // ffmpeg creates the output before it can fail at the header; never leave it behind
    throw e;
  }
}
