import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { Hotel, Brochure } = await import('./models/index.js');

/**
 * Rewrites stored upload links to the proxied https path.
 *   http://host/uploads/x  ->  https://host/api/uploads/x
 * Safe to run more than once. Pass --dry to preview.
 */
const DRY = process.argv.includes('--dry');
const site = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

const fix = (url) => {
  if (!url || !/\/uploads\//.test(url) || /\/api\/uploads\//.test(url)) return url;
  let out = url.replace('/uploads/', '/api/uploads/');
  // point local links at the real site when PUBLIC_URL is set, otherwise
  // leave them alone — localhost has no TLS to upgrade to
  if (isLocal(out)) {
    if (site) out = out.replace(/^https?:\/\/[^/]+/, site);
  } else {
    out = out.replace(/^http:\/\//, 'https://');
  }
  return out;
};

await mongoose.connect(process.env.MONGO_URI);
let changed = 0;

for (const h of await Hotel.find({}).lean()) {
  const images = (h.images || []).map(fix);
  const documents = (h.documents || []).map((d) => ({ ...d, url: fix(d.url) }));
  const dirty = JSON.stringify([images, documents]) !== JSON.stringify([h.images || [], h.documents || []]);
  if (!dirty) continue;
  changed += 1;
  console.log(`  ${h.name}`);
  (h.images || []).forEach((u, i) => u !== images[i] && console.log(`    image ${u}\n       -> ${images[i]}`));
  (h.documents || []).forEach((d, i) => d.url !== documents[i].url && console.log(`    doc   ${d.url}\n       -> ${documents[i].url}`));
  if (!DRY) await Hotel.updateOne({ _id: h._id }, { images, documents });
}

for (const b of await Brochure.find({}).lean()) {
  const fileUrl = fix(b.fileUrl);
  if (fileUrl === b.fileUrl) continue;
  changed += 1;
  console.log(`  ${b.title}\n    ${b.fileUrl}\n       -> ${fileUrl}`);
  if (!DRY) await Brochure.updateOne({ _id: b._id }, { fileUrl });
}

console.log(changed ? `\n${DRY ? 'Would update' : 'Updated'} ${changed} record(s).` : 'Nothing to change.');
await mongoose.disconnect();
