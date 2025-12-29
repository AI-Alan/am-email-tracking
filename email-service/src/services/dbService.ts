import { CosmosClient, Container, PatchOperation } from "@azure/cosmos";
import { EmailTracking } from "../types/tracking";
import { TrackingSummary } from "../types/trackingSummary";

class DbService {
    private container: Container | null = null;
    private summaryContainer: Container | null = null;
    private initialized = false;
    private summaryInitialized = false;

    private init() {
        if (this.initialized) return;

        const { COSMOS_URI, COSMOS_KEY, COSMOS_DATABASE_REALTOR_MANAGEMENT, COSMOS_CONTAINER_EMAIL } = process.env;

        if (!COSMOS_URI || !COSMOS_KEY || !COSMOS_DATABASE_REALTOR_MANAGEMENT || !COSMOS_CONTAINER_EMAIL) {
            console.error("Missing Cosmos DB environment variables");
            return;
        }

        const cosmosClient = new CosmosClient({ endpoint: COSMOS_URI, key: COSMOS_KEY });
        this.container = cosmosClient
            .database(COSMOS_DATABASE_REALTOR_MANAGEMENT)
            .container(COSMOS_CONTAINER_EMAIL);

        this.initialized = true;
    }

    private initSummaryContainer() {
        if (this.summaryInitialized) return;

        const { COSMOS_URI, COSMOS_KEY, COSMOS_DATABASE_REALTOR_MANAGEMENT, COSMOS_CONTAINER_TRACKING_SUMMARY } = process.env;

        if (!COSMOS_URI || !COSMOS_KEY || !COSMOS_DATABASE_REALTOR_MANAGEMENT || !COSMOS_CONTAINER_TRACKING_SUMMARY) {
            console.error("Missing Cosmos DB environment variables for tracking summary");
            return;
        }

        const cosmosClient = new CosmosClient({ endpoint: COSMOS_URI, key: COSMOS_KEY });
        this.summaryContainer = cosmosClient
            .database(COSMOS_DATABASE_REALTOR_MANAGEMENT)
            .container(COSMOS_CONTAINER_TRACKING_SUMMARY);

        this.summaryInitialized = true;
    }

    private getContainer(): Container {
        this.init();
        if (!this.container) {
            throw new Error("Cosmos DB Container not initialized");
        }
        return this.container;
    }

    private getSummaryContainer(): Container {
        this.initSummaryContainer();
        if (!this.summaryContainer) {
            throw new Error("Cosmos DB Summary Container not initialized");
        }
        return this.summaryContainer;
    }

    /**
     * Save or update the entire tracking document
     */
    async saveTrackingData(data: EmailTracking): Promise<void> {
        try {
            const container = this.getContainer();
            await container.items.upsert(data);
            console.log(`📝 Tracking data saved/updated in Cosmos DB: ${data.id}`);
        } catch (error) {
            console.error(`⚠️ Failed to save tracking data for ${data.id}:`, error);
            throw error;
        }
    }

    /**
     * Retrieve tracking data by ID and userId (partition key)
     */
    async getTrackingData(id: string, userId: string): Promise<EmailTracking | null> {
        try {
            const container = this.getContainer();
            const { resource } = await container.item(id, userId).read<EmailTracking>();
            return resource || null;
        } catch (error) {
            console.error(`⚠️ Failed to retrieve tracking data for ${id}:`, error);
            return null;
        }
    }

    /**
     * Retrieve tracking data by ID using a query (when userId is unknown)
     */
    async findTrackingDataById(id: string): Promise<EmailTracking | null> {
        try {
            const container = this.getContainer();
            const query = `SELECT * FROM c WHERE c.id = @id`;
            const { resources } = await container.items
                .query({
                    query,
                    parameters: [{ name: "@id", value: id }]
                })
                .fetchAll();

            return resources?.[0] || null;
        } catch (error) {
            console.error(`⚠️ Failed to find tracking data for ${id}:`, error);
            return null;
        }
    }

    /**
     * Patch a tracking document
     */
    async patchTrackingData(id: string, userId: string, operations: PatchOperation[]): Promise<void> {
        try {
            const container = this.getContainer();
            // Add updatedAt to the patch if it's not already there
            if (!operations.some(op => op.path === "/updatedAt")) {
                operations.push({ op: "set", path: "/updatedAt", value: new Date().toISOString() });
            }
            await container.item(id, userId).patch(operations);
            console.log(`✅ Tracking data patched in Cosmos DB: ${id}`);
        } catch (error) {
            console.error(`⚠️ Failed to patch tracking data for ${id}:`, error);
            throw error;
        }
    }

    /**
     * Query all email tracking data for a specific buyer_id (userId)
     */
    async getEmailsByBuyerId(buyerId: string): Promise<EmailTracking[]> {
        try {
            const container = this.getContainer();
            const query = `SELECT * FROM c WHERE c.userId = @buyerId ORDER BY c.sent.sentAt DESC`;
            const { resources } = await container.items
                .query({
                    query,
                    parameters: [{ name: "@buyerId", value: buyerId }]
                })
                .fetchAll();

            return resources || [];
        } catch (error) {
            console.error(`⚠️ Failed to query emails for buyer_id ${buyerId}:`, error);
            throw error;
        }
    }

    /**
     * Save or update tracking summary document
     */
    async saveTrackingSummary(summary: TrackingSummary): Promise<void> {
        try {
            const container = this.getSummaryContainer();
            await container.items.upsert(summary);
            console.log(`📝 Tracking summary saved/updated for buyer_id: ${summary.buyer_id}`);
        } catch (error) {
            console.error(`⚠️ Failed to save tracking summary for ${summary.buyer_id}:`, error);
            throw error;
        }
    }

    /**
     * Get tracking summary for a buyer_id
     */
    async getTrackingSummary(buyerId: string): Promise<TrackingSummary | null> {
        try {
            const container = this.getSummaryContainer();
            const query = `SELECT * FROM c WHERE c.buyer_id = @buyerId ORDER BY c.updatedAt DESC OFFSET 0 LIMIT 1`;
            const { resources } = await container.items
                .query({
                    query,
                    parameters: [{ name: "@buyerId", value: buyerId }]
                })
                .fetchAll();

            return resources?.[0] || null;
        } catch (error) {
            console.error(`⚠️ Failed to get tracking summary for buyer_id ${buyerId}:`, error);
            return null;
        }
    }
}

export const dbService = new DbService();
export default dbService;
