import "dotenv/config";
import express, { Request, Response } from "express";
import { emailService } from "./services/emailService";
import { handleEmailReply } from "./services/replyTrackingHandler";
import { handleEmailDelivery } from "./services/deliveryTrackingHandler";
import { handleEmailForwarding } from "./services/forwardingTrackingHandler";
import { handleEmailOpen } from "./services/openTrackingHandler";
import { initializeSubscription, getGraphClient } from "./services/subscriptionManager";
import { emailInsightService } from "./services/emailInsightService";
import { dbService } from "./services/dbService";
import { cleanReplyContent } from "./utils/emailUtils";

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Normalize trailing slashes - redirect /path/ to /path (except for root)
app.use((req: Request, res: Response, next: any) => {
    if (req.path.length > 1 && req.path.endsWith('/')) {
        return res.redirect(301, req.path.slice(0, -1) + (req.url.slice(req.path.length) || ''));
    }
    next();
});

// Raw body parser for webhook endpoint (must be BEFORE json parser)
// This handles both text/plain (validation) and application/json (notifications)
app.use('/graph/webhook', express.raw({ 
    type: (req) => {
        const contentType = req.headers['content-type'] || '';
        return contentType.includes('text/plain') || contentType.includes('application/json');
    },
    limit: '10mb'
}));

// JSON body parser for all other routes
app.use(express.json({
    strict: true
}));

// Error handler for JSON parsing errors
app.use((err: any, req: Request, res: Response, next: any) => {
    if (err instanceof SyntaxError && 'body' in err) {
        console.error('❌ JSON parsing error:', err.message);
        console.error('   Path:', req.path);
        console.error('   Method:', req.method);
        console.error('   Content-Type:', req.headers['content-type']);
        
        // For webhook endpoint, try to handle gracefully
        if (req.path === '/graph/webhook') {
            // Return 400 but allow the webhook handler to potentially recover
            console.error('   This might be a validation token sent as plain text');
        }
        return res.status(400).json({ error: 'Invalid JSON format' });
    }
    next(err);
});

