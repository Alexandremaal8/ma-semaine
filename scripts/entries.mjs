// Builds the Focus and Sport entry pages (separate home-screen icons) from index.html.
import { readFileSync, writeFileSync } from 'fs';
const dir = new URL('../site/', import.meta.url);
const src = readFileSync(new URL('index.html', dir), 'utf8');
const base = JSON.parse(readFileSync(new URL('manifest.webmanifest', dir), 'utf8'));
const apps = {
  focus: { name: 'EPFL Focus', theme: '#4B3BD6', bg: '#2B1B8F' },
  sport: { name: 'EPFL Sport', theme: '#0F9E74', bg: '#0B6E62' }
};
for (const [id, a] of Object.entries(apps)) {
  const html = src
    .replace(/<html([^>]*)>/, `<html$1 data-app="${id}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${a.name}</title>`)
    .replace('href="manifest.webmanifest"', `href="manifest-${id}.webmanifest"`)
    .replace('href="icons/apple-touch-icon.png"', `href="icons/${id}-apple-touch-icon.png"`)
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*">/, `<meta name="apple-mobile-web-app-title" content="${a.name.replace('EPFL ', '')}">`);
  if (!html.includes(`data-app="${id}"`)) throw new Error('entry ' + id);
  writeFileSync(new URL(`${id}.html`, dir), html.replace(`data-app="${id}">`, `data-app="${id}"><!-- generated from index.html by scripts/entries.mjs: do not edit -->`));
  const m = Object.assign({}, base, { name: a.name, short_name: a.name.replace('EPFL ', ''), id: `./${id}.html`, start_url: `./${id}.html`, theme_color: a.theme, background_color: a.bg,
    icons: [{ src: `icons/${id}-192.png`, sizes: '192x192', type: 'image/png' }, { src: `icons/${id}-512.png`, sizes: '512x512', type: 'image/png' }, { src: `icons/${id}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }] });
  writeFileSync(new URL(`manifest-${id}.webmanifest`, dir), JSON.stringify(m, null, 2) + '\n');
}
console.log('entries OK');
