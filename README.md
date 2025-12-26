# Email Tracking Services

Complete email tracking system with open tracking, reply tracking, delivery tracking, and bounce detection.

## Services

### Email Service (Port 3000)
- Send emails via Microsoft Graph API
- Track replies via webhooks
- Track delivery/bounce status
- Store logs in Cosmos DB

### Tracking Service (Port 3001)
- Serve tracking pixels
- Track email opens
- Update Cosmos DB

## Local Development

### Email Service
```bash
cd email-service
npm install
cp .env.example .env  # Configure your environment
npm run dev
```

### Tracking Service
```bash
cd tracking-service
npm install
cp .env.example .env  # Configure your environment
npm run dev
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Render deployment instructions.

## Features

- ✅ Email sending with Microsoft Graph
- ✅ Open tracking with pixel
- ✅ Reply tracking via webhooks
- ✅ Delivery/bounce detection
- ✅ Cosmos DB logging
- ✅ Human-readable timestamps
- ✅ User ID partition key support
