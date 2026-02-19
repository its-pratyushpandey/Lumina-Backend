import express from 'express';
import { getUploadSignature, deleteImage } from '../controllers/cloudinaryController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

router.get('/signature', protect, admin, getUploadSignature);
router.delete('/delete', protect, admin, deleteImage);

export default router;