// Send email endpoint
app.post("/send-email", async (req: Request, res: Response) => {
    console.log(`📨 Received send-email request for: ${req.body.email}`);
    try {
        const { email, user_id, subject, body, name } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: "Email is required" });
        }

        // Debug logging for body content
        console.log(`📧 Email send request details:`);
        console.log(`   - email: ${email}`);
        console.log(`   - user_id: ${user_id || 'not provided'}`);
        console.log(`   - subject: ${subject || 'not provided'}`);
        console.log(`   - body: ${body ? `${body.length} chars, type: ${typeof body}, preview: ${body.substring(0, 100)}...` : 'not provided (will use default template)'}`);
        console.log(`   - name: ${name || 'not provided'}`);

        await emailService.sendEmail(email, user_id, subject, body, name);
        res.json({ success: true, message: `Email sent to ${email}` });
    } catch (error) {
        console.error(`❌ Error in /send-email endpoint:`, error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Open tracking pixel endpoint
app.get("/open/:messageId.png", async (req: Request, res: Response) => {
    const { messageId } = req.params;
    const userAgent = req.headers["user-agent"] || "unknown";

    console.log(`👁️ Tracking pixel requested: ${messageId}`);

    // Track the open asynchronously
    handleEmailOpen(messageId, userAgent).catch(err => console.error("Open track error:", err));

    // Return a 1x1 transparent PNG
    const pixel = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        "base64"
    );

    res.set({
        "Content-Type": "image/png",
        "Content-Length": pixel.length,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    });

    res.send(pixel);
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok", time: new Date().toISOString() });
});

// Microsoft Graph webhook endpoint (Handles both validation and notifications)
// Raw body parser is already applied globally for this path above
app.all("/graph/webhook", async (req: Request, res: Response) => {
    const { validationToken } = req.query;

    // 1. Handle validation handshake (Microsoft Graph sends as GET with query param or POST with plain text body)
    if (validationToken) {
        console.log(`✅ Webhook validation request received. Token: ${String(validationToken).substring(0, 10)}...`);
        return res
            .status(200)
            .set("Content-Type", "text/plain")
            .send(validationToken);
    }

    // Check if body is plain text (validation token in body)
    if (req.headers['content-type']?.includes('text/plain')) {
        const bodyText = req.body?.toString() || '';
        if (bodyText && bodyText.length < 100) {
            // Likely a validation token
            console.log(`✅ Webhook validation request received (plain text body). Token: ${bodyText.substring(0, 10)}...`);
            return res
                .status(200)
                .set("Content-Type", "text/plain")
                .send(bodyText);
        }
    }

    // 2. Handle actual notifications (POST only, JSON format)
    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed for notifications");
    }

    // Parse JSON body if content-type is JSON
    let notifications: any[];
    try {
        const bodyText = req.body?.toString() || '{}';
        const bodyJson = JSON.parse(bodyText);
        notifications = bodyJson.value || [];
    } catch (parseError: any) {
        console.error(`❌ Failed to parse webhook notification JSON:`, parseError.message);
        console.error(`   Content-Type: ${req.headers['content-type']}`);
        console.error(`   Body length: ${req.body?.length || 0} bytes`);
        console.error(`   Body preview: ${(req.body?.toString() || '').substring(0, 200)}`);
        return res.status(400).send("Invalid JSON format");
    }

    console.log(`🔔 Webhook notification received: ${notifications?.length || 0} items`);

    try {
        if (!Array.isArray(notifications)) {
            console.error(`⚠️ Webhook body.value is not an array:`, typeof notifications);
            return res.status(400).send("Invalid format: expected array");
        }

        for (const notification of notifications) {
            if (notification?.changeType === "created") {
                processInboxMessage(notification).catch(err => console.error("Error processing notification:", err));
            }
        }

        res.status(202).send();
    } catch (error: any) {
        console.error("Webhook processing error:", error?.message || error);
        res.status(500).send("Internal error");
    }
});

