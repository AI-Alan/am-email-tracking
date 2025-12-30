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
    isForwarded: boolean; // Simple boolean flag indicating if email was forwarded
    forwardedBy?: string; // Email address from Graph API 'from' field (who forwarded it)
    forwardedAt?: string; // Timestamp from Graph API 'receivedDateTime' (when it was forwarded)
    forwardedTo?: string[]; // Array of recipient emails from 'toRecipients' and 'ccRecipients' (who it was forwarded to)
    forwardedMessageId?: string; // Graph API message ID of the forwarded message
}

export interface EmailTracking {
    id: string; // Internal messageId (UUID)
    user_id: string; // Partition key (must match Cosmos DB partition key path /user_id)

    channel: "EMAIL";
    provider: "MICROSOFT_GRAPH";
    direction: "OUTBOUND";
    lifecycleStatus: LifecycleStatus;

    recipient: Recipient;
    email: EmailDetails;
    graph: GraphDetails;
    deliveryStatus: SentDetails; // Renamed from 'sent'
    openTracking: OpenDetails; // Renamed from 'open'
    replyTracking: ReplyDetails; // Renamed from 'reply'
    forwardingTracking: ForwardingDetails; // Renamed from 'forwarding'

    // Metadata for Cosmos DB indexing/querying
    createdAt: string;
    updatedAt: string;
}
