import express from 'express';
import { chat, generateDescription, getChatHistory } from '../controllers/aiController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

router.post('/chat', protect, chat);
router.post('/generate-description', protect, admin, generateDescription);
router.get('/chat-history/:sessionId', protect, getChatHistory);

export default router;