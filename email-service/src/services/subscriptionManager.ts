import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import "isomorphic-fetch";

let currentSubscriptionId: string | null = null;

function getGraphClient(): Client {
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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const { SENDER_EMAIL, WEBHOOK_URL } = process.env;

            if (!SENDER_EMAIL || !WEBHOOK_URL) {
                console.error("❌ SENDER_EMAIL or WEBHOOK_URL not configured");
                return null;
            }

            console.log(`🔔 Attempting to create subscription (Attempt ${attempt}/${maxRetries})...`);
            const client = getGraphClient();

            const subscription = {
                changeType: "created",
                notificationUrl: WEBHOOK_URL,
                resource: `/users/${SENDER_EMAIL}/mailFolders('Inbox')/messages`,
                expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                clientState: "AgentMiraReplyTracking",
            };

            const result = await client.api("/subscriptions").post(subscription);
            console.log(`✅ Subscription created: ${result.id} (expires: ${result.expirationDateTime})`);
            return result.id;
        } catch (error: any) {
            lastError = error;
            console.warn(`⚠️ Subscription attempt ${attempt} failed: ${error.message}`);

            if (attempt < maxRetries) {
                console.log(`⏱ Wait ${retryDelayMs / 1000}s before retrying...`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                // Increase delay for next attempt (exponential-ish backoff)
                retryDelayMs *= 2;
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
