import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import { listUsers, updateUserRole, getAdminInsights } from '../controllers/adminController.js';

const router = express.Router();

router.get('/insights', protect, admin, getAdminInsights);
router.get('/users', protect, admin, listUsers);
router.put('/users/:userId/role', protect, admin, updateUserRole);

export default router;
