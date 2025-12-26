import "dotenv/config";
import express, { Request, Response } from "express";
import { emailService } from "./services/emailService";
import { handleEmailReply } from "./services/replyTrackingHandler";
import { handleEmailDelivery } from "./services/deliveryTrackingHandler";
import { initializeSubscription } from "./services/subscriptionManager";

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

app.use(express.json());

// Send email endpoint
app.post("/send-email", async (req: Request, res: Response) => {
    console.log(`📨 Received send-email request for: ${req.body.email}`);
    try {
        const { email, user_id } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: "Email is required" });
        }

        await emailService.sendTestEmail(email, user_id);
        res.json({ success: true, message: `Test email sent to ${email}` });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Microsoft Graph webhook endpoint
app.post("/graph/webhook", async (req: Request, res: Response) => {
    console.log(`🔔 Webhook received:`, req.query, req.body?.value?.length || 0, 'notifications');

    // Handle validation token handshake
    const validationToken = req.query.validationToken as string;
    if (validationToken) {
        return res.status(200).send(validationToken);
    }

    // Process notification
    try {
        const notifications = req.body.value;

        if (!notifications || !Array.isArray(notifications)) {
            return res.status(400).send("Invalid notification format");
        }

        for (const notification of notifications) {
            if (notification.changeType === "created") {
                processInboxMessage(notification).catch(() => { });
            }
        }

        res.status(202).send();
    } catch (error) {
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
            await handleEmailReply(messageId, fromEmail, receivedAt);
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

app.listen(PORT, async () => {
    console.log(`📧 Email service running on ${BASE_URL}`);
    console.log(`   POST /send-email - Send test emails`);
    console.log(`   POST /graph/webhook - Reply tracking webhook`);
    console.log(`   POST /test-reply - Manual reply test`);

    // Initialize subscription on startup
    await initializeSubscription();
});
