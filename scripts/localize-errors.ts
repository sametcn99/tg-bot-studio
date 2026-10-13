import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'locales' || entry === 'node_modules') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const root = process.cwd();
let changed = 0;
for (const file of walk(join(root, 'src/client/src'))) {
  const rel = relative(root, file);
  if (rel.includes(`utils${sep}errors`) || rel.includes(`services${sep}api`)) continue;
  let source = readFileSync(file, 'utf8');
  const original = source;
  source = source.replace(/showError\(err\.message\)/g, 'showError(localizedErrorMessage(err))');
  source = source.replace(/setError\(err\.message\)/g, 'setError(localizedErrorMessage(err))');
  source = source.replace(
    /showError\(err instanceof Error \? err\.message : String\(err\)\)/g,
    'showError(localizedErrorMessage(err))',
  );
  if (source !== original) {
    if (!source.includes('localizedErrorMessage')) {
      source = original;
    } else if (
      !source.includes("from '../utils/errors'") &&
      !source.includes("from '../../utils/errors'")
    ) {
      const depth = rel.includes(`pages${sep}modules`) ? '../../utils/errors' : '../utils/errors';
      const importLine = `import { localizedErrorMessage } from '${depth}';`;
      const lines = source.split('\n');
      let lastImport = -1;
      for (let i = 0; i < lines.length; i++) if (/^import /.test(lines[i])) lastImport = i;
      lines.splice(lastImport + 1, 0, importLine);
      source = lines.join('\n');
    }
    writeFileSync(file, source);
    changed++;
    console.log('updated', rel);
  }
}
console.log(`done: ${changed} files`);
