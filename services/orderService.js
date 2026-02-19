import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import { recalcCartTotals } from './cartService.js';

const generateOrderNumber = () => {
  return 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9).toUpperCase();
};

export const createOrderFromCart = async ({
  userId,
  shippingAddress,
  paymentMethod = 'stripe',
  paymentStatus = 'pending',
  orderStatus = 'pending',
  paymentIntentId,
}) => {
  if (!userId) throw new Error('userId is required');

  if (paymentIntentId) {
    const existing = await Order.findOne({ paymentIntentId, user: userId });
    if (existing) return { order: existing, reused: true };
  }

  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart || cart.items.length === 0) {
    const err = new Error('Cart is empty');
    err.statusCode = 400;
    throw err;
  }

  // Ensure totals are accurate at the moment of order creation.
  await recalcCartTotals(cart);
  await cart.save();

  const appliedCouponCode = cart.couponCode;

  // Check stock availability
  for (const item of cart.items) {
    if (!item.product) {
      const err = new Error('Cart contains an invalid product');
      err.statusCode = 400;
      throw err;
    }
    if (item.product.stock < item.quantity) {
      const err = new Error(`Insufficient stock for ${item.product.name}`);
      err.statusCode = 400;
      throw err;
    }
  }

  const orderItems = cart.items.map((item) => ({
    product: item.product._id,
    name: item.product.name,
    price: item.price,
    quantity: item.quantity,
    image: item.product.images?.[0]?.url || '',
  }));

  const order = await Order.create({
    orderNumber: generateOrderNumber(),
    user: userId,
    items: orderItems,
    shippingAddress,
    paymentMethod,
    paymentStatus,
    orderStatus,
    subtotal: cart.subtotal,
    discount: cart.discount,
    shippingCost: 0,
    total: cart.total,
    paymentIntentId: paymentIntentId || undefined,
  });

  if (appliedCouponCode) {
    await Coupon.findOneAndUpdate(
      { code: appliedCouponCode, isActive: true },
      { $inc: { usedCount: 1 } }
    );
  }

  // Update product stock
  for (const item of cart.items) {
    await Product.findByIdAndUpdate(item.product._id, {
      $inc: { stock: -item.quantity },
    });
  }

  // Clear cart
  cart.items = [];
  cart.subtotal = 0;
  cart.discount = 0;
  cart.total = 0;
  cart.couponCode = undefined;
  await cart.save();

  return { order, reused: false };
};
