# Testing AI Insights Endpoint in Postman

## Endpoint Details

- **Method**: `POST`
- **URL**: `https://am-email-tracking.onrender.com/generate-insights`
  - For local testing: `http://localhost:3000/generate-insights`
- **Content-Type**: `application/json`

## Request Body

```json
{
  "buyer_id": "amorphious"
}
```

**Required Field:**
- `buyer_id` (string): The user_id/buyer_id for which to generate email insights

## Step-by-Step Postman Setup

### 1. Create a New Request
1. Open Postman
2. Click **New** → **HTTP Request**
3. Name it: "Generate AI Insights"

### 2. Configure the Request
1. **Method**: Select `POST` from the dropdown
2. **URL**: Enter `https://am-email-tracking.onrender.com/generate-insights`
   - Or use your local URL: `http://localhost:3000/generate-insights`

### 3. Set Headers
1. Click on the **Headers** tab
2. Add header:
   - **Key**: `Content-Type`
   - **Value**: `application/json`

### 4. Set Body
1. Click on the **Body** tab
2. Select **raw**
3. Select **JSON** from the dropdown (on the right)
4. Enter the request body:
   ```json
   {
     "buyer_id": "amorphious"
   }
   ```
   - Replace `"amorphious"` with the actual `buyer_id` you want to test

### 5. Send the Request
Click the **Send** button

## Expected Response

### Success Response (200 OK)
```json
{
  "success": true,
  "data": {
    "buyer_id": "amorphious",
    "email_insight": {
      "summary": {
        "total_emails_sent": 4,
        "emails_opened": 3,
        "emails_replied": 2,
        "avg_reply_time_seconds": 2100,
        "engagement_score": 78
      },
      "latest_email_insight": {
        "engagement_level": "HIGH",
        "buyer_intent": "INTERESTED",
        "urgency_level": "MEDIUM",
        "sentiment": "POSITIVE",
        "next_best_action": "CALL_BUYER",
        "confidence_score": 0.86
      },
      "history": [
        {
          "email_id": "...",
          "sentAt": "2025-12-29T09:22:15.680Z",
          "insight": {
            "buyer_intent": "INTERESTED",
            "sentiment": "POSITIVE"
          }
        }
      ]
    },
    "call_insight": {
      "last_call_outcome": "NO_ANSWER",
      "preferred_call_time": "EVENING"
    },
    "whatsapp_insight": {
      "preferred": true
    },
    "overall_buyer_profile": {
      "engagement_level": "HIGH",
      "preferred_channel": "EMAIL",
      "decision_stage": "CONSIDERATION"
    }
  },
  "message": "Insights generated successfully for buyer_id: amorphious"
}
```

### Error Response - Missing buyer_id (400 Bad Request)
```json
{
  "success": false,
  "error": "buyer_id is required"
}
```

### Error Response - No Emails Found (500 Internal Server Error)
```json
{
  "success": false,
  "error": "No emails found for buyer_id: amorphious"
}
```

### Error Response - OpenAI Not Configured (500 Internal Server Error)
```json
{
  "success": false,
  "error": "OpenAI not configured. Please set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT"
}
```

## Testing Tips

### 1. Test with Existing Buyer ID
- Use a `buyer_id` that has emails sent (e.g., `"amorphious"` based on previous tests)
- This ensures you get actual insights from real email data

### 2. Test with Non-Existent Buyer ID
- Use a `buyer_id` that doesn't exist: `"test-buyer-123"`
- Expected: Error "No emails found for buyer_id: test-buyer-123"

### 3. Test Missing buyer_id
- Send request without `buyer_id` field or with empty string
- Expected: Error "buyer_id is required"

### 4. Check Console Logs
The endpoint logs important information:
- `📊 Generating insights for buyer_id: {buyer_id}`
- `📧 Found X emails for buyer_id: {buyer_id}`
- `✅ Retrieved Graph API details...`
- `🤖 Analyzing email with AI...`

## Example Test Cases

### Test Case 1: Valid Buyer ID
```json
{
  "buyer_id": "amorphious"
}
```
**Expected**: Success with full insights

### Test Case 2: Another Valid Buyer ID
```json
{
  "buyer_id": "buyer-123"
}
```
**Expected**: Success with insights (if emails exist for this buyer)

### Test Case 3: Invalid/Missing buyer_id
```json
{}
```
**Expected**: 400 error - "buyer_id is required"

### Test Case 4: Non-Existent Buyer ID
```json
{
  "buyer_id": "nonexistent-buyer-999"
}
```
**Expected**: 500 error - "No emails found for buyer_id: nonexistent-buyer-999"

## Postman Collection JSON

You can import this into Postman:

```json
{
  "info": {
    "name": "AI Insights API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Generate Insights",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"buyer_id\": \"amorphious\"\n}"
        },
        "url": {
          "raw": "https://am-email-tracking.onrender.com/generate-insights",
          "protocol": "https",
          "host": ["am-email-tracking", "onrender", "com"],
          "path": ["generate-insights"]
        }
      }
    }
  ]
}
```

## What Happens Behind the Scenes

1. **Fetches Emails**: Queries Cosmos DB for all emails with matching `buyer_id` (limited to last 10 emails)
2. **Calculates Summary**: Computes statistics (total sent, opened, replied, engagement score, etc.)
3. **AI Analysis**: Sends latest email to OpenAI for insight generation
4. **Builds History**: Creates insight history for all emails
5. **Saves to DB**: Saves/updates tracking summary in `COSMOS_CONTAINER_TRACKING_SUMMARY`
6. **Returns Summary**: Returns complete tracking summary with AI insights

## Troubleshooting

### Issue: "OpenAI not configured"
**Solution**: Ensure these environment variables are set:
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT`

### Issue: "No emails found"
**Solution**: 
- Verify the `buyer_id` matches the `user_id` used when sending emails
- Check that emails exist in Cosmos DB for this buyer_id
- Use the same `user_id` that was used in `/send-email` endpoint

### Issue: Timeout
**Solution**: 
- AI processing can take 10-30 seconds
- Increase Postman timeout settings
- Check server logs for errors

### Issue: 404 Not Found
**Solution**:
- Verify the URL is correct
- Check if the service is deployed and running
- Ensure you're using the correct base URL (Render vs localhost)

