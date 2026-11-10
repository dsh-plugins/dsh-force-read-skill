import { readFile, writeFile } from 'node:fs/promises';

const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const response = await fetch('https://registry.npmjs.org/' + encodeURIComponent(name), { cache: 'no-store' });
if (!response.ok) {
  throw new Error(name + ' 的 npm 元数据请求失败，HTTP ' + response.status);
}
const metadata = await response.json();
const latest = metadata['dist-tags']?.latest;
const dist = metadata.versions?.[latest]?.dist;
const publishedAt = metadata.time?.[latest];
if (!latest || !dist?.tarball || !dist.integrity || !publishedAt) {
  throw new Error(name + ' 的 npm 正式版元数据不完整');
}

await writeFile(new URL('../npm-latest.json', import.meta.url), JSON.stringify({
  name,
  latest,
  publishedAt,
  dist: {
    tarball: dist.tarball,
    integrity: dist.integrity,
    unpackedSize: dist.unpackedSize ?? null,
  },
}, null, 2) + '\n');
