import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import { recalcCartTotals } from '../services/cartService.js';

export const getCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    
    if (!cart) {
      cart = await Cart.create({ user: req.user._id, items: [] });
    } else {
      // Keep totals accurate even if pricing/coupon rules changed.
      await recalcCartTotals(cart);
      await cart.save();
      await cart.populate('items.product');
    }
    
    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
      return res.status(400).json({ message: 'productId is required' });
    }

    if (!Number.isFinite(Number(quantity)) || Number(quantity) < 1) {
      return res.status(400).json({ message: 'quantity must be >= 1' });
    }
    
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    if (product.stock < quantity) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    let cart = await Cart.findOne({ user: req.user._id });
    
    if (!cart) {
      cart = new Cart({ user: req.user._id, items: [] });
    }
    
    const existingItem = cart.items.find(
      item => item.product.toString() === productId
    );
    
    if (existingItem) {
      if (product.stock < existingItem.quantity + quantity) {
        return res.status(400).json({ message: 'Insufficient stock' });
      }
      existingItem.quantity += quantity;
      existingItem.price = product.price;
    } else {
      cart.items.push({
        product: productId,
        quantity,
        price: product.price
      });
    }

    await recalcCartTotals(cart);
    
    await cart.save();
    await cart.populate('items.product');
    
    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateCartItem = async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    if (!productId) {
      return res.status(400).json({ message: 'productId is required' });
    }

    if (!Number.isFinite(Number(quantity))) {
      return res.status(400).json({ message: 'quantity must be a number' });
    }
    
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    
    const item = cart.items.find(
      item => item.product.toString() === productId
    );
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found in cart' });
    }
    
    if (quantity <= 0) {
      cart.items = cart.items.filter(
        item => item.product.toString() !== productId
      );
    } else {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }
      if (product.stock < quantity) {
        return res.status(400).json({ message: 'Insufficient stock' });
      }
      item.quantity = quantity;
      item.price = product.price;
    }

    await recalcCartTotals(cart);
    
    await cart.save();
    await cart.populate('items.product');
    
    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;
    
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    
    cart.items = cart.items.filter(
      item => item.product.toString() !== productId
    );
    
    await recalcCartTotals(cart);
    
    await cart.save();
    await cart.populate('items.product');
    
    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    
    cart.items = [];
    cart.subtotal = 0;
    cart.discount = 0;
    cart.total = 0;
    cart.couponCode = undefined;
    
    await cart.save();
    
    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const applyCoupon = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ message: 'code is required' });
    }

    const couponCode = code.trim().toUpperCase();
    const coupon = await Coupon.findOne({ code: couponCode, isActive: true });
    if (!coupon) {
      return res.status(404).json({ message: 'Invalid coupon code' });
    }

    const isExpired = coupon.expiresAt && coupon.expiresAt.getTime() < Date.now();
    if (isExpired) {
      return res.status(400).json({ message: 'Coupon has expired' });
    }

    const limitReached = coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit;
    if (limitReached) {
      return res.status(400).json({ message: 'Coupon usage limit reached' });
    }

    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    cart.couponCode = couponCode;
    await recalcCartTotals(cart);

    if (cart.subtotal < (coupon.minSubtotal || 0)) {
      cart.couponCode = undefined;
      await recalcCartTotals(cart);
      await cart.save();
      return res.status(400).json({ message: `Minimum subtotal is ${coupon.minSubtotal}` });
    }

    await cart.save();
    await cart.populate('items.product');

    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const removeCoupon = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    cart.couponCode = undefined;
    await recalcCartTotals(cart);
    await cart.save();
    await cart.populate('items.product');
    res.json(cart);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};