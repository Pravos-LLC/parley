// Prints the hash parley uses for an issues-list row: node test/row-hash.mjs <issues.md> <ID>
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [file, id] = process.argv.slice(2);
const line = readFileSync(file, 'utf8').split('\n').find((l) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(l));
if (!line) process.exit(1);
const t = line.trim().replace(/\\\|/g, '\u0000');
let cells = t.split('|').slice(1);
if (t.endsWith('|')) cells = cells.slice(0, -1);
cells = cells.map((c) => c.replace(/\u0000/g, '|').trim());
process.stdout.write(createHash('sha256').update(cells.join('|')).digest('hex').slice(0, 12));