// Process inbox message (reply, delivery receipt, or bounce)
async function processInboxMessage(notification: any): Promise<void> {
    try {
        const resourceData = notification.resourceData;
        if (!resourceData || !resourceData.id) {
            console.warn(`⚠️ Webhook notification missing resourceData or message ID`);
            return;
        }

        // Webhook notifications only provide minimal data (just message ID)
        // We need to fetch the full message from Graph API to get all details
        const graphMessageId = resourceData.id;
        const senderEmail = process.env.SENDER_EMAIL;
        
        if (!senderEmail) {
            console.error(`❌ SENDER_EMAIL not configured, cannot fetch message details`);
            return;
        }

        console.log(`📥 Fetching full message details for Graph message ID: ${graphMessageId}`);

        // Fetch full message details from Graph API
        let messageData: any;
        try {
            const client = getGraphClient();
            messageData = await client
                .api(`/users/${senderEmail}/messages/${graphMessageId}`)
                .select('id,subject,from,toRecipients,ccRecipients,receivedDateTime,conversationId,internetMessageHeaders,bodyPreview,body')
                .get();
        } catch (fetchError: any) {
            console.error(`❌ Failed to fetch message details from Graph API:`, fetchError?.message || fetchError);
            return;
        }

        if (!messageData) {
            console.warn(`⚠️ Message not found in Graph API: ${graphMessageId}`);
            return;
        }

        // Extract message details
        const subject = messageData.subject || "";
        const fromEmail = messageData.from?.emailAddress?.address;
        const receivedAt = messageData.receivedDateTime || new Date().toISOString();
        const conversationId = messageData.conversationId;
        const internetMessageHeaders = messageData.internetMessageHeaders || [];
        const replyMessageId = messageData.id;
        // Get full reply content for cleaning (use bodyPreview or full body content)
        const rawReplyContent = messageData.bodyPreview || messageData.body?.content?.substring(0, 2000) || '';
        
        // Clean reply content to remove quoted text, signatures, etc.
        // This stores only the actual reply content in tracking summary
        const cleanedReply = cleanReplyContent(rawReplyContent);
        const replySnippet = cleanedReply || rawReplyContent.substring(0, 500); // Fallback to original if cleaning removes everything

        console.log(`📧 Processing message: Subject: "${subject}", From: ${fromEmail}, ConversationId: ${conversationId || 'N/A'}`);

        // Check if this is a delivery receipt
        if (subject.toLowerCase().includes("delivered:") || subject.toLowerCase().includes("delivery receipt")) {
            const originalMessageId = internetMessageHeaders.find(
                (h: any) => h.name === "X-AgentMira-Message-Id"
            )?.value;

            if (originalMessageId) {
                await handleEmailDelivery(originalMessageId, 'DELIVERED', receivedAt);
                return;
            }
        }

        // Check if this is a bounce/NDR
        if (subject.toLowerCase().includes("undeliverable:") ||
            subject.toLowerCase().includes("delivery status notification") ||
            subject.toLowerCase().includes("failure notice")) {

            const originalMessageId = internetMessageHeaders.find(
                (h: any) => h.name === "X-AgentMira-Message-Id"
            )?.value;

            const bounceReason = subject.replace(/^(Undeliverable:|Delivery Status Notification:|Failure Notice:)/i, '').trim();

            if (originalMessageId) {
                await handleEmailDelivery(originalMessageId, 'BOUNCED', receivedAt, bounceReason);
                return;
            }
        }

        // Check for forwarding before treating as reply
        // Forwarding detection uses our custom header to identify original message
        const forwardingCheckMessageId = internetMessageHeaders.find(
            (h: any) => h.name === "X-AgentMira-Message-Id"
        )?.value;
        
        if (forwardingCheckMessageId) {
            // Check if this might be a forwarded email
            // Forwarding handler will determine if it's actually forwarded vs replied
            await handleEmailForwarding(forwardingCheckMessageId, messageData);
        }

        // Otherwise, treat as a reply
        // Match the original email using multiple methods:
        let originalMessageId: string | undefined;

        // Method 1: Try matching by In-Reply-To header (most reliable for replies)
        const inReplyTo = internetMessageHeaders.find(
            (h: any) => h.name === "In-Reply-To"
        )?.value;

        if (inReplyTo) {
            // In-Reply-To contains the internetMessageId in angle brackets: <message-id>
            const internetMessageId = inReplyTo.replace(/[<>]/g, '').trim();
            console.log(`🔍 Method 1: Matching reply by In-Reply-To header: ${internetMessageId}`);
            const trackingDoc = await dbService.findTrackingDataByInternetMessageId(internetMessageId);
            if (trackingDoc) {
                originalMessageId = trackingDoc.id;
                console.log(`✅ Matched reply to original email (In-Reply-To): ${originalMessageId}`);
            }
        }

        // Method 2: Try matching by conversationId (groups all emails in same thread)
        // The reply's "from" email should match the original email's "recipient" email
        if (!originalMessageId && conversationId && fromEmail) {
            console.log(`🔍 Method 2: Matching reply by conversationId: ${conversationId}, expecting reply from: ${fromEmail}`);
            // Query by conversationId and recipient email to find the original sent email
            const trackingDoc = await dbService.findTrackingDataByConversationId(conversationId, fromEmail);
            if (trackingDoc) {
                originalMessageId = trackingDoc.id;
                console.log(`✅ Matched reply to original email (conversationId + recipient): ${originalMessageId}`);
                console.log(`   Original recipient: ${trackingDoc.recipient.email}, Reply from: ${fromEmail}`);
            } else {
                // If exact match fails, try without recipient filter (fallback)
                console.log(`🔍 Method 2b: Trying conversationId match without recipient filter...`);
                const trackingDocFallback = await dbService.findTrackingDataByConversationId(conversationId);
                if (trackingDocFallback) {
                    originalMessageId = trackingDocFallback.id;
                    console.log(`✅ Matched reply to original email (conversationId only): ${originalMessageId}`);
                    console.warn(`⚠️ Email mismatch: sent to ${trackingDocFallback.recipient.email}, reply from ${fromEmail}`);
                }
            }
        }

        // Method 3: Try custom header (unlikely in replies, but check anyway)
        if (!originalMessageId) {
            const customHeaderMessageId = internetMessageHeaders.find(
                (h: any) => h.name === "X-AgentMira-Message-Id"
            )?.value;
            
            if (customHeaderMessageId) {
                originalMessageId = customHeaderMessageId;
                console.log(`✅ Matched reply by custom header: ${originalMessageId}`);
            }
        }

        if (originalMessageId) {
            // Detect auto-reply by checking headers or subject
            const headers = internetMessageHeaders || [];
            const hasAutoReplyHeader = headers.some((h: any) => 
                h.name === 'X-Auto-Response-Suppress' || 
                h.name === 'Auto-Submitted' ||
                (h.name === 'Precedence' && h.value === 'auto_reply')
            );
            const hasAutoReplySubject = subject.toLowerCase().includes('automatic reply') ||
                                       subject.toLowerCase().includes('out of office') ||
                                       subject.toLowerCase().includes('auto-reply');
            const isAutoReply = hasAutoReplyHeader || hasAutoReplySubject;

            console.log(`💬 Processing reply: Original=${originalMessageId}, From=${fromEmail}, AutoReply=${isAutoReply}`);

            await handleEmailReply(
                originalMessageId, 
                fromEmail || 'unknown', 
                receivedAt,
                replyMessageId,
                replySnippet,
                isAutoReply
            );
        } else {
            console.warn(`⚠️ Could not match reply to original email.`);
            console.warn(`   Subject: "${subject}"`);
            console.warn(`   From: ${fromEmail}`);
            console.warn(`   ConversationId: ${conversationId || 'N/A'}`);
            console.warn(`   In-Reply-To: ${inReplyTo || 'N/A'}`);
            console.warn(`   Available headers:`, internetMessageHeaders.map((h: any) => `${h.name}: ${h.value}`).join(', '));
            console.warn(`   This might be a reply to an email we didn't send, or the original email is missing Graph API data.`);
        }
    } catch (error) {
        console.error("❌ Error processing inbox message:", error);
        // Don't fail silently - log the error for debugging
    }
}

