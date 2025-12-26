# Reply Tracking Setup Guide

## ⚠️ Reply Tracking Requires Webhook Subscription

Reply tracking works via **Microsoft Graph webhook subscriptions**. You need to set this up for replies to be tracked.

---

## 🔧 Setup Steps

### 1. Verify Webhook URL is Accessible

Your webhook URL: `https://am-email-tracking.onrender.com/graph/webhook`

Test it:
```bash
curl https://am-email-tracking.onrender.com/graph/webhook
```

Should return: `Cannot GET /graph/webhook` (POST only)

### 2. Create Graph Subscription

Run the subscription setup script:

```bash
# Locally (update .env with Render webhook URL first)
cd email-service
WEBHOOK_URL=https://am-email-tracking.onrender.com/graph/webhook npm run setup-subscription
```

Or create manually via Graph API:
```bash
POST https://graph.microsoft.com/v1.0/subscriptions
{
  "changeType": "created",
  "notificationUrl": "https://am-email-tracking.onrender.com/graph/webhook",
  "resource": "me/mailFolders('Inbox')/messages",
  "expirationDateTime": "2025-12-29T18:00:00.0000000Z",
  "clientState": "secretClientValue"
}
```

### 3. Verify Subscription

Check active subscriptions:
```bash
GET https://graph.microsoft.com/v1.0/subscriptions
```

---

## 🧪 Testing Reply Tracking

1. **Send test email** via Postman
2. **Reply to the email** from your inbox
3. **Check Render logs** for webhook notification
4. **Check Cosmos DB** for `repliedAt` field

**Expected logs:**
```
🔔 Webhook received: {} 1 notifications
💬 Attempting to track reply for: {messageId} from {email}
💬 Reply tracked: {messageId} from {email} (count: 1)
```

---

## 📋 Current Status

✅ **Open Tracking** - Working  
⏳ **Reply Tracking** - Needs webhook subscription  
⏳ **Delivery Tracking** - Needs webhook subscription

**Next:** Set up Graph webhook subscription to enable reply/delivery tracking.
