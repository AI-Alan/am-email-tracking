import { CosmosClient, PatchOperation } from "@azure/cosmos";
import { EmailTracking, LifecycleStatus } from "../types/emailTracking";

// Pure logic handler - no Express dependencies
export async function handleEmailOpen(messageId: string, userAgent?: string): Promise<void> {
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

        // Read current email log using messageId as id
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

        const resource: EmailTracking = resources[0];

        // Get partition key value - use user_id
        const partitionKeyValue = resource.user_id;
        
        if (!partitionKeyValue) {
            console.error(`⚠️ No partition key (user_id) found for messageId: ${messageId}`);
            return;
        }

        const now = new Date().toISOString();
        const updates: any[] = [];

        // Update lifecycle status to OPENED if it was just SENT
        if (resource.lifecycleStatus === LifecycleStatus.SENT) {
            updates.push({ op: "set" as const, path: "/lifecycleStatus", value: LifecycleStatus.OPENED });
        }

        // Use new structure: openTracking.openCount, openTracking.firstOpenedAt, openTracking.lastOpenedAt
        const currentOpenCount = resource.openTracking?.openCount || 0;
        const newOpenCount = currentOpenCount + 1;
        
        updates.push({ op: "set" as const, path: "/openTracking/openCount", value: newOpenCount });

        // Set firstOpenedAt only on first open
        if (!resource.openTracking?.firstOpenedAt) {
            updates.push({ op: "set" as const, path: "/openTracking/firstOpenedAt", value: now });
        }
        
        // Always update lastOpenedAt
        updates.push({ op: "set" as const, path: "/openTracking/lastOpenedAt", value: now });

        // Update uniqueUserAgents (simple logic)
        if (currentOpenCount === 0) {
            updates.push({ op: "set" as const, path: "/openTracking/uniqueUserAgents", value: 1 });
        }

        // Update updatedAt
        updates.push({ op: "set" as const, path: "/updatedAt", value: now });

        // Use messageId (document id) and user_id (partition key value from /user_id field)
        console.log(`📝 Patching document: id=${resource.id}, partitionKey=${partitionKeyValue}`);
        await container.item(resource.id, partitionKeyValue).patch(updates);
        console.log(`📧 Email opened: ${messageId} (count: ${newOpenCount})`);
    } catch (error) {
        // Fail silently - never break the tracking pixel
        console.error("Open tracking failed:", error);
    }
}
