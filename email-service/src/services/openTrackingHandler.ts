import { dbService } from "./dbService";
import { LifecycleStatus } from "../types/tracking";

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

        // Update lifecycle status to OPENED if it was just SENT
        if (resource.lifecycleStatus === LifecycleStatus.SENT) {
            updates.push({ op: "set", path: "/lifecycleStatus", value: LifecycleStatus.OPENED });
        }

        const currentOpenCount = resource.open?.openCount || 0;
        updates.push({ op: "set", path: "/open/openCount", value: currentOpenCount + 1 });

        if (!resource.open?.firstOpenedAt) {
            updates.push({ op: "set", path: "/open/firstOpenedAt", value: now });
        }
        updates.push({ op: "set", path: "/open/lastOpenedAt", value: now });

        // Note: Simple uniqueUserAgents logic for now
        // In a real app we'd track specific user agents
        if (currentOpenCount === 0) {
            updates.push({ op: "set", path: "/open/uniqueUserAgents", value: 1 });
        }

        await dbService.patchTrackingData(messageId, resource.userId, updates);
    } catch (error) {
        console.error("Open tracking failed:", error);
    }
}
