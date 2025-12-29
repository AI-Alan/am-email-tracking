import "dotenv/config";
import express, { Request, Response } from "express";
import { emailService } from "./services/emailService";
import { handleEmailReply } from "./services/replyTrackingHandler";
import { handleEmailDelivery } from "./services/deliveryTrackingHandler";
import { handleEmailOpen } from "./services/openTrackingHandler";
import { initializeSubscription } from "./services/subscriptionManager";
import { emailInsightService } from "./services/emailInsightService";

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

app.use(express.json());

// Send email endpoint
app.post("/send-email", async (req: Request, res: Response) => {
    console.log(`📨 Received send-email request for: ${req.body.email}`);
    try {
        const { email, user_id, subject, body, name } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: "Email is required" });
        }

        await emailService.sendEmail(email, user_id, subject, body, name);
        res.json({ success: true, message: `Email sent to ${email}` });
    } catch (error) {
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
app.all("/graph/webhook", async (req: Request, res: Response) => {
    const { validationToken } = req.query;

    // 1. Handle validation handshake (Microsoft Graph)
    if (validationToken) {
        console.log(`✅ Webhook validation request received. Token: ${String(validationToken).substring(0, 10)}...`);
        return res
            .status(200)
            .set("Content-Type", "text/plain")
            .send(validationToken);
    }

    // 2. Handle actual notifications (POST only)
    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed for notifications");
    }

    console.log(`🔔 Webhook notification received: ${req.body?.value?.length || 0} items`);

    try {
        const notifications = req.body.value;
        if (!notifications || !Array.isArray(notifications)) {
            return res.status(400).send("Invalid format");
        }

        for (const notification of notifications) {
            if (notification.changeType === "created") {
                processInboxMessage(notification).catch(err => console.error("Error processing notification:", err));
            }
        }

        res.status(202).send();
    } catch (error) {
        console.error("Webhook processing error:", error);
        res.status(500).send("Internal error");
    }
});

// Process inbox message (reply, delivery receipt, or bounce)
async function processInboxMessage(notification: any): Promise<void> {
    try {
        const resourceData = notification.resourceData;
        if (!resourceData) return;

        const subject = resourceData.subject || "";
        const fromEmail = resourceData.from?.emailAddress?.address;
        const receivedAt = resourceData.receivedDateTime || new Date().toISOString();
        const internetMessageHeaders = resourceData.internetMessageHeaders || [];

        // Check if this is a delivery receipt
        if (subject.toLowerCase().includes("delivered:") || subject.toLowerCase().includes("delivery receipt")) {
            const messageId = internetMessageHeaders.find(
                (h: any) => h.name === "X-AgentMira-Message-Id"
            )?.value;

            if (messageId) {
                await handleEmailDelivery(messageId, 'DELIVERED', receivedAt);
                return;
            }
        }

        // Check if this is a bounce/NDR
        if (subject.toLowerCase().includes("undeliverable:") ||
            subject.toLowerCase().includes("delivery status notification") ||
            subject.toLowerCase().includes("failure notice")) {

            const messageId = internetMessageHeaders.find(
                (h: any) => h.name === "X-AgentMira-Message-Id"
            )?.value;

            const bounceReason = subject.replace(/^(Undeliverable:|Delivery Status Notification:|Failure Notice:)/i, '').trim();

            if (messageId) {
                await handleEmailDelivery(messageId, 'BOUNCED', receivedAt, bounceReason);
                return;
            }
        }

        // Otherwise, treat as a reply
        if (!fromEmail) return;

        const messageId = internetMessageHeaders.find(
            (h: any) => h.name === "X-AgentMira-Message-Id"
        )?.value;

        if (messageId) {
            // Extract additional reply details from webhook data
            const replyMessageId = resourceData.id;
            const replySnippet = resourceData.bodyPreview || resourceData.body?.content?.substring(0, 500) || '';
            
            // Detect auto-reply by checking headers or subject
            const headers = resourceData.internetMessageHeaders || [];
            const hasAutoReplyHeader = headers.some((h: any) => 
                h.name === 'X-Auto-Response-Suppress' || 
                h.name === 'Auto-Submitted' ||
                h.name === 'Precedence' && h.value === 'auto_reply'
            );
            const hasAutoReplySubject = subject.toLowerCase().includes('automatic reply') ||
                                       subject.toLowerCase().includes('out of office') ||
                                       subject.toLowerCase().includes('auto-reply');
            const isAutoReply = hasAutoReplyHeader || hasAutoReplySubject;

            await handleEmailReply(
                messageId, 
                fromEmail, 
                receivedAt,
                replyMessageId,
                replySnippet,
                isAutoReply
            );
        }
    } catch (error) {
        // Fail silently
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

// Generate tracking summary endpoint
app.post("/generate-insights", async (req: Request, res: Response) => {
    try {
        const { buyer_id } = req.body;

        if (!buyer_id) {
            return res.status(400).json({
                success: false,
                error: "buyer_id is required"
            });
        }

        console.log(`📊 Generating insights for buyer_id: ${buyer_id}`);
        const summary = await emailInsightService.generateTrackingSummary(buyer_id);

        res.json({
            success: true,
            data: summary,
            message: `Insights generated successfully for buyer_id: ${buyer_id}`
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
    console.log(`   POST /generate-insights - Generate tracking insights for buyer_id`);

    // Initialize subscription on startup
    await initializeSubscription();
});
