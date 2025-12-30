import { dbService } from "./dbService";
import { LifecycleStatus } from "../types/emailTracking";
import { cleanReplyContent } from "../utils/emailUtils";

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

        // Update lifecycle status to REPLIED
        // REPLIED is the highest engagement level, so always set it regardless of current status
        // (If email was OPENED, REPLIED takes precedence. If FAILED, this shouldn't happen, but handle gracefully)
        const previousStatus = resource.lifecycleStatus;
        if (previousStatus === LifecycleStatus.FAILED) {
            console.warn(`⚠️ Reply received for email with FAILED status: ${messageId}. This is unusual.`);
        }
        updates.push({ op: "set", path: "/lifecycleStatus", value: LifecycleStatus.REPLIED });
        updates.push({ op: "set", path: "/reply/status", value: "REPLIED" });
        updates.push({ op: "set", path: "/reply/repliedAt", value: receivedAt });
        updates.push({ op: "set", path: "/reply/from", value: fromEmail });
        
        console.log(`💬 Email replied: ${messageId} (lifecycle: ${previousStatus} -> REPLIED)`);
        
        // Add reply message details if provided
        if (replyMessageId) {
            updates.push({ op: "set", path: "/reply/replyMessageId", value: replyMessageId });
        }
        if (replySnippet) {
            // Clean reply content to remove quoted text, signatures, etc.
            // Store only the actual reply content
            const cleanedReply = cleanReplyContent(replySnippet);
            if (cleanedReply) {
                updates.push({ op: "set", path: "/reply/replySnippet", value: cleanedReply });
            } else {
                // If cleaning results in empty string, store original (might be a very short reply)
                console.log(`⚠️ Reply content became empty after cleaning, storing original snippet`);
                updates.push({ op: "set", path: "/reply/replySnippet", value: replySnippet.substring(0, 500) });
            }
        }
        if (isAutoReply !== undefined) {
            updates.push({ op: "set", path: "/reply/isAutoReply", value: isAutoReply });
        }

        // Use user_id (partition key)
        const partitionKey = resource.user_id;
        await dbService.patchTrackingData(messageId, partitionKey, updates);
        console.log(`💬 Reply tracked: ${messageId} from ${fromEmail}${replyMessageId ? ` [Reply ID: ${replyMessageId}]` : ''}`);
    } catch (error) {
        // Fail silently - never break reply tracking
        console.error("Reply tracking failed:", error);
    }
}
