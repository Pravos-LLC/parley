// Small, dependency-free lint: whitespace, leftover placeholders, and house style in docs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter((f) => f && !f.startsWith('dist/') && !f.startsWith('node_modules/') && /\.(ts|tsx|mjs|md|yml|yaml|css|html|sh)$/.test(f));
const problems = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  text.split('\n').forEach((l, i) => {
    if (/[ \t]+$/.test(l) && !f.endsWith('.md')) problems.push(`${f}:${i + 1} trailing whitespace`);
    if (/\t/.test(l) && /\.(ts|tsx|mjs|css)$/.test(f)) problems.push(`${f}:${i + 1} tab indentation`);
    if (/—/.test(l) && /\.(md|ya?ml)$/.test(f) && !f.startsWith('examples/')) problems.push(`${f}:${i + 1} em dash in docs (use a comma, colon or full stop)`);
    if (/\bTODO\b|\bFIXME\b/.test(l) && f.startsWith('src/')) problems.push(`${f}:${i + 1} TODO left in source`);
  });
  if (f.startsWith('templates/')) {
    for (const m of text.matchAll(/\{\{([A-Z_]+)\}\}/g)) if (!['PARTIES', 'MODEL', 'POSITION_COLUMNS', 'POSITION_SEPARATORS', 'POSITION_BLANKS'].includes(m[1])) problems.push(`${f}: unknown template placeholder {{${m[1]}}}`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`lint: ${files.length} files clean.`);
