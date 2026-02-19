import Coupon from '../models/Coupon.js';

export const recalcCartTotals = async (cart) => {
  cart.subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  cart.discount = 0;
  if (cart.couponCode) {
    const coupon = await Coupon.findOne({ code: cart.couponCode, isActive: true });
    const isExpired = coupon?.expiresAt && coupon.expiresAt.getTime() < Date.now();
    const limitReached = coupon?.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit;

    if (coupon && !isExpired && !limitReached && cart.subtotal >= (coupon.minSubtotal || 0)) {
      if (coupon.type === 'percentage') {
        cart.discount = Math.min(cart.subtotal, (cart.subtotal * coupon.value) / 100);
      } else {
        cart.discount = Math.min(cart.subtotal, coupon.value);
      }
    } else {
      cart.couponCode = undefined;
    }
  }

  cart.total = Math.max(0, cart.subtotal - cart.discount);
};
