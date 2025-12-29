# Tracking Summary Container Setup

## ✅ Container Status
- **Container Name**: `trackingSummary`
- **Container Exists**: ✅ Yes (confirmed in Cosmos DB)

## ⚙️ Required Configuration

### 1. Environment Variable
Add this to your **Render environment variables** for email-service:

```
COSMOS_CONTAINER_TRACKING_SUMMARY=trackingSummary
```

### 2. Partition Key Verification
The `trackingSummary` container **must** have partition key: `/buyer_id`

**To verify in Azure Portal:**
1. Go to Cosmos DB Data Explorer
2. Select `trackingSummary` container
3. Click **Settings** tab
4. Check **Partition key**: Should be `/buyer_id`

**If partition key is different:**
- Option 1: Create a new container with partition key `/buyer_id`
- Option 2: Update the code to match your existing partition key (if it's `/id`, we'd need to change the query logic)

## 📋 Data Structure

The `TrackingSummary` document structure:
```json
{
  "buyer_id": "amorphious",  // ← Used as partition key
  "email_insight": { ... },
  "call_insight": { ... },
  "whatsapp_insight": { ... },
  "overall_buyer_profile": { ... },
  "createdAt": "2025-12-29T10:00:00.000Z",
  "updatedAt": "2025-12-29T10:00:00.000Z"
}
```

## 🔍 How to Check Current Partition Key

1. **Azure Portal**:
   - Navigate to your Cosmos DB account
   - Go to **Data Explorer**
   - Click on `trackingSummary` container
   - Click **Settings** tab
   - Look for **Partition key** field

2. **If partition key is NOT `/buyer_id`**:
   - You'll need to either:
     - **Recommended**: Recreate the container with partition key `/buyer_id`
     - **Alternative**: Modify the code to use your existing partition key

## 🚀 Quick Fix Steps

1. **Add Environment Variable to Render**:
   ```
   COSMOS_CONTAINER_TRACKING_SUMMARY=trackingSummary
   ```

2. **Verify Partition Key**:
   - Check that partition key is `/buyer_id`
   - If not, either recreate container or update code

3. **Redeploy** (or Render will auto-redeploy when env var is added)

4. **Test**:
   ```bash
   POST https://am-email-tracking.onrender.com/generate-insights
   Body: { "buyer_id": "amorphious" }
   ```

## 🔧 Troubleshooting

### Error: "Cosmos DB Summary Container not initialized"
- **Cause**: Missing `COSMOS_CONTAINER_TRACKING_SUMMARY` environment variable
- **Fix**: Add it to Render environment variables

### Error: "Partition key mismatch" or "Invalid partition key"
- **Cause**: Container partition key doesn't match `/buyer_id`
- **Fix**: Verify partition key in Azure Portal, recreate if needed

### Error: "Container not found"
- **Cause**: Container name mismatch
- **Fix**: Verify container name is exactly `trackingSummary` (case-sensitive)

