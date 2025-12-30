import { dbService } from "./dbService";
import { LifecycleStatus } from "../types/emailTracking";

export async function handleEmailOpen(
    messageId: string,
    userAgent: string
): Promise<void> {
    console.log(`👁️ Tracking open for: ${messageId}`);
    try {
        const resource = await dbService.findTrackingDataById(messageId);

        if (!resource) {
            console.error(`Email log not found for open tracking: ${messageId}`);
            return;
        }

        const now = new Date().toISOString();
        const updates: any[] = [];

        // Update lifecycle status to OPENED if email is currently SENT
        // If email is already REPLIED or FAILED, don't change status
        // (REPLIED takes precedence over OPENED, and FAILED means email never arrived)
        const currentStatus = resource.lifecycleStatus;
        if (currentStatus === LifecycleStatus.SENT) {
            updates.push({ op: "set", path: "/lifecycleStatus", value: LifecycleStatus.OPENED });
            console.log(`👁️ Email opened: ${messageId} (lifecycle: SENT -> OPENED)`);
        } else if (currentStatus === LifecycleStatus.OPENED) {
            // Email already opened, just update open count
            console.log(`👁️ Email opened again: ${messageId} (lifecycle: already OPENED, updating count)`);
        } else {
            // Email is REPLIED, FAILED, etc. - log but don't change status
            console.log(`👁️ Email opened but lifecycle is ${currentStatus}: ${messageId} (keeping status)`);
        }

        const currentOpenCount = resource.openTracking?.openCount || 0;
        updates.push({ op: "set", path: "/openTracking/openCount", value: currentOpenCount + 1 });

        if (!resource.openTracking?.firstOpenedAt) {
            updates.push({ op: "set", path: "/openTracking/firstOpenedAt", value: now });
        }
        updates.push({ op: "set", path: "/openTracking/lastOpenedAt", value: now });

        // Note: Simple uniqueUserAgents logic for now
        // In a real app we'd track specific user agents
        if (currentOpenCount === 0) {
            updates.push({ op: "set", path: "/openTracking/uniqueUserAgents", value: 1 });
        }

        // Use user_id (partition key)
        const partitionKey = resource.user_id;
        await dbService.patchTrackingData(messageId, partitionKey, updates);
    } catch (error) {
        console.error("Open tracking failed:", error);
    }
}
