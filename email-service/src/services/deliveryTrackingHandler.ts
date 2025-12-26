import { CosmosClient } from "@azure/cosmos";

// Handler for delivery and bounce tracking
export async function handleEmailDelivery(
    messageId: string,
    status: 'DELIVERED' | 'BOUNCED',
    timestamp: string,
    bounceReason?: string
): Promise<void> {
    try {
        const { COSMOS_URI, COSMOS_KEY, COSMOS_DATABASE_REALTOR_MANAGEMENT, COSMOS_CONTAINER_EMAIL } = process.env;

        if (!COSMOS_URI || !COSMOS_KEY || !COSMOS_DATABASE_REALTOR_MANAGEMENT || !COSMOS_CONTAINER_EMAIL) {
            console.error("Missing Cosmos DB environment variables");
            return;
        }

        const cosmosClient = new CosmosClient({ endpoint: COSMOS_URI, key: COSMOS_KEY });
        const container = cosmosClient
            .database(COSMOS_DATABASE_REALTOR_MANAGEMENT)
            .container(COSMOS_CONTAINER_EMAIL);

        // Query to find the email log
        const query = `SELECT * FROM c WHERE c.id = @messageId`;
        const { resources } = await container.items
            .query({
                query,
                parameters: [{ name: "@messageId", value: messageId }]
            })
            .fetchAll();

        if (!resources || resources.length === 0) {
            console.error(`Email log not found for delivery update: ${messageId}`);
            return;
        }

        const resource = resources[0];

        // Format readable timestamp
        const readable = new Date(timestamp).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'Asia/Kolkata',
            timeZoneName: 'short'
        });

        const updates: any[] = [];

        // Update status
        updates.push({ op: "set", path: "/status", value: status });

        if (status === 'DELIVERED') {
            updates.push({ op: "set", path: "/deliveredAt", value: timestamp });
            updates.push({ op: "set", path: "/deliveredAt_readable", value: readable });
            console.log(`✅ Email delivered: ${messageId}`);
        } else if (status === 'BOUNCED') {
            updates.push({ op: "set", path: "/bouncedAt", value: timestamp });
            updates.push({ op: "set", path: "/bouncedAt_readable", value: readable });
            if (bounceReason) {
                updates.push({ op: "set", path: "/bounceReason", value: bounceReason });
            }
            console.log(`❌ Email bounced: ${messageId} - ${bounceReason || 'Unknown reason'}`);
        }

        await container.item(messageId, resource.user_id).patch(updates);
    } catch (error) {
        console.error("Delivery tracking failed:", error);
    }
}
