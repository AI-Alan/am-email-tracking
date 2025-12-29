# Render Deployment - URL Update Flow

## 🔄 The Circular Dependency Problem

After deploying both services, you'll have:
- **Email Service URL:** `https://agent-mira-email-service.onrender.com`
- **Tracking Service URL:** `https://agent-mira-tracking-service.onrender.com`

But email-service needs tracking-service URL, and both need to be deployed first!

---

## ✅ Solution: Deploy in Stages

### Stage 1: Initial Deployment (Without Cross-Service URLs)

**Deploy Email Service:**
1. Render Dashboard → New Web Service
2. Root Directory: `email-service`
3. Environment Variables:
   ```
   COSMOS_URI=...
   COSMOS_KEY=...
   COSMOS_DATABASE_REALTOR_MANAGEMENT=...
   COSMOS_CONTAINER_EMAIL=...
   COSMOS_CONTAINER_TRACKING_SUMMARY=trackingSummary
   CLIENT_ID=...
   TENANT_ID=...
   CLIENT_SECRET=...
   SENDER_EMAIL=...
   WEBHOOK_URL=https://agent-mira-email-service.onrender.com/graph/webhook
   TRACKING_SERVICE_URL=http://localhost:3001  # Temporary
   AZURE_OPENAI_ENDPOINT=...  # Optional, for AI insights
   AZURE_OPENAI_API_KEY=...   # Optional, for AI insights
   AZURE_OPENAI_DEPLOYMENT=gpt-4  # Optional, for AI insights
   ```

**Deploy Tracking Service:**
1. New Web Service
2. Root Directory: `tracking-service`
3. Environment Variables:
   ```
   COSMOS_URI=...
   COSMOS_KEY=...
   COSMOS_DATABASE_REALTOR_MANAGEMENT=...
   COSMOS_CONTAINER_EMAIL=...
   ```

### Stage 2: Update Email Service with Tracking URL

After both services are deployed:

1. Go to **Email Service** settings
2. Update environment variable:
   ```
   TRACKING_SERVICE_URL=https://agent-mira-tracking-service.onrender.com
   ```
3. Click **"Save"** - Render will auto-redeploy

---

## 📋 Step-by-Step Deployment

### 1. Push to GitHub
```bash
cd /Users/amankumaryadav/Desktop/Agent\ Mira/Email_tracking
git add .
git commit -m "Email tracking microservices ready for deployment"
git push origin main
```

### 2. Deploy Email Service
- **Name:** `agent-mira-email-service`
- **Build:** `npm install && npm run build`
- **Start:** `npm start`
- **Root Directory:** `email-service`
- Add all environment variables (use localhost for TRACKING_SERVICE_URL initially)

### 3. Deploy Tracking Service
- **Name:** `agent-mira-tracking-service`
- **Build:** `npm install && npm run build`
- **Start:** `npm start`
- **Root Directory:** `tracking-service`
- Add Cosmos DB environment variables

### 4. Update Email Service
- Copy tracking service URL: `https://agent-mira-tracking-service.onrender.com`
- Go to email service → Environment
- Update: `TRACKING_SERVICE_URL=https://agent-mira-tracking-service.onrender.com`
- Save (auto-redeploys)

### 5. Update Webhook URL
- Update: `WEBHOOK_URL=https://agent-mira-email-service.onrender.com/graph/webhook`
- Save

---

## 🎯 Final Environment Variables

**Email Service:**
```env
COSMOS_URI=https://your-cosmos-account.documents.azure.com:443/
COSMOS_KEY=your-cosmos-key-here
COSMOS_DATABASE_REALTOR_MANAGEMENT=RealtorManagementDB(realtor_and_above_access)
COSMOS_CONTAINER_EMAIL=trackingData
COSMOS_CONTAINER_TRACKING_SUMMARY=trackingSummary
CLIENT_ID=your-client-id
TENANT_ID=your-tenant-id
CLIENT_SECRET=your-client-secret
SENDER_EMAIL=your-email@domain.com
WEBHOOK_URL=https://agent-mira-email-service.onrender.com/graph/webhook
TRACKING_SERVICE_URL=https://agent-mira-tracking-service.onrender.com
AZURE_OPENAI_ENDPOINT=https://your-openai-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-openai-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4
```

**Tracking Service:**
```env
COSMOS_URI=https://your-cosmos-account.documents.azure.com:443/
COSMOS_KEY=your-cosmos-key-here
COSMOS_DATABASE_REALTOR_MANAGEMENT=RealtorManagementDB(realtor_and_above_access)
COSMOS_CONTAINER_EMAIL=trackingData
```

---

## ⚡ Quick Summary

1. **Deploy both services** with temporary URLs
2. **Get actual Render URLs** after deployment
3. **Update email-service** with tracking-service URL
4. **Render auto-redeploys** with correct URL
5. **Done!** Tracking pixel now uses public URL

Ready to push to GitHub?
