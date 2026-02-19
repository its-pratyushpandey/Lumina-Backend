import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Review from '../models/Review.js';
import { semanticSearch } from '../services/grokService.js';
import { slugify, ensureUniqueSlug } from '../utils/slugify.js';

export const getProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      minPrice,
      maxPrice,
      search,
      sortBy = 'createdAt',
      order = 'desc',
      featured
    } = req.query;

    const query = { isActive: true };
    
    if (category) {
      const cat = await Category.findOne({ slug: category });
      if (cat) query.category = cat._id;
    }
    
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }
    
    if (search) {
      query.$text = { $search: search };
    }
    
    if (featured) {
      query.isFeatured = true;
    }

    const sortOptions = {};
    sortOptions[sortBy] = order === 'asc' ? 1 : -1;

    const total = await Product.countDocuments(query);
    const products = await Product.find(query)
      .populate('category', 'name slug')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v');

    res.json({
      products,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getProductBySlug = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true })
      .populate('category', 'name slug');
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const reviews = await Review.find({ product: product._id })
      .populate('user', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({ product, reviews });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const semanticProductSearch = async (req, res) => {
  try {
    const { query: searchQuery } = req.query;
    
    if (!searchQuery) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const searchParams = await semanticSearch(searchQuery);
    
    const query = { isActive: true };
    
    if (searchParams.category) {
      const cat = await Category.findOne({ 
        name: new RegExp(searchParams.category, 'i') 
      });
      if (cat) query.category = cat._id;
    }
    
    if (searchParams.minPrice || searchParams.maxPrice) {
      query.price = {};
      if (searchParams.minPrice) query.price.$gte = searchParams.minPrice;
      if (searchParams.maxPrice) query.price.$lte = searchParams.maxPrice;
    }
    
    if (searchParams.keywords && searchParams.keywords.length > 0) {
      query.$text = { $search: searchParams.keywords.join(' ') };
    }

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .limit(20);

    res.json({ products, searchParams });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createProduct = async (req, res) => {
  try {
    const payload = { ...req.body };

    if (!payload.name) {
      return res.status(400).json({ message: 'name is required' });
    }
    if (!payload.category) {
      return res.status(400).json({ message: 'category is required' });
    }
    if (!payload.description) {
      return res.status(400).json({ message: 'description is required' });
    }

    if (!payload.slug) {
      const baseSlug = slugify(payload.name);
      payload.slug = await ensureUniqueSlug({ model: Product, baseSlug });
    }

    const product = await Product.create(payload);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const payload = { ...req.body };

    if (payload.name && !payload.slug) {
      const baseSlug = slugify(payload.name);
      // Ensure uniqueness while excluding the current product.
      let candidate = baseSlug;
      let suffix = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await Product.exists({ slug: candidate, _id: { $ne: req.params.id } });
        if (!exists) break;
        candidate = `${baseSlug}-${suffix}`;
        suffix += 1;
      }
      payload.slug = candidate;
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};