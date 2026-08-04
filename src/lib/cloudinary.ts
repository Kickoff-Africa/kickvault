import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

export async function uploadAvatar(
  buffer: Buffer,
  userId: string,
  existingPublicId?: string | null,
): Promise<{ url: string; publicId: string }> {
  // Delete old avatar if one exists
  if (existingPublicId) {
    await cloudinary.uploader.destroy(existingPublicId);
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'kickvault/avatars',
        public_id: `user_${userId}`,
        overwrite: true,
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Upload failed'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    uploadStream.end(buffer);
  });
}

export async function deleteAvatar(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}
