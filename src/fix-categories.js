import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });
const { Hotel } = await import('./models/index.js');

/** Existing rows store a number; turn 3 into "3 Star". Safe to re-run. */
await mongoose.connect(process.env.MONGO_URI);
const rows = await Hotel.collection.find({ starCategory: { $type: 'number' } }).toArray();
for (const h of rows) {
  const v = `${h.starCategory} Star`;
  console.log(`  ${h.name}: ${h.starCategory} -> ${v}`);
  await Hotel.collection.updateOne({ _id: h._id }, { $set: { starCategory: v } });
}
console.log(rows.length ? `\nConverted ${rows.length} hotel(s).` : 'Nothing to convert.');
await mongoose.disconnect();
