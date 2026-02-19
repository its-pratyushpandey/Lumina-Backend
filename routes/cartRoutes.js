import express from 'express';
import { getCart, addToCart, updateCartItem, removeFromCart, clearCart, applyCoupon, removeCoupon } from '../controllers/cartController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, getCart);
router.post('/', protect, addToCart);
router.put('/', protect, updateCartItem);
router.post('/coupon', protect, applyCoupon);
router.delete('/coupon', protect, removeCoupon);
router.delete('/:productId', protect, removeFromCart);
router.delete('/', protect, clearCart);

export default router;