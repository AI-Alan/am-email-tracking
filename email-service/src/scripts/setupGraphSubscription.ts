import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import "isomorphic-fetch";

/**
 * ONE-TIME SETUP SCRIPT
 * 
 * Run this script once to create a Microsoft Graph subscription for reply tracking.
 * The subscription will notify your webhook when new emails arrive in the Inbox.
 * 
 * Usage:
 *   ts-node scripts/setupGraphSubscription.ts
 * 
 * IMPORTANT:
 * - Your webhook server must be publicly accessible (use ngrok for local testing)
 * - Subscriptions expire after max 4230 minutes (3 days) and need renewal
 * - Store the subscription ID to renew it before expiration
 */

async function createGraphSubscription() {
    const {
        CLIENT_ID,
        TENANT_ID,
        CLIENT_SECRET,
        SENDER_EMAIL,
        WEBHOOK_URL, // e.g., https://your-domain.com/graph/webhook or https://abc123.ngrok.io/graph/webhook
    } = process.env;

    if (!CLIENT_ID || !TENANT_ID || !CLIENT_SECRET || !SENDER_EMAIL || !WEBHOOK_URL) {
        throw new Error("Missing required environment variables");
    }

    // Initialize Graph client
    const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
    const client = Client.initWithMiddleware({
        authProvider: {
            getAccessToken: async () => {
                const token = await credential.getToken("https://graph.microsoft.com/.default");
                return token?.token || "";
            },
        },
    });

    // Create subscription
    const subscription = {
        changeType: "created",
        notificationUrl: WEBHOOK_URL,
        resource: `/users/${SENDER_EMAIL}/mailFolders('Inbox')/messages`,
        expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days
        clientState: "AgentMiraReplyTracking", // Secret value to validate notifications
    };

    try {
        const result = await client.api("/subscriptions").post(subscription);

        console.log("✅ Graph subscription created successfully!");
        console.log("\nSubscription Details:");
        console.log(`  ID: ${result.id}`);
        console.log(`  Resource: ${result.resource}`);
        console.log(`  Expires: ${result.expirationDateTime}`);
        console.log(`\n⚠️  IMPORTANT: Save this subscription ID to renew before expiration!`);
        console.log(`\nTo renew, use:`);
        console.log(`  PATCH /subscriptions/${result.id}`);
        console.log(`  Body: { "expirationDateTime": "<new-date>" }`);

        return result;
    } catch (error: any) {
        console.error("❌ Failed to create subscription:", error.message);
        if (error.body) {
            console.error("Error details:", JSON.stringify(error.body, null, 2));
        }
        throw error;
    }
}

// Run the setup
createGraphSubscription()
    .then(() => {
        console.log("\n✨ Setup complete!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n💥 Setup failed:", error);
        process.exit(1);
    });
