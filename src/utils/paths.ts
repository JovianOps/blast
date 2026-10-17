import path from 'node:path';

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** True when `child` equals `parent` or lives somewhere beneath it. */
export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
