import mongoose from 'mongoose';

import { seedCategories, seedProducts } from '../seed/catalog.js';

let memoryServer;

const dedupeSeedProductsBySku = (products) => {
  const seen = new Set();
  const deduped = [];
  for (const p of products) {
    const sku = p?.sku;
    if (!sku) continue;
    if (seen.has(sku)) {
      console.warn(`⚠️  Duplicate seed SKU skipped: ${sku} (${p?.name || 'Unnamed product'})`);
      continue;
    }
    seen.add(sku);
    deduped.push(p);
  }
  return deduped;
};

const seedSampleDatabaseIfEmpty = async () => {
  const User = (await import('../models/User.js')).default;
  const Category = (await import('../models/Category.js')).default;
  const Product = (await import('../models/Product.js')).default;

  const productCount = await Product.countDocuments();
  // Only seed products when the catalog is empty.
  if (productCount > 0) return;

  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@lumina.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Passw0rd!';
  const adminName = process.env.SEED_ADMIN_NAME || 'Admin';

  await Category.bulkWrite(
    seedCategories.map((c) => ({
      updateOne: {
        filter: { slug: c.slug },
        update: { $setOnInsert: c },
        upsert: true,
      },
    }))
  );

  const createdCategories = await Category.find({ slug: { $in: seedCategories.map((c) => c.slug) } });
  const categoryIdBySlug = createdCategories.reduce((acc, c) => {
    acc[c.slug] = c._id;
    return acc;
  }, {});

  await User.updateOne(
    { email: adminEmail },
    {
      $setOnInsert: {
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        role: 'admin',
      },
    },
    { upsert: true }
  );

  const ops = dedupeSeedProductsBySku(seedProducts)
    .map(({ categorySlug, createdAt, updatedAt, ...p }) => {
      const categoryId = categoryIdBySlug[categorySlug];
      if (!categoryId) return null;
      return {
        updateOne: {
          filter: { sku: p.sku },
          update: { $setOnInsert: { ...p, category: categoryId } },
          upsert: true,
        },
      };
    })
    .filter(Boolean);

  const result = await Product.bulkWrite(ops);

  console.log(`✅ Seeded DB with catalog products (inserted: ${result.upsertedCount || 0})`);
  console.log(`🔑 Seed admin login: ${adminEmail} / ${adminPassword}`);
};

const connectDB = async () => {
  let mongoUrl = process.env.MONGO_URL;
  let dbName = process.env.DB_NAME;

  if (!mongoUrl && process.env.USE_IN_MEMORY_DB === 'true') {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    mongoUrl = memoryServer.getUri();
    process.env.MONGO_URL = mongoUrl;
  }

  if (!dbName && process.env.USE_IN_MEMORY_DB === 'true') {
    dbName = 'lumina_dev';
    process.env.DB_NAME = dbName;
  }

  if (!mongoUrl) {
    throw new Error('Missing MONGO_URL');
  }
  if (!dbName) {
    throw new Error('Missing DB_NAME');
  }

  await mongoose.connect(mongoUrl, { dbName });
  console.log('✅ MongoDB connected successfully');

  // Seed sample data safely (no deletes, no duplicates) when the DB is empty.
  // - In-memory MongoDB: seeds by default unless SEED_IN_MEMORY_DB=false
  // - Real MongoDB: seeds in non-production by default unless SEED_DB_ON_START=false
  const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (memoryServer) {
    const seedFlag = (process.env.SEED_IN_MEMORY_DB || '').trim().toLowerCase();
    const shouldSeed = seedFlag !== 'false';
    if (shouldSeed) {
      await seedSampleDatabaseIfEmpty();
    } else {
      console.log('ℹ️  Skipping in-memory seed (SEED_IN_MEMORY_DB=false)');
    }
  } else if (!isProduction) {
    const seedFlag = (process.env.SEED_DB_ON_START || '').trim().toLowerCase();
    const shouldSeed = seedFlag !== 'false';
    if (shouldSeed) {
      await seedSampleDatabaseIfEmpty();
    } else {
      console.log('ℹ️  Skipping DB seed on start (SEED_DB_ON_START=false)');
    }
  }

  if (memoryServer) {
    const cleanup = async () => {
      try {
        await mongoose.disconnect();
      } catch {
        // ignore
      }
      try {
        await memoryServer.stop();
      } catch {
        // ignore
      }
      process.exit(0);
    };

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }
};

export default connectDB;