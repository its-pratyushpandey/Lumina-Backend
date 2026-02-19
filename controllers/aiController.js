import ChatHistory from '../models/ChatHistory.js';
import Product from '../models/Product.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import { chatWithGrok, generateProductDescription, GrokApiError, GrokConfigError } from '../services/grokService.js';

export const chat = async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ message: 'message is required' });
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ message: 'sessionId is required' });
    }
    
    let chatHistory = await ChatHistory.findOne({
      user: req.user._id,
      sessionId
    });
    
    if (!chatHistory) {
      chatHistory = await ChatHistory.create({
        user: req.user._id,
        sessionId,
        messages: []
      });
    }
    
    chatHistory.messages.push({
      role: 'user',
      content: message
    });
    
    const conversationMessages = [
      {
        role: 'system',
        content: 'You are Lumina, a helpful AI shopping assistant for an e-commerce platform. Help users find products, answer questions, provide recommendations, and assist with their shopping experience. Be friendly, concise, and helpful.'
      },
      ...chatHistory.messages.slice(-10).map(m => ({
        role: m.role,
        content: m.content
      }))
    ];
    
    const response = await chatWithGrok(conversationMessages);
    
    if (response.message.tool_calls) {
      const toolCall = response.message.tool_calls[0];
      const functionName = toolCall.function.name;
      let functionArgs = {};
      try {
        functionArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        return res.status(502).json({ message: 'AI tool call arguments were invalid JSON' });
      }
      
      let functionResult;
      
      if (functionName === 'search_products') {
        const query = { isActive: true };
        
        if (functionArgs.category) {
          const Category = (await import('../models/Category.js')).default;
          const cat = await Category.findOne({ 
            name: new RegExp(functionArgs.category, 'i') 
          });
          if (cat) query.category = cat._id;
        }
        
        if (functionArgs.minPrice || functionArgs.maxPrice) {
          query.price = {};
          if (functionArgs.minPrice) query.price.$gte = functionArgs.minPrice;
          if (functionArgs.maxPrice) query.price.$lte = functionArgs.maxPrice;
        }
        
        let products;
        if (functionArgs.query) {
          // Prefer text search (fast + relevant) but fall back safely for fresh/dev DBs
          // where indexes may not exist yet.
          query.$text = { $search: functionArgs.query };
          try {
            products = await Product.find(query).limit(5);
          } catch (error) {
            const { $text, ...rest } = query;
            const regex = new RegExp(String(functionArgs.query), 'i');
            products = await Product.find({
              ...rest,
              $or: [{ name: regex }, { description: regex }, { tags: regex }],
            }).limit(5);
          }
        } else {
          products = await Product.find(query).limit(5);
        }

        functionResult = products;
      } else if (functionName === 'get_product_details') {
        const product = await Product.findById(functionArgs.productId);
        functionResult = product;
      } else if (functionName === 'get_cart_info') {
        const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
        functionResult = cart;
      } else if (functionName === 'track_order') {
        const order = await Order.findOne({ 
          orderNumber: functionArgs.orderNumber,
          user: req.user._id 
        });
        functionResult = order;
      }
      
      conversationMessages.push(response.message);
      conversationMessages.push({
        role: 'tool',
        content: JSON.stringify(functionResult),
        tool_call_id: toolCall.id
      });
      
      const finalResponse = await chatWithGrok(conversationMessages);
      
      chatHistory.messages.push({
        role: 'assistant',
        content: finalResponse.message.content
      });
      
      await chatHistory.save();
      
      return res.json({
        message: finalResponse.message.content,
        functionCalled: functionName,
        data: functionResult
      });
    }
    
    chatHistory.messages.push({
      role: 'assistant',
      content: response.message.content
    });
    
    await chatHistory.save();
    
    res.json({ message: response.message.content });
  } catch (error) {
    if (error instanceof GrokConfigError) {
      return res.status(503).json({
        message:
          'AI is not configured correctly on the server. Please verify GROK_API_KEY and (optionally) GROK_API_BASE_URL/GROK_CHAT_MODEL.',
        error: error.message,
      });
    }

    if (error instanceof GrokApiError) {
      const isAuth = error.status === 401 || error.status === 403;
      const isRateLimited = error.status === 429;
      const status = isAuth || isRateLimited ? 503 : 502;

      return res.status(status).json({
        message:
          'AI provider request failed. Check server AI configuration and provider availability.',
        provider: error.provider,
        upstreamStatus: error.status,
        // Avoid dumping provider payloads in production.
        upstream:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                baseUrl: error.baseUrl,
                model: error.model,
                body: error.upstreamBody,
              },
      });
    }

    console.error('Chat error:', error);
    res.status(500).json({ message: error?.message || 'Internal Server Error' });
  }
};

export const generateDescription = async (req, res) => {
  try {
    const { name, category, features, priceRange } = req.body;

    if (!name || !category) {
      return res.status(400).json({ message: 'name and category are required' });
    }
    
    const description = await generateProductDescription({
      name,
      category,
      features,
      priceRange
    });
    
    res.json({ description });
  } catch (error) {
    if (error instanceof GrokConfigError) {
      return res.status(503).json({
        message:
          'AI is not configured correctly on the server. Please verify GROK_API_KEY and (optionally) GROK_API_BASE_URL/GROK_CHAT_MODEL.',
        error: error.message,
      });
    }

    if (error instanceof GrokApiError) {
      const isAuth = error.status === 401 || error.status === 403;
      const isRateLimited = error.status === 429;
      const status = isAuth || isRateLimited ? 503 : 502;

      return res.status(status).json({
        message:
          'AI provider request failed. Check server AI configuration and provider availability.',
        provider: error.provider,
        upstreamStatus: error.status,
        upstream:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                baseUrl: error.baseUrl,
                model: error.model,
                body: error.upstreamBody,
              },
      });
    }

    res.status(500).json({ message: error?.message || 'Internal Server Error' });
  }
};

export const getChatHistory = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const chatHistory = await ChatHistory.findOne({
      user: req.user._id,
      sessionId
    });
    
    if (!chatHistory) {
      return res.json({ messages: [] });
    }
    
    res.json({ messages: chatHistory.messages });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};