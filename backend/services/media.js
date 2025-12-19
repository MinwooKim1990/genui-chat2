import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');

export const MEDIA_ROOT = path.join(BACKEND_ROOT, 'media');
export const UPLOADS_DIR = path.join(MEDIA_ROOT, 'uploads');
export const OPENAI_IMAGE_DIR = path.join(MEDIA_ROOT, 'openai');
export const GEMINI_IMAGE_DIR = path.join(MEDIA_ROOT, 'gemini');
export const REMOTE_IMAGE_DIR = path.join(MEDIA_ROOT, 'remote');

function publicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
}

export function publicUrlForPath(relativePath) {
  if (!relativePath) return relativePath;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  if (relativePath.startsWith('data:')) return relativePath;
  const base = publicBaseUrl();
  try {
    return new URL(relativePath, base).toString();
  } catch {
    return relativePath;
  }
}

export function ensureMediaDirs() {
  [MEDIA_ROOT, UPLOADS_DIR, OPENAI_IMAGE_DIR, GEMINI_IMAGE_DIR, REMOTE_IMAGE_DIR].forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
  });
}

export function saveBase64Image({ provider, base64, extension = 'png' }) {
  const dir = provider === 'gemini' ? GEMINI_IMAGE_DIR : OPENAI_IMAGE_DIR;
  const filename = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

  const urlPrefix = provider === 'gemini' ? '/media/gemini' : '/media/openai';

  return {
    filename,
    path: filePath,
    url: publicUrlForPath(`${urlPrefix}/${filename}`)
  };
}

function extensionFromMime(mimeType = '') {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg')) return 'jpg';
  if (mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('bmp')) return 'bmp';
  return 'jpg';
}

export async function saveRemoteImage({ url, maxBytes = 8 * 1024 * 1024 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return null;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      return null;
    }

    const extension = extensionFromMime(contentType);
    const filename = `${crypto.randomUUID()}.${extension}`;
    const filePath = path.join(REMOTE_IMAGE_DIR, filename);
    fs.writeFileSync(filePath, buffer);

    return {
      filename,
      path: filePath,
      url: publicUrlForPath(`/media/remote/${filename}`)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
