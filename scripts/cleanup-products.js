import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const hasFlag = (flag) => process.argv.includes(flag);
const getArgValue = (name) => {
  const prefix = `${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseNames = () => {
  const raw = getArgValue('--names');
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const isApply = hasFlag('--apply');
const dryRun = !isApply;
const deleteMissingImages = !hasFlag('--no-missing-images');
const names = parseNames();

const connect = async () => {
  const mongoUrl = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME;

  if (!mongoUrl) throw new Error('Missing MONGO_URL in environment');
  if (!dbName) throw new Error('Missing DB_NAME in environment');

  await mongoose.connect(mongoUrl, { dbName });
};

const buildQuery = () => {
  const clauses = [];

  if (deleteMissingImages) {
    clauses.push({
      $or: [
        { images: { $exists: false } },
        { images: { $size: 0 } },
        { 'images.0.url': { $exists: false } },
        { 'images.0.url': { $in: [null, ''] } },
      ],
    });
  }

  if (names.length > 0) {
    const nameRegexes = names.map((n) => ({ name: new RegExp(`^${escapeRegExp(n)}$`, 'i') }));
    clauses.push({ $or: nameRegexes });
  }

  if (clauses.length === 0) {
    throw new Error('No cleanup criteria specified. Provide --names=... or omit --no-missing-images.');
  }

  if (clauses.length === 1) return clauses[0];
  return { $or: clauses };
};

const main = async () => {
  try {
    await connect();

    const { default: Product } = await import('../models/Product.js');

    const query = buildQuery();

    const matches = await Product.find(query)
      .select('name sku images createdAt updatedAt')
      .limit(200);

    console.log(`Found ${matches.length} matching products${matches.length === 200 ? ' (showing first 200)' : ''}.`);
    for (const p of matches) {
      const firstUrl = p.images?.[0]?.url;
      console.log(`- ${p.name} | sku=${p.sku || '-'} | images=${p.images?.length || 0} | firstUrl=${firstUrl || '-'}`);
    }

    if (dryRun) {
      console.log('Dry run: no deletions performed. Re-run with --apply to delete.');
      process.exit(0);
    }

    const result = await Product.deleteMany(query);
    console.log(`Deleted ${result.deletedCount || 0} products.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
  }
};

main();