// Test endpoint for manual reply tracking
app.post("/test-reply", async (req: Request, res: Response) => {
    try {
        const { messageId, fromEmail } = req.body;

        if (!messageId || !fromEmail) {
            return res.status(400).json({
                success: false,
                error: "messageId and fromEmail are required"
            });
        }

        await handleEmailReply(messageId, fromEmail, new Date().toISOString());
        res.json({ success: true, message: `Reply tracked for ${messageId}` });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Generate tracking summary endpoint (handles both with and without trailing slash)
app.post(["/generate-insights", "/generate-insights/"], async (req: Request, res: Response) => {
    try {
        // Support both user_id (new) and buyer_id (old) for backward compatibility
        const userId = req.body.user_id || req.body.buyer_id;

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: "user_id (or buyer_id) is required"
            });
        }

        console.log(`📊 Generating insights for user_id: ${userId}`);
        const summary = await emailInsightService.generateTrackingSummary(userId);

        res.json({
            success: true,
            data: summary,
            message: `Insights generated successfully for user_id: ${userId}`
        });
    } catch (error) {
        console.error("Error generating insights:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

app.listen(PORT, async () => {
    console.log(`📧 Email service running on ${BASE_URL}`);
    console.log(`   POST /send-email - Send test emails`);
    console.log(`   POST /graph/webhook - Reply tracking webhook`);
    console.log(`   POST /test-reply - Manual reply test`);
    console.log(`   POST /generate-insights - Generate tracking insights for user_id`);

    // Initialize subscription on startup
    await initializeSubscription();
});
