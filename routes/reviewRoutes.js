import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import { getReviewsForProduct, upsertMyReview, deleteReview } from '../controllers/reviewController.js';

const router = express.Router();

router.get('/product/:productId', getReviewsForProduct);
router.post('/product/:productId', protect, upsertMyReview);
router.delete('/:reviewId', protect, admin, deleteReview);

export default router;
