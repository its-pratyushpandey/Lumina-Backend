import cloudinary from '../config/cloudinary.js';

export const getUploadSignature = async (req, res) => {
  try {
    const { folder = 'products', resourceType = 'image' } = req.query;
    
    const allowedFolders = ['products', 'categories', 'users'];
    if (!allowedFolders.includes(folder)) {
      return res.status(400).json({ message: 'Invalid folder path' });
    }
    
    const timestamp = Math.round(Date.now() / 1000);
    
    const params = {
      timestamp,
      folder,
      resource_type: resourceType
    };
    
    const signature = cloudinary.utils.api_sign_request(
      params,
      process.env.CLOUDINARY_API_SECRET
    );
    
    res.json({
      signature,
      timestamp,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      folder,
      resourceType
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteImage = async (req, res) => {
  try {
    const { publicId } = req.body;
    
    if (!publicId) {
      return res.status(400).json({ message: 'Public ID is required' });
    }
    
    const result = await cloudinary.uploader.destroy(publicId, {
      invalidate: true
    });
    
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};