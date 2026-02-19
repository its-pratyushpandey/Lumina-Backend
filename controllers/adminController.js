import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';

export const listUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, q } = req.query;

    const query = {};
    if (q) {
      query.$or = [
        { name: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
      ];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    res.json({
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'role must be user or admin' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { role },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getAdminInsights = async (req, res) => {
  try {
    const lowStockThreshold = Number(process.env.INVENTORY_LOW_STOCK_THRESHOLD || 5);

    const [
      totalOrders,
      revenueResult,
      totalUsers,
      lowStockProducts,
      recentOrders,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.aggregate([
        { $match: { paymentStatus: 'completed' } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      User.countDocuments(),
      Product.find({ isActive: true, stock: { $lte: lowStockThreshold } })
        .select('name slug sku stock')
        .sort({ stock: 1 })
        .limit(10),
      Order.find()
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    const totalRevenue = revenueResult[0]?.total || 0;

    res.json({
      totalOrders,
      totalRevenue,
      totalUsers,
      lowStockThreshold,
      lowStockProducts,
      recentOrders,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
