import { dbService } from "./dbService";
import { LifecycleStatus } from "../types/emailTracking";

// Handler for delivery and bounce tracking
export async function handleEmailDelivery(
    messageId: string,
    status: 'DELIVERED' | 'BOUNCED',
    timestamp: string,
    bounceReason?: string
): Promise<void> {
    try {
        // Find the tracking data by ID
        const resource = await dbService.findTrackingDataById(messageId);

        if (!resource) {
            console.error(`Email log not found for delivery update: ${messageId}`);
            return;
        }

        const updates: any[] = [];

        if (status === 'DELIVERED') {
            // Only update lifecycle status if email is still in SENT or FAILED state
            // Don't overwrite OPENED or REPLIED status (lifecycle should progress forward, not backward)
            const currentStatus = resource.lifecycleStatus;
            const willUpdateStatus = currentStatus === LifecycleStatus.FAILED || currentStatus === LifecycleStatus.SENT;
            if (willUpdateStatus) {
                updates.push({ op: "set", path: "/lifecycleStatus", value: LifecycleStatus.SENT });
            }
            // Always update delivery status and timestamp (these are separate from lifecycle status)
            updates.push({ op: "set", path: "/deliveryStatus/status", value: "SENT" });
            updates.push({ op: "set", path: "/deliveryStatus/sentAt", value: timestamp });
            const newStatus = willUpdateStatus ? LifecycleStatus.SENT : currentStatus;
            console.log(`✅ Email delivered: ${messageId} (lifecycle: ${currentStatus} -> ${newStatus})`);
        } else if (status === 'BOUNCED') {
            // Bounce always sets status to FAILED, regardless of current status
            updates.push({ op: "set", path: "/lifecycleStatus", value: LifecycleStatus.FAILED });
            updates.push({ op: "set", path: "/deliveryStatus/status", value: "FAILED" });
            console.log(`❌ Email bounced: ${messageId} - ${bounceReason || 'Unknown reason'}`);
        }

        // Use user_id (partition key)
        const partitionKey = resource.user_id;
        await dbService.patchTrackingData(messageId, partitionKey, updates);
    } catch (error) {
        console.error("Delivery tracking failed:", error);
    }
}
