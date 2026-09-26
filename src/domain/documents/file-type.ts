/** Allowed upload types (D29). The type is decided from the file's bytes, never its name or browser-declared type. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type AllowedType = {
  mime: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
  ext: string;
};

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

export function sniffFileType(bytes: Uint8Array): AllowedType | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a)
    return { mime: 'image/png', ext: 'png' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(bytes, 4, 4) === 'ftyp' && ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'].includes(ascii(bytes, 8, 4)))
    return { mime: 'image/heic', ext: 'heic' };
  return null;
}

export type UploadCheck = { ok: true; type: AllowedType } | { ok: false; message: string };

export function checkUpload(bytes: Uint8Array): UploadCheck {
  if (bytes.byteLength === 0) return { ok: false, message: 'The file is empty.' };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, message: 'The file is larger than 10 MB.' };
  const type = sniffFileType(bytes);
  if (!type) return { ok: false, message: 'Please upload a PDF or a photo (JPEG, PNG, WEBP or HEIC).' };
  return { ok: true, type };
}

/** Keep a readable, harmless version of the uploaded name for display only. */
export function safeDisplayName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .trim();
  return (cleaned || 'document').slice(0, 120);
}
