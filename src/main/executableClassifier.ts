import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

// Extensions that can execute code when opened via the system default handler.
const DANGEROUS_EXTENSIONS = new Set([
  '.desktop',
  '.sh',
  '.bash',
  '.zsh',
  '.run',
  '.appimage',
  '.bin',
  '.py',
  '.pl',
  '.rb',
  '.js',
  '.mjs',
  '.cjs',
  '.php',
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.jar',
  '.app',
  '.command',
]);

// Ordinary file types — images, documents, archives, media — known to be safe
// to hand to the system default handler. Anything not on this list is not
// confidently harmless and is treated as unsafe, even if it isn't on the
// dangerous list either.
const SAFE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.tiff',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  '.txt', '.rtf', '.csv', '.md',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac',
  '.mp4', '.mkv', '.webm', '.mov', '.avi',
]);

export function hasDangerousExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return DANGEROUS_EXTENSIONS.has(ext);
}

export function hasSafeExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SAFE_EXTENSIONS.has(ext);
}

async function hasExecutablePermissionBit(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fail-safe classification: only files on the known-safe extension list are
 * treated as harmless. Everything else — known-dangerous extensions,
 * unrecognized extensions, and files carrying the executable permission
 * bit — is treated as unsafe.
 */
export async function isSafeToOpen(filePath: string): Promise<boolean> {
  if (hasDangerousExtension(filePath)) return false;
  if (!hasSafeExtension(filePath)) return false;
  if (await hasExecutablePermissionBit(filePath)) return false;
  return true;
}
