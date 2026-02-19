import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';

const recomputeProductRating = async (productId) => {
  const stats = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    {
      $group: {
        _id: '$product',
        avgRating: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);

  const avgRating = stats[0]?.avgRating || 0;
  const count = stats[0]?.count || 0;

  await Product.findByIdAndUpdate(productId, {
    rating: Math.round(avgRating * 10) / 10,
    reviewCount: count,
  });
};

export const getReviewsForProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const reviews = await Review.find({ product: productId })
      .populate('user', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ reviews });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const upsertMyReview = async (req, res) => {
  try {
    const { productId } = req.params;
    const { rating, comment } = req.body;

    if (!rating || !comment) {
      return res.status(400).json({ message: 'rating and comment are required' });
    }

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const hasPurchased = await Order.exists({
      user: req.user._id,
      'items.product': product._id,
      paymentStatus: 'completed',
    });

    const review = await Review.findOneAndUpdate(
      { product: product._id, user: req.user._id },
      {
        product: product._id,
        user: req.user._id,
        rating: Number(rating),
        comment: String(comment).trim(),
        isVerifiedPurchase: Boolean(hasPurchased),
      },
      { new: true, upsert: true, runValidators: true }
    ).populate('user', 'name avatar');

    await recomputeProductRating(productId);

    res.status(201).json({ review });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'You already reviewed this product' });
    }
    res.status(500).json({ message: error.message });
  }
};

export const deleteReview = async (req, res) => {
  try {
    const { reviewId } = req.params;

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    await review.deleteOne();
    await recomputeProductRating(review.product);

    res.json({ message: 'Review deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
