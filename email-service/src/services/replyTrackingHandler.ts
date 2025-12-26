import { CosmosClient } from "@azure/cosmos";

// Pure logic handler for reply tracking - no Express dependencies
export async function handleEmailReply(
    messageId: string,
    fromEmail: string,
    receivedAt: string
): Promise<void> {
    try {
        const { COSMOS_URI, COSMOS_KEY, COSMOS_DATABASE_REALTOR_MANAGEMENT, COSMOS_CONTAINER_EMAIL } = process.env;

        if (!COSMOS_URI || !COSMOS_KEY || !COSMOS_DATABASE_REALTOR_MANAGEMENT || !COSMOS_CONTAINER_EMAIL) {
            console.error("Missing Cosmos DB environment variables");
            return; // Fail silently
        }

        const cosmosClient = new CosmosClient({ endpoint: COSMOS_URI, key: COSMOS_KEY });
        const container = cosmosClient
            .database(COSMOS_DATABASE_REALTOR_MANAGEMENT)
            .container(COSMOS_CONTAINER_EMAIL);

        // Read current email log using query since we don't know partition key upfront
        const query = `SELECT * FROM c WHERE c.id = @messageId`;
        const { resources } = await container.items
            .query({
                query,
                parameters: [{ name: "@messageId", value: messageId }]
            })
            .fetchAll();

        if (!resources || resources.length === 0) {
            console.error(`Email log not found for reply: ${messageId}`);
            return; // Fail silently
        }

        const resource = resources[0];

        const updates: any[] = [];
        const newReplyCount = (resource.replyCount ?? 0) + 1;

        // Always increment replyCount
        updates.push({ op: "set", path: "/replyCount", value: newReplyCount });

        // Always update lastReplyFrom
        updates.push({ op: "set", path: "/lastReplyFrom", value: fromEmail });

        // Set repliedAt only on first reply
        if (!resource.repliedAt) {
            const readable = new Date(receivedAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: 'Asia/Kolkata',
                timeZoneName: 'short'
            });
            updates.push({ op: "set", path: "/repliedAt", value: receivedAt });
            updates.push({ op: "set", path: "/repliedAt_readable", value: readable });
        }

        await container.item(messageId, resource.user_id).patch(updates);
        console.log(`💬 Reply tracked: ${messageId} from ${fromEmail} (count: ${newReplyCount})`);
    } catch (error) {
        // Fail silently - never break reply tracking
        console.error("Reply tracking failed:", error);
    }
}
