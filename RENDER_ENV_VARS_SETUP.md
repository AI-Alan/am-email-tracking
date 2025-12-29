# Render Environment Variables Setup

## ⚠️ Important: Render Does NOT Use .env Files

**Your local `.env` file works only for local development.**  
**On Render, you MUST set environment variables in the Render Dashboard.**

---

## 🔧 How to Add Environment Variables in Render

### Step 1: Access Your Service
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click on your **email-service** (likely named `am-email-tracking` or similar)

### Step 2: Navigate to Environment Tab
1. Click on **"Environment"** in the left sidebar
2. Scroll down to **"Environment Variables"** section

### Step 3: Add Missing Variables

Add these **NEW** environment variables:

```
COSMOS_CONTAINER_TRACKING_SUMMARY=trackingSummary
AZURE_OPENAI_ENDPOINT=https://your-openai-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-openai-api-key-here
AZURE_OPENAI_DEPLOYMENT=gpt-4
```

### Step 4: Verify Existing Variables

Make sure these are already set (they should be from your initial setup):

```
COSMOS_URI=https://your-cosmos-account.documents.azure.com:443/
COSMOS_KEY=your-cosmos-key
COSMOS_DATABASE_REALTOR_MANAGEMENT=RealtorManagementDB(realtor_and_above_access)
COSMOS_CONTAINER_EMAIL=trackingData
CLIENT_ID=...
TENANT_ID=...
CLIENT_SECRET=...
SENDER_EMAIL=...
WEBHOOK_URL=https://am-email-tracking.onrender.com/graph/webhook
TRACKING_SERVICE_URL=https://am-trackin-service.onrender.com
```

### Step 5: Save and Redeploy
1. Click **"Save Changes"** at the bottom
2. Render will **automatically redeploy** your service
3. Wait for deployment to complete (~2-5 minutes)

---

## 📋 Complete List of Required Environment Variables

### Cosmos DB Variables
```
COSMOS_URI=https://your-cosmos-account.documents.azure.com:443/
COSMOS_KEY=your-cosmos-primary-key
COSMOS_DATABASE_REALTOR_MANAGEMENT=RealtorManagementDB(realtor_and_above_access)
COSMOS_CONTAINER_EMAIL=trackingData
COSMOS_CONTAINER_TRACKING_SUMMARY=trackingSummary  ← NEW!
```

### Microsoft Graph API Variables
```
CLIENT_ID=your-azure-app-client-id
TENANT_ID=your-azure-tenant-id
CLIENT_SECRET=your-azure-app-client-secret
SENDER_EMAIL=your-email@domain.com
WEBHOOK_URL=https://am-email-tracking.onrender.com/graph/webhook
```

### Azure OpenAI Variables (Optional - for AI insights)
```
AZURE_OPENAI_ENDPOINT=https://your-openai-resource.openai.azure.com/  ← NEW!
AZURE_OPENAI_API_KEY=your-openai-api-key  ← NEW!
AZURE_OPENAI_DEPLOYMENT=gpt-4  ← NEW!
```

### Service URLs
```
TRACKING_SERVICE_URL=https://am-trackin-service.onrender.com
RENDER_EXTERNAL_URL=https://am-email-tracking.onrender.com  (Auto-set by Render)
PORT=3000  (Auto-set by Render)
```

---

## ✅ Verification

After adding the variables and redeploying:

1. **Check Logs**: Go to **"Logs"** tab in Render
2. **Look for**: 
   - ✅ `✅ Summary container initialized: trackingSummary`
   - ✅ `✅ Email service running on https://...`
   - ❌ Should NOT see: `⚠️ Azure OpenAI not configured...` (if you added OpenAI vars)
   - ❌ Should NOT see: `Cosmos DB Summary Container not initialized...`

3. **Test Endpoint**:
   ```bash
   POST https://am-email-tracking.onrender.com/generate-insights
   Body: { "buyer_id": "amorphious" }
   ```

---

## 🚨 Common Issues

### Issue: "Cosmos DB Summary Container not initialized"
**Solution**: Add `COSMOS_CONTAINER_TRACKING_SUMMARY=trackingSummary` to Render environment variables

### Issue: "Azure OpenAI not configured"
**Solution**: Add `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and `AZURE_OPENAI_DEPLOYMENT` to Render

### Issue: Variables not updating
**Solution**: 
- Make sure you clicked "Save Changes"
- Wait for redeploy to complete
- Clear browser cache and check again

### Issue: Still seeing errors after adding variables
**Solution**:
- Double-check variable names (case-sensitive!)
- Check for extra spaces in values
- Make sure values don't have quotes (Render adds them automatically)
- Restart the service manually if needed

---

## 📝 Notes

- **No quotes needed**: Render will handle quotes automatically
- **Case-sensitive**: `COSMOS_CONTAINER_TRACKING_SUMMARY` not `cosmos_container_tracking_summary`
- **No .env file**: Render ignores `.env` files - must use dashboard
- **Auto-redeploy**: Render automatically redeploys when you save environment variables

