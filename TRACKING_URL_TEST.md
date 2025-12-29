# Tracking Pixel URL Testing Guide

## Correct URL Format

The tracking service endpoint is:
```
GET /open/:messageId.png
```

### Correct Test URL:
```
https://am-trackin-service.onrender.com/open/f0b43838-c2d5-4784-b0f3-a2f27d71ab5a.png
```

**Important:**
- Must start with `/open/`
- MessageId is the UUID (no colons before it)
- Must end with `.png`

### ❌ Wrong URL Format (causes 404):
```
https://am-trackin-service.onrender.com/:f0b43838-c2d5-4784-b0f3-a2f27d71ab5a.pn
```

## Postman Test

1. **Method**: GET
2. **URL**: `https://am-trackin-service.onrender.com/open/f0b43838-c2d5-4784-b0f3-a2f27d71ab5a.png`
3. **Expected Response**: 
   - Status: 200 OK
   - Content-Type: image/png
   - Body: Transparent 1x1 PNG image

## Email Service Configuration

Make sure your email service has the correct tracking URL set:

**Environment Variable:**
```
TRACKING_SERVICE_URL=https://am-trackin-service.onrender.com
```

If not set, it will use `RENDER_EXTERNAL_URL` (which might be the email service URL).

## How Tracking Pixel Works

1. Email is sent with tracking pixel: `<img src="https://am-trackin-service.onrender.com/open/{messageId}.png" />`
2. When email is opened, browser requests the pixel image
3. Tracking service receives the request and logs the open event
4. Returns a 1x1 transparent PNG image

