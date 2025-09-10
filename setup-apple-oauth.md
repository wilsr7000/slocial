# Apple Sign-In Setup Guide for Slocial

## Prerequisites
- Apple Developer Account ($99/year) - https://developer.apple.com/
- Access to Certificates, Identifiers & Profiles section

## Step 1: Create an App ID

1. Go to [Apple Developer](https://developer.apple.com/account/resources/identifiers/list)
2. Click the **+** button to create a new identifier
3. Select **App IDs** and click **Continue**
4. Select **App** as the type and click **Continue**
5. Fill in:
   - **Description**: Slocial
   - **Bundle ID**: Choose **Explicit** and enter: `com.slocial.web`
   - **Capabilities**: Check **Sign in with Apple**
6. Click **Continue**, then **Register**

## Step 2: Create a Services ID

1. Go back to [Identifiers](https://developer.apple.com/account/resources/identifiers/list)
2. Click the **+** button
3. Select **Services IDs** and click **Continue**
4. Fill in:
   - **Description**: Slocial Web Service
   - **Identifier**: `com.slocial.web.service`
5. Click **Continue**, then **Register**
6. Click on your new Service ID from the list
7. Check **Sign in with Apple**
8. Click **Configure** button
9. Configure Sign in with Apple:
   - **Primary App ID**: Select the App ID you created (com.slocial.web)
   - **Domains and Subdomains**: 
     - Add: `slocial.onrender.com`
     - Add: `localhost` (for testing)
   - **Return URLs**: 
     - Add: `https://slocial.onrender.com/auth/apple/callback`
     - Add: `http://localhost:3000/auth/apple/callback`
10. Click **Next**, then **Done**, then **Continue**, then **Save**

## Step 3: Create a Private Key

1. Go to [Keys](https://developer.apple.com/account/resources/authkeys/list)
2. Click the **+** button
3. Fill in:
   - **Key Name**: Slocial Auth Key
   - Check **Sign in with Apple**
4. Click **Continue**, then **Register**
5. **IMPORTANT**: Download the key file (AuthKey_XXXXXXXXXX.p8)
   - ⚠️ You can only download this once!
   - Save it securely
   - Note the **Key ID** shown (10 characters, like `ABC123DEFG`)

## Step 4: Get Your Team ID

1. Go to [Membership](https://developer.apple.com/account)
2. Your **Team ID** is shown under your name (10 characters, like `D1234567890`)

## Step 5: Configure Environment Variables

### For Local Development (.env file):
```
APPLE_SERVICE_ID=com.slocial.web.service
APPLE_TEAM_ID=YOUR_TEAM_ID_HERE
APPLE_KEY_ID=YOUR_KEY_ID_HERE
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
YOUR_PRIVATE_KEY_CONTENT_HERE
-----END PRIVATE KEY-----"
APPLE_CALLBACK_URL=http://localhost:3000/auth/apple/callback
```

### For Production (Render Dashboard):
Add these environment variables:
- `APPLE_SERVICE_ID` = `com.slocial.web.service`
- `APPLE_TEAM_ID` = Your 10-character Team ID
- `APPLE_KEY_ID` = Your 10-character Key ID
- `APPLE_PRIVATE_KEY` = Full contents of the .p8 file (including BEGIN/END lines)
- `APPLE_CALLBACK_URL` = `https://slocial.onrender.com/auth/apple/callback`

## Step 6: Format the Private Key

The private key from the .p8 file needs to be properly formatted:

1. Open the downloaded .p8 file in a text editor
2. Copy the entire contents including:
   ```
   -----BEGIN PRIVATE KEY-----
   [multiple lines of key data]
   -----END PRIVATE KEY-----
   ```
3. For the .env file, wrap it in quotes
4. For Render, paste it exactly as is

## Step 7: Test Apple Sign-In

1. Restart your local server: `npm run dev`
2. Visit http://localhost:3000/login
3. Click "Continue with Apple"
4. You should see Apple's sign-in page

## Troubleshooting

### Common Issues:

1. **"Invalid client" error**:
   - Check Service ID matches exactly
   - Verify domain and return URLs are configured in Apple Developer

2. **"Invalid request" error**:
   - Private key format is incorrect
   - Team ID or Key ID is wrong

3. **Callback URL mismatch**:
   - Ensure the callback URL in your environment matches exactly what's configured in Apple

### Testing Tips:

- Apple Sign-In requires HTTPS in production
- Use Safari for best testing experience
- You can test with your Apple ID
- Apple provides limited user info (only email on first sign-in)

## Security Notes

- Never commit the .p8 file or private key to Git
- Keep your private key secure
- Rotate keys periodically
- Use different Service IDs for dev/staging/production if needed

## Resources

- [Apple Sign-In Documentation](https://developer.apple.com/sign-in-with-apple/)
- [Apple Sign-In Guidelines](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple/overview/)
- [JWT Debugger](https://jwt.io/) - For debugging Apple tokens
