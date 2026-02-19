import Stripe from 'stripe';
import Cart from '../models/Cart.js';
import { createOrderFromCart } from '../services/orderService.js';

class StripeConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StripeConfigError';
  }
}

const getStripe = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new StripeConfigError('Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(secretKey, {
    apiVersion: process.env.STRIPE_API_VERSION,
  });
};

const toCents = (amount) => {
  // Amounts are stored as numbers; convert safely.
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(cents) || cents < 0) return 0;
  return cents;
};

export const createPaymentIntent = async (req, res) => {
  try {
    const stripe = getStripe();
    const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    const amount = toCents(cart.total);
    if (amount <= 0) {
      return res.status(400).json({ message: 'Cart total is invalid' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: String(req.user._id),
        cartId: String(cart._id),
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    if (error instanceof StripeConfigError) {
      return res.status(503).json({
        message: 'Payments are not configured on the server. Set STRIPE_SECRET_KEY.',
        error: error.message,
      });
    }
    res.status(500).json({ message: error.message });
  }
};

export const confirmStripeOrder = async (req, res) => {
  try {
    const stripe = getStripe();

    const { paymentIntentId, shippingAddress } = req.body;

    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return res.status(400).json({ message: 'paymentIntentId is required' });
    }

    if (!shippingAddress) {
      return res.status(400).json({ message: 'shippingAddress is required' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (!paymentIntent) {
      return res.status(404).json({ message: 'Payment intent not found' });
    }

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        message: `Payment not completed. Status: ${paymentIntent.status}`,
      });
    }

    // Create order, update inventory, clear cart (idempotent via paymentIntentId)
    const { order, reused } = await createOrderFromCart({
      userId: req.user._id,
      shippingAddress,
      paymentMethod: 'stripe',
      paymentStatus: 'completed',
      orderStatus: 'confirmed',
      paymentIntentId,
    });

    res.status(reused ? 200 : 201).json({ order, reused });
  } catch (error) {
    if (error instanceof StripeConfigError) {
      return res.status(503).json({
        message: 'Payments are not configured on the server. Set STRIPE_SECRET_KEY.',
        error: error.message,
      });
    }

    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message });
  }
};
