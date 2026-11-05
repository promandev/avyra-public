import 'server-only';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { panelRoot } from './system-panel';
import type { DirListing, FileContent, FileEntry } from './system-panel-types';

/**
 * Explorador de archivos de la sección Sistema, encerrado en `PANEL_FILE_ROOT`.
 *
 * Cada ruta que llega del cliente se resuelve siguiendo enlaces simbólicos y se
 * comprueba que sigue dentro de la raíz: así ni `../../etc` ni un symlink que
 * apunte fuera sirven para escapar. Tiene escritura completa a petición del
 * dueño; la puerta es el super admin en cada ruta.
 */

/** Por encima de esto el editor enseña sólo el principio del fichero. */
const MAX_READ_BYTES = 512 * 1024;
/** Cloudflare corta las peticiones de más de 100 MB; se deja margen. */
export const MAX_UPLOAD_BYTES = 90 * 1024 * 1024;

export class PanelFileError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

let rootReal: string | null = null;

async function root(): Promise<string> {
  const configured = panelRoot();
  if (!configured) throw new PanelFileError(503, 'not_configured');
  rootReal ??= await realpath(configured).catch(() => {
    throw new PanelFileError(503, 'root_missing');
  });
  return rootReal;
}

function isInside(target: string, base: string): boolean {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resuelve una ruta del cliente a una ruta real dentro de la raíz. Si no existe
 * (crear, subir) se resuelve su carpeta y se le pega el nombre.
 */
async function resolveWithin(input: string): Promise<string> {
  const base = await root();
  if (input.includes('\0')) throw new PanelFileError(400, 'invalid_path');
  const candidate = path.resolve(base, input || '.');
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    const parent = await realpath(path.dirname(candidate)).catch(() => {
      throw new PanelFileError(404, 'not_found');
    });
    resolved = path.join(parent, path.basename(candidate));
  }
  if (!isInside(resolved, base)) throw new PanelFileError(403, 'outside_root');
  return resolved;
}

function validName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name !== '.' &&
    name !== '..' &&
    !/[/\\\0]/.test(name)
  );
}

function modeString(mode: number, isDir: boolean, isLink: boolean): string {
  const bits = 'rwxrwxrwx'
    .split('')
    .map((ch, i) => (mode & (1 << (8 - i)) ? ch : '-'))
    .join('');
  return `${isLink ? 'l' : isDir ? 'd' : '-'}${bits}`;
}

async function entryInfo(dir: string, name: string): Promise<FileEntry> {
  const full = path.join(dir, name);
  const link = await lstat(full).catch(() => null);
  const isSymlink = link?.isSymbolicLink() ?? false;
  // Para un enlace se enseña a qué apunta; si está roto, el propio enlace.
  const info = (isSymlink ? await stat(full).catch(() => link) : link) ?? null;
  const isDir = info?.isDirectory() ?? false;
  return {
    name,
    path: full,
    isDir,
    isSymlink,
    size: info && !isDir ? info.size : 0,
    modified: info ? info.mtime.toISOString() : null,
    mode: info ? modeString(info.mode, isDir, isSymlink) : '?---------',
  };
}

export async function listDir(input: string): Promise<DirListing> {
  const base = await root();
  const target = await resolveWithin(input);
  const info = await stat(target).catch(() => null);
  if (!info) throw new PanelFileError(404, 'not_found');
  if (!info.isDirectory()) throw new PanelFileError(400, 'not_a_directory');

  const names = await readdir(target).catch(() => {
    throw new PanelFileError(403, 'permission_denied');
  });
  const entries = await Promise.all(names.map((name) => entryInfo(target, name)));
  entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));

  return {
    path: target,
    parent: target === base ? null : path.dirname(target),
    root: base,
    entries,
  };
}

