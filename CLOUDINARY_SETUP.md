# 🖼️ Cloudinary Setup Instructions for Slocial

## Why This Is Needed
Your uploaded images disappear because Render's filesystem is ephemeral (temporary). Any files saved to disk are lost when the container restarts. Cloudinary provides permanent cloud storage for images.

## Step 1: Create Free Cloudinary Account

1. Go to https://cloudinary.com/users/register/free
2. Sign up for a free account (you get 25GB storage + 25GB bandwidth/month - plenty!)
3. Verify your email

## Step 2: Get Your Credentials

1. Log into Cloudinary Dashboard: https://console.cloudinary.com/console
2. You'll see your credentials on the dashboard:
   - **Cloud Name**: (e.g., `dxxxxxxx`)
   - **API Key**: (e.g., `123456789012345`)
   - **API Secret**: (e.g., `AbCdEfGhIjKlMnOpQrStUvWxYz`)

**⚠️ Keep these secret, especially the API Secret!**

## Step 3: Add to Render Environment Variables

1. Go to your Render Dashboard: https://dashboard.render.com
2. Click on your `slocial` service
3. Go to **Environment** tab on the left
4. Click **Add Environment Variable** and add these three:

   | Key | Value |
   |-----|-------|
   | `CLOUDINARY_CLOUD_NAME` | Your Cloud Name from step 2 |
   | `CLOUDINARY_API_KEY` | Your API Key from step 2 |
   | `CLOUDINARY_API_SECRET` | Your API Secret from step 2 |

5. Click **Save Changes**

## Step 4: Deploy

The code is already set up! Just:

```bash
git add -A
git commit -m "Add Cloudinary for persistent image storage"
git push
```

Render will automatically redeploy with the new environment variables.

## Step 5: Test It

1. Once deployed, go to your Mosaics page
2. Create a new mosaic with an image upload
3. Refresh the page - the image should still be there!
4. Check back in an hour - it will still be there (unlike before)

## How It Works

- Images are uploaded directly to Cloudinary's cloud storage
- Each image gets a permanent URL (like `https://res.cloudinary.com/...`)
- Images are automatically optimized (max 800x800px to save bandwidth)
- They persist forever (or until you delete them)

## Fallback

If Cloudinary isn't configured, the app falls back to local storage (good for development, but images won't persist on Render).

## Troubleshooting

**Images still disappearing?**
- Make sure all 3 environment variables are set correctly in Render
- Check Render logs for "Cloudinary not configured" message
- Verify your Cloudinary credentials are correct

**Getting errors when uploading?**
- Check your Cloudinary dashboard for usage limits
- Make sure file is under 5MB
- Only jpg, png, gif, webp formats are allowed

## Managing Your Images

You can see all uploaded images in your Cloudinary Media Library:
https://console.cloudinary.com/console/media_library

They'll be in the `slocial/tags` folder.

---

That's it! Your mosaic images will now persist forever. 🎉
