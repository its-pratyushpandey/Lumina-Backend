import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
  name: {
    type: String,
    required: true,
    trim: true
  },
  brand: {
    type: String,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true
  },
  subCategory: {
    type: String,
    trim: true,
  },
  description: {
    type: String,
    required: true
  },
  shortDescription: String,
  price: {
    type: Number,
    required: true
  },
  compareAtPrice: Number,
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  images: [{
    url: String,
    publicId: String
  }],
  sku: {
    type: String,
    required: true,
    unique: true
  },
  stock: {
    type: Number,
    required: true,
    default: 0
  },
  variants: [{
    name: String,
    values: [String]
  }],
  tags: [String],
  isFeatured: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  rating: {
    type: Number,
    default: 0
  },
  reviewCount: {
    type: Number,
    default: 0
  }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Structured catalog virtuals (keeps existing fields intact)
productSchema.virtual('id').get(function id() {
  return this._id?.toString();
});

productSchema.virtual('title').get(function title() {
  return this.name;
});

productSchema.virtual('fullDescription').get(function fullDescription() {
  return this.description;
});

productSchema.virtual('discountPercentage').get(function discountPercentage() {
  const price = Number(this.price);
  const compareAtPrice = Number(this.compareAtPrice);
  if (!Number.isFinite(price) || !Number.isFinite(compareAtPrice)) return 0;
  if (compareAtPrice <= price) return 0;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
});

productSchema.virtual('finalPrice').get(function finalPrice() {
  return this.price;
});

productSchema.virtual('thumbnail').get(function thumbnail() {
  return this.images?.[0]?.url || '';
});

productSchema.index({ name: 'text', description: 'text', tags: 'text' });

export default mongoose.model('Product', productSchema);