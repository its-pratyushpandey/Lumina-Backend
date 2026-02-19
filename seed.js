import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import Category from './models/Category.js';
import Product from './models/Product.js';

import { seedCategories, seedProducts } from './seed/catalog.js';

dotenv.config();

const shouldReset = process.argv.includes('--reset');

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

const seedData = async () => {
  try {
    if (!process.env.MONGO_URL) {
      throw new Error('Missing MONGO_URL in environment');
    }

    await mongoose.connect(process.env.MONGO_URL, {
      dbName: process.env.DB_NAME,
    });
    
    console.log('Connected to MongoDB');
    
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@lumina.local';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Passw0rd!';
    const adminName = process.env.SEED_ADMIN_NAME || 'Admin';

    if (shouldReset) {
      const skus = dedupeSeedProductsBySku(seedProducts).map((p) => p.sku);
      const deleted = await Product.deleteMany({ sku: { $in: skus } });
      console.log(`Reset mode: removed seeded products (${deleted.deletedCount || 0})`);
    }

    await Category.bulkWrite(
      seedCategories.map((c) => ({
        updateOne: {
          filter: { slug: c.slug },
          update: { $setOnInsert: c },
          upsert: true,
        },
      }))
    );
    console.log('Categories upserted');

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
    console.log('Admin user upserted');

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
    console.log(`Products upserted (inserted: ${result.upsertedCount || 0})`);

    console.log('\u2705 Database seed completed successfully!');
    console.log(`Admin credentials: ${adminEmail} / ${adminPassword}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedData();