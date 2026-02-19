import Category from '../models/Category.js';
import { slugify, ensureUniqueSlug } from '../utils/slugify.js';

export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getCategoryBySlug = async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug, isActive: true });
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createCategory = async (req, res) => {
  try {
    const payload = { ...req.body };

    if (!payload.name) {
      return res.status(400).json({ message: 'name is required' });
    }

    if (!payload.slug) {
      const baseSlug = slugify(payload.name);
      payload.slug = await ensureUniqueSlug({ model: Category, baseSlug });
    }

    const category = await Category.create(payload);
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const payload = { ...req.body };

    if (payload.name && !payload.slug) {
      const baseSlug = slugify(payload.name);
      let candidate = baseSlug;
      let suffix = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await Category.exists({ slug: candidate, _id: { $ne: req.params.id } });
        if (!exists) break;
        candidate = `${baseSlug}-${suffix}`;
        suffix += 1;
      }
      payload.slug = candidate;
    }

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};