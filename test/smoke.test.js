import test from 'node:test';
import assert from 'node:assert/strict';

import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import connectDB from '../config/database.js';
import createApp from '../app.js';
import User from '../models/User.js';

let mongo;
let app;

const adminCreds = { name: 'Admin', email: 'admin@example.com', password: 'Passw0rd!' };
const userCreds = { name: 'User', email: 'user@example.com', password: 'Passw0rd!' };

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

test.before(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  process.env.DB_NAME = process.env.DB_NAME || 'lumina_test';

  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URL = mongo.getUri();

  await connectDB();
  app = createApp();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test('auth + RBAC + cart→order (COD) smoke', async () => {
  // Register admin
  const adminReg = await request(app).post('/api/auth/register').send(adminCreds);
  assert.equal(adminReg.status, 201);
  assert.ok(adminReg.body.token);

  const adminUserId = adminReg.body.user?.id;
  assert.ok(adminUserId);

  // Promote to admin (token remains valid because server loads user role from DB)
  await User.findByIdAndUpdate(adminUserId, { role: 'admin' });

  const adminToken = adminReg.body.token;

  // Register normal user
  const userReg = await request(app).post('/api/auth/register').send(userCreds);
  assert.equal(userReg.status, 201);
  const userToken = userReg.body.token;
  assert.ok(userToken);

  // Non-admin cannot create category
  const userCat = await request(app)
    .post('/api/categories')
    .set(authHeader(userToken))
    .send({ name: 'Shoes' });
  assert.equal(userCat.status, 403);

  // Admin creates category
  const catRes = await request(app)
    .post('/api/categories')
    .set(authHeader(adminToken))
    .send({ name: 'Shoes' });
  assert.equal(catRes.status, 201);
  assert.ok(catRes.body._id);

  // Admin creates product
  const prodRes = await request(app)
    .post('/api/products')
    .set(authHeader(adminToken))
    .send({
      name: 'Runner 1',
      sku: 'RUNNER-1',
      description: 'A running shoe',
      price: 99.99,
      stock: 5,
      category: catRes.body._id,
      images: [{ url: 'https://example.com/img.jpg', publicId: 'x' }],
    });
  assert.equal(prodRes.status, 201);
  assert.ok(prodRes.body._id);

  // User adds to cart
  const addCart = await request(app)
    .post('/api/cart')
    .set(authHeader(userToken))
    .send({ productId: prodRes.body._id, quantity: 2 });
  assert.equal(addCart.status, 200);
  assert.equal(addCart.body.items?.length, 1);
  assert.equal(addCart.body.total, 199.98);

  // Stripe order creation via /api/orders should be blocked
  const stripeOrderBlocked = await request(app)
    .post('/api/orders')
    .set(authHeader(userToken))
    .send({
      shippingAddress: {
        fullName: 'User',
        phone: '123',
        addressLine1: 'Line 1',
        city: 'City',
        state: 'State',
        pincode: '000',
        country: 'India',
      },
      paymentMethod: 'stripe',
    });
  assert.equal(stripeOrderBlocked.status, 400);
  assert.match(stripeOrderBlocked.body.message, /payments\/confirm/i);

  // COD order creation should succeed and clear cart
  const codOrder = await request(app)
    .post('/api/orders')
    .set(authHeader(userToken))
    .send({
      shippingAddress: {
        fullName: 'User',
        phone: '123',
        addressLine1: 'Line 1',
        city: 'City',
        state: 'State',
        pincode: '000',
        country: 'India',
      },
      paymentMethod: 'cod',
    });
  assert.equal(codOrder.status, 201);
  assert.equal(codOrder.body.paymentStatus, 'completed');
  assert.equal(codOrder.body.orderStatus, 'confirmed');
  assert.equal(codOrder.body.total, 199.98);

  const cartAfter = await request(app).get('/api/cart').set(authHeader(userToken));
  assert.equal(cartAfter.status, 200);
  assert.equal(cartAfter.body.items?.length, 0);
  assert.equal(cartAfter.body.total, 0);

  // Inventory decremented from 5 → 3
  const prodGet = await request(app).get(`/api/products/${prodRes.body.slug}`);
  assert.equal(prodGet.status, 200);
  assert.equal(prodGet.body.product.stock, 3);

  // AI tool-calling should work end-to-end (without real network calls).
  // Stub Grok API responses to force a tool call, then a final assistant message.
  process.env.GROK_API_KEY = 'test_key';
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'search_products',
                      arguments: JSON.stringify({ query: 'Runner', maxPrice: 100 }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Here are some matching products.',
            },
          },
        ],
      }),
    };
  };

  const aiToolRes = await request(app)
    .post('/api/ai/chat')
    .set(authHeader(userToken))
    .send({ message: 'Find me runner shoes under $100', sessionId: 'toolcall-session' });

  global.fetch = originalFetch;

  assert.equal(aiToolRes.status, 200);
  assert.equal(aiToolRes.body.functionCalled, 'search_products');
  assert.ok(Array.isArray(aiToolRes.body.data));
  assert.ok(aiToolRes.body.data.length >= 1);
  assert.equal(aiToolRes.body.data[0].name, 'Runner 1');
  assert.match(String(aiToolRes.body.message), /matching products/i);

  // AI should fail gracefully if Grok is not configured.
  delete process.env.GROK_API_KEY;
  const aiRes = await request(app)
    .post('/api/ai/chat')
    .set(authHeader(userToken))
    .send({ message: 'Show me shoes under $100', sessionId: 'test-session' });
  assert.equal(aiRes.status, 503);
});
