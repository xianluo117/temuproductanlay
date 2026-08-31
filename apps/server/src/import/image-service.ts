import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config, paths } from '../config.js';
import { database } from '../database/index.js';
import type { ParsedImage, StoredImage } from './types.js';

interface ImageAssetRow {
  id: number;
  file_name: string;
  source_type: 'embedded' | 'remote';
}

function mimeFromExtension(extension: string): string {
  const normalized = extension.toLowerCase().replace('.', '');
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  if (normalized === 'gif') return 'image/gif';
  return 'image/png';
}

export async function storeBuffer(
  buffer: Buffer,
  extension: string,
  source: 'embedded' | 'remote',
  sourceUrl: string | null,
): Promise<StoredImage> {
  const contentHash = createHash('sha256').update(buffer).digest('hex');
  const existing = database
    .prepare('SELECT id, file_name, source_type FROM image_assets WHERE content_hash = ?')
    .get(contentHash) as ImageAssetRow | undefined;
  if (existing) {
    const existingPath = path.join(paths.images, existing.file_name);
    await fs.writeFile(existingPath, buffer, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    return {
      assetId: existing.id,
      publicUrl: `/assets/images/${existing.file_name}`,
      source: existing.source_type,
    };
  }

  const normalizedExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const fileName = `${contentHash}.${normalizedExtension}`;
  const outputPath = path.join(paths.images, fileName);
  await fs.writeFile(outputPath, buffer, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });

  let width: number | null = null;
  let height: number | null = null;
  try {
    const metadata = await sharp(buffer).metadata();
    width = metadata.width ?? null;
    height = metadata.height ?? null;
  } catch {
    // The browser can still render supported formats even if metadata extraction fails.
  }

  const result = database
    .prepare(
      `INSERT INTO image_assets
       (content_hash, file_name, mime_type, byte_size, width, height, source_type, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      contentHash,
      fileName,
      mimeFromExtension(normalizedExtension),
      buffer.byteLength,
      width,
      height,
      source,
      sourceUrl,
    );

  return {
    assetId: Number(result.lastInsertRowid),
    publicUrl: `/assets/images/${fileName}`,
    source,
  };
}

export async function storeEmbeddedImage(image: ParsedImage): Promise<StoredImage> {
  return storeBuffer(image.buffer, image.extension, 'embedded', null);
}

export async function storeUploadedImage(
  buffer: Buffer,
  originalName: string,
): Promise<StoredImage> {
  const extension = path.extname(originalName).slice(1) || 'jpg';
  return storeBuffer(buffer, extension, 'embedded', null);
}

function extensionFromContentType(contentType: string): string {
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('png')) return 'png';
  return 'jpg';
}

export async function downloadAndStoreImage(url: string): Promise<StoredImage | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.imageDownloadTimeoutMs);
  try {
    const response = await fetch(parsedUrl, {
      signal: controller.signal,
      headers: { 'user-agent': 'TemuAnalytics/1.0' },
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('image/')) return null;
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > 15 * 1024 * 1024) return null;
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > 15 * 1024 * 1024) return null;
    return storeBuffer(
      Buffer.from(arrayBuffer),
      extensionFromContentType(contentType),
      'remote',
      url,
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
