import { CosmosClient, Container, PatchOperation } from "@azure/cosmos";
import { EmailTracking } from "../types/emailTracking";
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
            const missing = [];
            if (!COSMOS_URI) missing.push("COSMOS_URI");
            if (!COSMOS_KEY) missing.push("COSMOS_KEY");
            if (!COSMOS_DATABASE_REALTOR_MANAGEMENT) missing.push("COSMOS_DATABASE_REALTOR_MANAGEMENT");
            if (!COSMOS_CONTAINER_TRACKING_SUMMARY) missing.push("COSMOS_CONTAINER_TRACKING_SUMMARY");
            
            console.error(`❌ Missing Cosmos DB environment variables for tracking summary: ${missing.join(", ")}`);
            this.summaryInitialized = true; // Mark as initialized to prevent repeated attempts
            return;
        }

        try {
            const cosmosClient = new CosmosClient({ endpoint: COSMOS_URI, key: COSMOS_KEY });
            this.summaryContainer = cosmosClient
                .database(COSMOS_DATABASE_REALTOR_MANAGEMENT)
                .container(COSMOS_CONTAINER_TRACKING_SUMMARY);

            this.summaryInitialized = true;
            console.log(`✅ Summary container initialized: ${COSMOS_CONTAINER_TRACKING_SUMMARY}`);
        } catch (error) {
            console.error(`❌ Failed to initialize summary container:`, error);
            this.summaryInitialized = true; // Mark as initialized to prevent repeated attempts
        }
    }

    private getContainer(): Container {
        this.init();
        if (!this.container) {
            throw new Error("Cosmos DB Container not initialized. Check COSMOS_URI, COSMOS_KEY, COSMOS_DATABASE_REALTOR_MANAGEMENT, and COSMOS_CONTAINER_EMAIL environment variables.");
        }
        return this.container;
    }

    private getSummaryContainer(): Container {
        this.initSummaryContainer();
        if (!this.summaryContainer) {
            const missing = [];
            if (!process.env.COSMOS_URI) missing.push("COSMOS_URI");
            if (!process.env.COSMOS_KEY) missing.push("COSMOS_KEY");
            if (!process.env.COSMOS_DATABASE_REALTOR_MANAGEMENT) missing.push("COSMOS_DATABASE_REALTOR_MANAGEMENT");
            if (!process.env.COSMOS_CONTAINER_TRACKING_SUMMARY) missing.push("COSMOS_CONTAINER_TRACKING_SUMMARY");
            
            throw new Error(`Cosmos DB Summary Container not initialized. Missing environment variables: ${missing.join(", ")}. Please set COSMOS_CONTAINER_TRACKING_SUMMARY in your environment.`);
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
     * Retrieve tracking data by ID and user_id (partition key)
     * user_id is the partition key value
     */
    async getTrackingData(id: string, userId: string): Promise<EmailTracking | null> {
        try {
            const container = this.getContainer();
            // Partition key is /user_id, so use userId value as partition key
            const { resource } = await container.item(id, userId).read<EmailTracking>();
            return resource || null;
        } catch (error) {
            console.error(`⚠️ Failed to retrieve tracking data for ${id}:`, error);
            return null;
        }
    }

    /**
     * Retrieve tracking data by ID using a query (when user_id is unknown)
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
     * Find tracking data by Graph API internetMessageId (used for matching replies)
     */
    async findTrackingDataByInternetMessageId(internetMessageId: string): Promise<EmailTracking | null> {
        try {
            const container = this.getContainer();
            const query = `SELECT * FROM c WHERE c.graph.internetMessageId = @internetMessageId`;
            const { resources } = await container.items
                .query({
                    query,
                    parameters: [{ name: "@internetMessageId", value: internetMessageId }]
                })
                .fetchAll();

            return resources?.[0] || null;
        } catch (error) {
            console.error(`⚠️ Failed to find tracking data by internetMessageId ${internetMessageId}:`, error);
            return null;
        }
    }

    /**
     * Find tracking data by Graph API conversationId (used for matching replies in same thread)
     */
    async findTrackingDataByConversationId(conversationId: string, recipientEmail?: string): Promise<EmailTracking | null> {
        try {
            const container = this.getContainer();
            let query = `SELECT * FROM c WHERE c.graph.conversationId = @conversationId`;
            const parameters: any[] = [{ name: "@conversationId", value: conversationId }];
            
            // If recipient email is provided, also filter by recipient to ensure correct match
            if (recipientEmail) {
                query += ` AND c.recipient.email = @recipientEmail`;
                parameters.push({ name: "@recipientEmail", value: recipientEmail });
            }
            
            query += ` ORDER BY c.sent.sentAt DESC OFFSET 0 LIMIT 1`;
            
            const { resources } = await container.items
                .query({
                    query,
                    parameters
                })
                .fetchAll();

            return resources?.[0] || null;
        } catch (error) {
            console.error(`⚠️ Failed to find tracking data by conversationId ${conversationId}:`, error);
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
     * Query email tracking data for a specific user_id
     * Optimized to prefer emails with Graph API data (messageId) for better analysis
     * Groups by conversationId for thread-level insights
     * Fetches emails where user_id matches (partition key)
     * Sorted by sentAt DESC (most recent first)
     * Limited to last 100 emails for performance
     */
    async getEmailsByBuyerId(buyerId: string, limit: number = 50, preferGraphData: boolean = true): Promise<EmailTracking[]> {
        try {
            const container = this.getContainer();
            
            // Query by user_id (partition key) - prefer emails with Graph API data
            // Graph data indicates complete metadata and better analysis quality
            let query = `SELECT * FROM c WHERE c.user_id = @buyerId`;
            const parameters: any[] = [{ name: "@buyerId", value: buyerId }];
            
            if (preferGraphData) {
                // Prefer emails with Graph messageId (complete metadata)
                // Still include recent emails without Graph data (they might be < 30s old)
                const recentThreshold = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
                query += ` AND (c.graph.messageId != '' AND c.graph.messageId != null OR c.sent.sentAt > @recentThreshold)`;
                parameters.push({ name: "@recentThreshold", value: recentThreshold });
            }
            
            query += ` ORDER BY c.sent.sentAt DESC`;
            
            const { resources } = await container.items
                .query(
                    {
                        query,
                        parameters
                    },
                    {
                        maxItemCount: limit * 2 // Fetch more to allow filtering/grouping
                    }
                )
                .fetchAll();

            // Group by conversationId for thread-level analysis
            const conversationMap = new Map<string, EmailTracking[]>();
            const standaloneEmails: EmailTracking[] = [];
            
            for (const email of resources || []) {
                if (email.graph?.conversationId) {
                    const convId = email.graph.conversationId;
                    if (!conversationMap.has(convId)) {
                        conversationMap.set(convId, []);
                    }
                    conversationMap.get(convId)!.push(email);
                } else {
                    // Emails without conversationId are treated as standalone
                    standaloneEmails.push(email);
                }
            }
            
            // For each conversation thread, take the latest email (most recent by sentAt)
            // This gives us one representative email per conversation
            const threadRepresentatives: EmailTracking[] = [];
            for (const [convId, emails] of conversationMap.entries()) {
                // Sort by sentAt DESC and take the latest
                emails.sort((a, b) => 
                    new Date(b.sent.sentAt).getTime() - new Date(a.sent.sentAt).getTime()
                );
                const latestInThread = emails[0];
                threadRepresentatives.push(latestInThread);
            }
            
            // Combine thread representatives with standalone emails
            const allEmails = [...threadRepresentatives, ...standaloneEmails];
            
            // Sort all by sentAt DESC
            allEmails.sort((a, b) => 
                new Date(b.sent.sentAt).getTime() - new Date(a.sent.sentAt).getTime()
            );
            
            // Limit to requested number
            const limitedResources = allEmails.slice(0, limit);
            
            console.log(`📧 Found ${limitedResources.length} emails for user_id: ${buyerId} (${conversationMap.size} threads, ${standaloneEmails.length} standalone, out of ${resources?.length || 0} total)`);
            return limitedResources;
        } catch (error) {
            console.error(`⚠️ Failed to query emails for buyer_id ${buyerId}:`, error);
            throw error;
        }
    }

    /**
     * Save or update tracking summary document
     * Uses user_id as document id to ensure one document per user (upsert behavior)
     */
    async saveTrackingSummary(summary: TrackingSummary): Promise<void> {
        try {
            const container = this.getSummaryContainer();
            
            // Ensure id is set to user_id for consistent upsert
            if (!summary.id) {
                summary.id = summary.user_id;
            }
            
            // Upsert will update existing document if id matches, or create new one
            // Partition key is user_id, so we pass user_id as partition key value
            await container.items.upsert(summary);
            
            console.log(`📝 Tracking summary ${summary.id === summary.user_id ? 'updated' : 'saved'} for user_id: ${summary.user_id} (document id: ${summary.id})`);
        } catch (error) {
            console.error(`⚠️ Failed to save tracking summary for ${summary.user_id}:`, error);
            throw error;
        }
    }

    /**
     * Get tracking summary for a user_id
     * Uses user_id as both document id and partition key for efficient direct lookup
     * Supports backward compatibility with old documents that use buyer_id
     */
    async getTrackingSummary(userId: string): Promise<TrackingSummary | null> {
        try {
            const container = this.getSummaryContainer();
            
            // Try direct read first (more efficient) - using user_id as both id and partition key
            try {
                const { resource } = await container.item(userId, userId).read<TrackingSummary>();
                if (resource) {
                    return resource;
                }
            } catch (readError: any) {
                // If document doesn't exist (404), fall back to query for backward compatibility
                // This handles old documents that might have different id format or use buyer_id
                if (readError.code !== 404) {
                    console.warn(`⚠️ Direct read failed for user_id ${userId}, falling back to query:`, readError.message);
                }
            }
            
            // Fallback: Query by user_id first (new format), then buyer_id (old format) for backward compatibility
            let query = `SELECT * FROM c WHERE c.user_id = @userId ORDER BY c.updatedAt DESC OFFSET 0 LIMIT 1`;
            let { resources } = await container.items
                .query({
                    query,
                    parameters: [{ name: "@userId", value: userId }]
                })
                .fetchAll();

            // If not found, try old buyer_id field for backward compatibility
            if (!resources || resources.length === 0) {
                query = `SELECT * FROM c WHERE c.buyer_id = @userId ORDER BY c.updatedAt DESC OFFSET 0 LIMIT 1`;
                const oldFormatResult = await container.items
                    .query({
                        query,
                        parameters: [{ name: "@userId", value: userId }]
                    })
                    .fetchAll();
                resources = oldFormatResult.resources;
            }

            const summary = resources?.[0] || null;
            
            // If we found an old document, log a warning
            if (summary) {
                if (summary.id !== userId) {
                    console.warn(`⚠️ Found tracking summary for user_id ${userId} with different id: ${summary.id}. Consider migrating.`);
                }
                // Migrate old buyer_id to user_id if needed
                if ((summary as any).buyer_id && !summary.user_id) {
                    console.warn(`⚠️ Found old format document with buyer_id. Migration needed.`);
                }
            }
            
            return summary;
        } catch (error) {
            console.error(`⚠️ Failed to get tracking summary for user_id ${userId}:`, error);
            return null;
        }
    }
}

export const dbService = new DbService();
export default dbService;
