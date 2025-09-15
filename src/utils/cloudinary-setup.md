# Cloudinary Setup for Slocial

## Why Cloudinary?
Your uploaded images disappear because Render's filesystem is ephemeral. Cloudinary provides persistent image storage with a generous free tier.

## Quick Setup Steps:

1. **Create Free Cloudinary Account**
   - Go to https://cloudinary.com/users/register/free
   - Sign up for free account (you get 25GB storage, 25GB bandwidth/month)

2. **Get Your Credentials**
   - Go to Dashboard
   - Copy: Cloud Name, API Key, API Secret

3. **Add to Render Environment Variables**
   - In Render dashboard, go to your service
   - Environment > Add:
     - `CLOUDINARY_CLOUD_NAME`: your_cloud_name
     - `CLOUDINARY_API_KEY`: your_api_key  
     - `CLOUDINARY_API_SECRET`: your_api_secret

4. **Install Package Locally**
   ```bash
   npm install cloudinary multer-storage-cloudinary
   ```

5. **Deploy**
   - Commit and push changes
   - Images will now persist!

## Alternative: Use Image URLs
For now, you can use external image hosting services and paste URLs instead of uploading files.
