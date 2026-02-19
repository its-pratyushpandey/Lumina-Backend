import express from 'express';
import { 
  getProducts, 
  getProductBySlug, 
  semanticProductSearch,
  createProduct, 
  updateProduct, 
  deleteProduct 
} from '../controllers/productController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', getProducts);
router.get('/search/semantic', semanticProductSearch);
router.get('/:slug', getProductBySlug);
router.post('/', protect, admin, createProduct);
router.put('/:id', protect, admin, updateProduct);
router.delete('/:id', protect, admin, deleteProduct);

export default router;