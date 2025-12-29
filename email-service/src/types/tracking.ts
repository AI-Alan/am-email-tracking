export enum LifecycleStatus {
    DRAFT = "DRAFT",
    QUEUED = "QUEUED",
    SENT = "SENT",
    OPENED = "OPENED",
    REPLIED = "REPLIED",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED"
}

export interface Recipient {
    email: string;
    name: string;
}

export interface EmailDetails {
    subject: string;
    bodyHtml?: string;
    bodyText?: string;
    templateId?: string;
}

export interface GraphDetails {
    messageId?: string;
    conversationId?: string;
    internetMessageId?: string;
}

export interface SentDetails {
    status: "SENT" | "FAILED" | "PENDING";
    sentAt: string; // ISO timestamp
}

export interface OpenDetails {
    openCount: number;
    firstOpenedAt?: string;
    lastOpenedAt?: string;
    uniqueUserAgents: number;
}

export interface ReplyDetails {
    status: "NONE" | "REPLIED";
    repliedAt?: string;
    replyMessageId?: string;
    from?: string;
    replySnippet?: string;
    isAutoReply: boolean;
}

export interface ForwardingDetails {
    suspected: boolean;
    confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH";
}

export interface EmailTracking {
    id: string; // Internal messageId (UUID)
    userId: string; // User ID field
    user_id: string; // Partition key (must match Cosmos DB partition key path /user_id)

    channel: "EMAIL";
    provider: "MICROSOFT_GRAPH";
    direction: "OUTBOUND";
    lifecycleStatus: LifecycleStatus;

    recipient: Recipient;
    email: EmailDetails;
    graph: GraphDetails;
    sent: SentDetails;
    open: OpenDetails;
    reply: ReplyDetails;
    forwarding: ForwardingDetails;

    // Metadata for Cosmos DB indexing/querying
    createdAt: string;
    updatedAt: string;
}
