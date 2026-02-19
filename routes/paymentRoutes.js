import express from 'express';
import { protect } from '../middleware/auth.js';
import { createPaymentIntent, confirmStripeOrder } from '../controllers/paymentController.js';

const router = express.Router();

router.post('/stripe/payment-intent', protect, createPaymentIntent);
router.post('/stripe/confirm', protect, confirmStripeOrder);

export default router;
