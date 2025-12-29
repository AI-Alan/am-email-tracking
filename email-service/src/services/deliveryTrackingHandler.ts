import { dbService } from "./dbService";
import { LifecycleStatus } from "../types/tracking";

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
            updates.push({ op: "set", path: "/lifecycleStatus", value: LifecycleStatus.SENT }); // Or maybe we need a DELIVERED status? The prompt didn't list DELIVERED in lifecycle status values.
            // Based on prompt: SENT (graph-confirmed), OPENED (pixel-based), REPLIED (graph-inferred)
            // I'll keep it as SENT for now if it's just delivered, or map to SENT.
            updates.push({ op: "set", path: "/sent/status", value: "SENT" });
            updates.push({ op: "set", path: "/sent/sentAt", value: timestamp });
            console.log(`✅ Email delivered: ${messageId}`);
        } else if (status === 'BOUNCED') {
            updates.push({ op: "set", path: "/lifecycleStatus", value: LifecycleStatus.FAILED });
            updates.push({ op: "set", path: "/sent/status", value: "FAILED" });
            // We could add bounce specific info if we had fields for it in the new structure
            // For now, I'll just update the status.
            console.log(`❌ Email bounced: ${messageId} - ${bounceReason || 'Unknown reason'}`);
        }

        await dbService.patchTrackingData(messageId, resource.userId, updates);
    } catch (error) {
        console.error("Delivery tracking failed:", error);
    }
}
