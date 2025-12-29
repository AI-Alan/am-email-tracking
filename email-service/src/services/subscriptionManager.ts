import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import "isomorphic-fetch";

let currentSubscriptionId: string | null = null;

export function getGraphClient(): Client {
    const { CLIENT_ID, TENANT_ID, CLIENT_SECRET } = process.env;

    if (!CLIENT_ID || !TENANT_ID || !CLIENT_SECRET) {
        throw new Error("Missing Microsoft Graph credentials");
    }

    const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);

    return Client.initWithMiddleware({
        authProvider: {
            getAccessToken: async () => {
                const token = await credential.getToken("https://graph.microsoft.com/.default");
                return token?.token || "";
            },
        },
    });
}

async function createSubscription(maxRetries = 3, retryDelayMs = 15000): Promise<string | null> {
    let lastError: any = null;

    const { SENDER_EMAIL, WEBHOOK_URL, RENDER_EXTERNAL_URL } = process.env;

    // Determine the best webhook URL
    let finalWebhookUrl = "";

    // 1. Check WEBHOOK_URL but ignore if it's a placeholder
    const isPlaceholder = (url?: string) => !url || url.includes("your-ngrok-url") || url.includes("example.com");

    if (!isPlaceholder(WEBHOOK_URL)) {
        finalWebhookUrl = WEBHOOK_URL!;
    }
    // 2. Try RENDER_EXTERNAL_URL
    else if (RENDER_EXTERNAL_URL) {
        finalWebhookUrl = `${RENDER_EXTERNAL_URL}${RENDER_EXTERNAL_URL.endsWith('/') ? '' : '/'}graph/webhook`;
        console.log(`ℹ️ Using RENDER_EXTERNAL_URL: ${finalWebhookUrl}`);
    }
    // 3. Last resort - use the known Render URL for this project
    else {
        finalWebhookUrl = "https://am-email-tracking.onrender.com/graph/webhook";
        console.log(`⚠️ Using hardcoded fallback URL: ${finalWebhookUrl}`);
    }

    if (!SENDER_EMAIL) {
        console.error("❌ SENDER_EMAIL not configured");
        return null;
    }

    console.log(`📋 Subscription Config:`);
    console.log(`   - Sender: ${SENDER_EMAIL}`);
    console.log(`   - Webhook: ${finalWebhookUrl}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔔 Attempting to create subscription (Attempt ${attempt}/${maxRetries})...`);
            const client = getGraphClient();

            const subscriptionData = {
                changeType: "created",
                notificationUrl: finalWebhookUrl,
                resource: `/users/${SENDER_EMAIL}/mailFolders('Inbox')/messages`,
                expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                clientState: "AgentMiraReplyTracking",
            };

            const result = await client.api("/subscriptions").post(subscriptionData);
            console.log(`✅ Subscription created: ${result.id} (expires: ${result.expirationDateTime})`);
            return result.id;
        } catch (error: any) {
            lastError = error;
            console.warn(`⚠️ Subscription attempt ${attempt} failed: ${error.message}`);

            // Helpful tip if we get a 404 or 403
            if (error.message?.includes("NotFound")) {
                console.warn(`💡 Tip: NotFound (404) means Microsoft Graph reached a server but couldn't find the /graph/webhook path.`);
                console.warn(`   Ensure the Webhook URL above is exactly where your server is reachable.`);
            } else if (error.message?.includes("Forbidden") || error.statusCode === 403) {
                console.warn(`💡 Tip: Forbidden (403) means your Azure App lacks permissions to read mail or create subscriptions.`);
                console.warn(`   Ensure your App Registration in Azure has 'Mail.Read' (Application permission) granted.`);
                console.warn(`   CRITICAL: Admin Consent must be granted in the Azure Portal for these permissions to take effect.`);
            }

            if (attempt < maxRetries) {
                console.log(`⏱ Wait ${retryDelayMs / 1000}s before retrying...`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                retryDelayMs *= 2; // Backoff
            }
        }
    }

    console.error(`❌ All ${maxRetries} subscription attempts failed:`, lastError?.message);
    return null;
}

async function renewSubscription(subscriptionId: string): Promise<boolean> {
    try {
        const client = getGraphClient();
        const newExpiration = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

        await client.api(`/subscriptions/${subscriptionId}`).patch({
            expirationDateTime: newExpiration
        });

        console.log(`✅ Subscription renewed: ${subscriptionId} (expires: ${newExpiration})`);
        return true;
    } catch (error: any) {
        console.error(`❌ Subscription renewal failed:`, error.message);
        return false;
    }
}

async function getActiveSubscription(): Promise<string | null> {
    try {
        const client = getGraphClient();
        const result = await client.api("/subscriptions").get();

        const subscriptions = result.value || [];
        const inboxSub = subscriptions.find((sub: any) =>
            sub.resource.includes("mailFolders('Inbox')/messages")
        );

        return inboxSub?.id || null;
    } catch (error: any) {
        console.error(`❌ Failed to check subscriptions:`, error.message);
        return null;
    }
}

export async function initializeSubscription(startupDelayMs = 20000): Promise<void> {
    console.log(`⏳ Waiting ${startupDelayMs / 1000}s for service to be externally live...`);

    // Use a timeout to avoid blocking the main server startup thread
    setTimeout(async () => {
        console.log("🔔 Starting webhook subscription initialization...");

        // Check if subscription already exists
        currentSubscriptionId = await getActiveSubscription();

        if (currentSubscriptionId) {
            console.log(`✅ Found existing subscription: ${currentSubscriptionId}`);
        } else {
            // Create new subscription with retry logic
            currentSubscriptionId = await createSubscription();
        }

        if (!currentSubscriptionId) {
            console.error("⚠️ Failed to initialize subscription after retries. Reply tracking may not work.");
            return;
        }

        // Auto-renew every 2 days
        setInterval(async () => {
            console.log("🔄 Auto-renewing subscription...");
            if (currentSubscriptionId) {
                const success = await renewSubscription(currentSubscriptionId);
                if (!success) {
                    // If renewal fails, try creating new subscription
                    console.log("🔄 Renewal failed, creating new subscription...");
                    currentSubscriptionId = await createSubscription();
                }
            }
        }, 2 * 24 * 60 * 60 * 1000); // 2 days in milliseconds

        console.log("✅ Subscription auto-renewal scheduled (every 2 days)");
    }, startupDelayMs);
}