export async function readTextFile(input: string): Promise<FileContent> {
  const target = await resolveWithin(input);
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) throw new PanelFileError(404, 'not_a_file');

  const handle = await open(target, 'r').catch(() => {
    throw new PanelFileError(403, 'permission_denied');
  });
  try {
    const buffer = Buffer.alloc(Math.min(info.size, MAX_READ_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, bytesRead);
    // Un byte nulo al principio delata un binario: no tiene sentido editarlo.
    if (data.subarray(0, 8192).includes(0)) {
      return { path: target, size: info.size, binary: true };
    }
    return {
      path: target,
      size: info.size,
      binary: false,
      truncated: info.size > MAX_READ_BYTES,
      content: data.toString('utf8'),
    };
  } finally {
    await handle.close();
  }
}

export async function openDownload(input: string) {
  const target = await resolveWithin(input);
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) throw new PanelFileError(404, 'not_a_file');
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
  return { path: target, name: path.basename(target), size: info.size, stream };
}

/**
 * Sobrescribe (o crea) un fichero de texto. Se escribe a un temporal y se
 * renombra para no dejarlo a medias, conservando los permisos: editar un
 * script del cron no puede quitarle el bit de ejecución.
 */
export async function writeTextFile(input: string, content: string): Promise<string> {
  const target = await resolveWithin(input);
  const info = await stat(target).catch(() => null);
  if (info?.isDirectory()) throw new PanelFileError(400, 'is_directory');
  const tmp = `${target}.avyra-tmp`;
  try {
    await writeFile(tmp, content, 'utf8');
    if (info) await chmod(tmp, info.mode & 0o7777);
    await rename(tmp, target);
  } catch {
    await rm(tmp, { force: true });
    throw new PanelFileError(403, 'write_failed');
  }
  return target;
}

export async function createEntry(input: string, isDir: boolean): Promise<string> {
  const target = await resolveWithin(input);
  if (!validName(path.basename(target))) throw new PanelFileError(400, 'invalid_name');
  if (await lstat(target).catch(() => null)) throw new PanelFileError(409, 'already_exists');
  try {
    if (isDir) await mkdir(target);
    else await writeFile(target, '', { flag: 'wx' });
  } catch {
    throw new PanelFileError(403, 'create_failed');
  }
  return target;
}

export async function renameEntry(input: string, newName: string): Promise<string> {
  if (!validName(newName)) throw new PanelFileError(400, 'invalid_name');
  const source = await resolveWithin(input);
  if (source === (await root())) throw new PanelFileError(403, 'is_root');
  const dest = await resolveWithin(path.join(path.dirname(source), newName));
  if (await lstat(dest).catch(() => null)) throw new PanelFileError(409, 'already_exists');
  await rename(source, dest).catch(() => {
    throw new PanelFileError(403, 'rename_failed');
  });
  return dest;
}

export async function deleteEntry(input: string): Promise<string> {
  const target = await resolveWithin(input);
  if (target === (await root())) throw new PanelFileError(403, 'is_root');
  if (!(await lstat(target).catch(() => null))) throw new PanelFileError(404, 'not_found');
  await rm(target, { recursive: true }).catch(() => {
    throw new PanelFileError(403, 'delete_failed');
  });
  return target;
}

/** Guarda un fichero subido dentro de `destDir`; el nombre se reduce a su base. */
export async function saveUpload(destDir: string, file: File): Promise<string> {
  const name = path.basename(file.name);
  if (!validName(name)) throw new PanelFileError(400, 'invalid_name');
  if (file.size > MAX_UPLOAD_BYTES) throw new PanelFileError(413, 'too_large');
  const folder = await resolveWithin(destDir);
  if (!(await stat(folder).catch(() => null))?.isDirectory()) {
    throw new PanelFileError(400, 'not_a_directory');
  }
  const target = await resolveWithin(path.join(folder, name));
  try {
    await pipeline(
      Readable.fromWeb(file.stream() as import('node:stream/web').ReadableStream),
      createWriteStream(target),
    );
  } catch {
    throw new PanelFileError(403, 'upload_failed');
  }
  return target;
}
