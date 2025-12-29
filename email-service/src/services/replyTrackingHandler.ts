import { dbService } from "./dbService";
import { LifecycleStatus } from "../types/tracking";

// Pure logic handler for reply tracking - no Express dependencies
export async function handleEmailReply(
    messageId: string,
    fromEmail: string,
    receivedAt: string,
    replyMessageId?: string,
    replySnippet?: string,
    isAutoReply?: boolean
): Promise<void> {
    console.log(`💬 Attempting to track reply for: ${messageId} from ${fromEmail}`);
    try {
        // Read current email log 
        const resource = await dbService.findTrackingDataById(messageId);

        if (!resource) {
            console.error(`Email log not found for reply: ${messageId}`);
            return; // Fail silently
        }

        const updates: any[] = [];

        // Update lifecycle status and reply details
        updates.push({ op: "set", path: "/lifecycleStatus", value: LifecycleStatus.REPLIED });
        updates.push({ op: "set", path: "/reply/status", value: "REPLIED" });
        updates.push({ op: "set", path: "/reply/repliedAt", value: receivedAt });
        updates.push({ op: "set", path: "/reply/from", value: fromEmail });
        
        // Add reply message details if provided
        if (replyMessageId) {
            updates.push({ op: "set", path: "/reply/replyMessageId", value: replyMessageId });
        }
        if (replySnippet) {
            updates.push({ op: "set", path: "/reply/replySnippet", value: replySnippet });
        }
        if (isAutoReply !== undefined) {
            updates.push({ op: "set", path: "/reply/isAutoReply", value: isAutoReply });
        }

        await dbService.patchTrackingData(messageId, resource.userId, updates);
        console.log(`💬 Reply tracked: ${messageId} from ${fromEmail}${replyMessageId ? ` [Reply ID: ${replyMessageId}]` : ''}`);
    } catch (error) {
        // Fail silently - never break reply tracking
        console.error("Reply tracking failed:", error);
    }
}
