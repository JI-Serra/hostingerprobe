import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const standaloneRoot = join(process.cwd(), '.next', 'standalone');
const staticSource = join(process.cwd(), '.next', 'static');
const publicSource = join(process.cwd(), 'public');

mkdirSync(standaloneRoot, { recursive: true });
if (existsSync(staticSource)) cpSync(staticSource, join(standaloneRoot, '.next', 'static'), { recursive: true });
if (existsSync(publicSource)) cpSync(publicSource, join(standaloneRoot, 'public'), { recursive: true });

console.log(JSON.stringify({ event: 'standalone-assets-prepared' }));
