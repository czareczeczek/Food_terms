import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'google-drive-deploy');
let html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
const styles = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"[^>]*>/g)];
if (scripts.length !== 1 || !styles.length) throw new Error('Nieobsługiwany wynik kompilacji. Uruchom npm run build.');
async function asset(path) {
  if (!/^\/assets\/[\w.-]+$/.test(path)) throw new Error('Nieprawidłowa ścieżka pliku wynikowego.');
  return readFile(resolve(root, 'dist', path.slice(1)), 'utf8');
}
for (const match of scripts) {
  const source = (await asset(match[1])).replace(/<\/script/gi, '<\\/script');
  html = html.replace(match[0], () => `<script type="module">${source}</script>`);
}
for (const match of styles) {
  const source = await asset(match[1]);
  if (/<\/style/i.test(source)) throw new Error('Nieobsługiwana zawartość stylów.');
  html = html.replace(match[0], () => `<style>${source}</style>`);
}
if (/\b(?:src|href)="\/assets\//.test(html)) throw new Error('Pozostały nieosadzone zasoby.');
html = html.replace('<head>', '<head>\n    <base target="_top" />');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'Index.html'), html);
for (const name of ['Code.gs', 'appsscript.json']) await copyFile(resolve(root, 'apps-script', name), resolve(output, name));
await copyFile(resolve(root, 'GOOGLE_DRIVE.md'), resolve(output, 'INSTRUKCJA.txt'));
console.log('Gotowy pakiet Google: google-drive-deploy/');
