import { CosmosClient } from "@azure/cosmos";

// Pure logic handler - no Express dependencies
export async function handleEmailOpen(messageId: string): Promise<void> {
    console.log(`🔍 Attempting to track email open for: ${messageId}`);

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

        // Read current email log using messageId as id and user_id as partition key
        // Note: We need to query since we don't know the user_id (partition key) upfront
        const query = `SELECT * FROM c WHERE c.id = @messageId`;
        const { resources } = await container.items
            .query({
                query,
                parameters: [{ name: "@messageId", value: messageId }]
            })
            .fetchAll();

        if (!resources || resources.length === 0) {
            console.error(`Email log not found: ${messageId}`);
            return; // Fail silently
        }

        const resource = resources[0];

        const updates: any[] = [];
        const newOpenCount = (resource.openCount ?? 0) + 1;

        // Always increment openCount
        updates.push({ op: "set", path: "/openCount", value: newOpenCount });

        // Set openedAt only on first open
        if (!resource.openedAt) {
            const now = new Date().toISOString();
            const readable = new Date(now).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: 'Asia/Kolkata',
                timeZoneName: 'short'
            });
            updates.push({ op: "set", path: "/openedAt", value: now });
            updates.push({ op: "set", path: "/openedAt_readable", value: readable });
        }

        await container.item(messageId, resource.user_id).patch(updates);
        console.log(`📧 Email opened: ${messageId} (count: ${newOpenCount})`);
    } catch (error) {
        // Fail silently - never break the tracking pixel
        console.error("Open tracking failed:", error);
    }
}
