import { dbService } from "./dbService";
import { getGraphClient } from "./subscriptionManager";

/**
 * Detect and track email forwarding using Microsoft Graph API
 * Uses multiple indicators to determine if an email was forwarded
 */
export async function handleEmailForwarding(
    messageId: string,
    graphMessageData: any
): Promise<void> {
    console.log(`📤 Attempting to detect forwarding for message: ${messageId}`);
    
    try {
        // Extract Graph API message data
        const internetMessageHeaders = graphMessageData.internetMessageHeaders || [];
        const fromEmail = graphMessageData.from?.emailAddress?.address;
        const toRecipients = graphMessageData.toRecipients || [];
        const ccRecipients = graphMessageData.ccRecipients || [];
        const subject = graphMessageData.subject || "";
        const bodyContent = graphMessageData.body?.content || graphMessageData.bodyPreview || "";
        const receivedDateTime = graphMessageData.receivedDateTime || new Date().toISOString();
        const forwardedMessageId = graphMessageData.id; // Graph API message ID of the forwarded message
        
        // Find our custom tracking header
        const ourMessageIdHeader = internetMessageHeaders.find(
            (h: any) => h.name === "X-AgentMira-Message-Id"
        );
        
        if (!ourMessageIdHeader) {
            // No tracking header found - this message is not related to our emails
            return;
        }
        
        const originalMessageId = ourMessageIdHeader.value;
        console.log(`📤 Forwarding detection: Found original message ID: ${originalMessageId}`);
        
        // Get the original email tracking data
        const originalEmail = await dbService.findTrackingDataById(originalMessageId);
        
        if (!originalEmail) {
            console.warn(`⚠️ Original email not found for forwarding detection: ${originalMessageId}`);
            return;
        }
        
        const originalRecipient = originalEmail.recipient.email.toLowerCase();
        const fromEmailLower = fromEmail?.toLowerCase() || "";
        
        // Detection indicators (multiple methods for accuracy)
        let forwardingIndicators: string[] = [];
        let confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH" = "NONE";
        
        // Method 1: Check if sender is NOT the original recipient (high confidence)
        // This is the strongest indicator - if someone else is sending our tracked email
        if (fromEmailLower && fromEmailLower !== originalRecipient) {
            forwardingIndicators.push(`Forwarded by different sender: ${fromEmail} (original recipient: ${originalRecipient})`);
            confidence = "HIGH";
            console.log(`📤 HIGH confidence: Different sender detected (${fromEmail} != ${originalRecipient})`);
        }
        
        // Method 2: Check for forwarding headers in message
        const forwardedHeader = internetMessageHeaders.find(
            (h: any) => h.name.toLowerCase() === "x-forwarded-for" || 
                       h.name.toLowerCase() === "x-forwarded-message" ||
                       h.name.toLowerCase() === "forwarded"
        );
        
        if (forwardedHeader) {
            forwardingIndicators.push(`Forwarding header detected: ${forwardedHeader.name}`);
            if (confidence === "NONE") confidence = "MEDIUM";
            console.log(`📤 Forwarding header found: ${forwardedHeader.name}`);
        }
        
        // Method 3: Check subject line for forwarding indicators
        const subjectLower = subject.toLowerCase();
        if (subjectLower.includes("fwd:") || 
            subjectLower.includes("fw:") || 
            subjectLower.startsWith("re: fwd:") ||
            subjectLower.startsWith("re: fw:")) {
            forwardingIndicators.push(`Forwarding indicator in subject: "${subject}"`);
            if (confidence === "NONE") confidence = "MEDIUM";
            console.log(`📤 Forwarding indicator in subject: "${subject}"`);
        }
        
        // Method 4: Check if body contains forwarded email patterns
        // Look for common forwarding patterns like "-----Original Message-----" or "From:"
        const forwardedBodyPatterns = [
            /-----Original Message-----/i,
            /From:[\s\S]{0,200}Sent:[\s\S]{0,200}To:[\s\S]{0,200}Subject:/i,
            /---------- Forwarded message/i,
            /Begin forwarded message/i
        ];
        
        const hasForwardedPattern = forwardedBodyPatterns.some(pattern => pattern.test(bodyContent));
        if (hasForwardedPattern) {
            forwardingIndicators.push("Forwarded email pattern detected in body");
            if (confidence === "NONE") confidence = "LOW";
            console.log(`📤 Forwarded email pattern found in body content`);
        }
        
        // Method 5: Check recipient list - if email is sent to new recipients not in original
        // This is less reliable but can be an indicator
        const allRecipients = [
            ...toRecipients.map((r: any) => r.emailAddress?.address?.toLowerCase()),
            ...ccRecipients.map((r: any) => r.emailAddress?.address?.toLowerCase())
        ].filter(Boolean);
        
        // If original recipient is NOT in the recipient list, likely forwarded
        if (allRecipients.length > 0 && !allRecipients.includes(originalRecipient)) {
            forwardingIndicators.push(`Original recipient (${originalRecipient}) not in recipient list: ${allRecipients.join(", ")}`);
            if (confidence === "NONE" || confidence === "LOW") {
                confidence = confidence === "NONE" ? "LOW" : "MEDIUM";
            }
            console.log(`📤 Recipient mismatch detected`);
        }
        
        // Method 6: Check if message references our tracking pixel or message ID in body
        // If our tracking ID appears in the body of a new message, it was likely forwarded
        if (bodyContent.includes(originalMessageId) || 
            bodyContent.includes(`messageId: ${originalMessageId}`) ||
            bodyContent.includes(`/open/${originalMessageId}.png`)) {
            forwardingIndicators.push("Original message tracking ID found in body");
            if (confidence === "NONE") confidence = "MEDIUM";
            else if (confidence === "LOW") confidence = "MEDIUM";
            console.log(`📤 Tracking ID found in forwarded message body`);
        }
        
        // Determine if email was forwarded based on detection indicators
        const isForwarded = confidence !== "NONE";
        
        if (isForwarded) {
            console.log(`📤 Forwarding detected for ${originalMessageId}: ${confidence} confidence`);
            console.log(`   Indicators: ${forwardingIndicators.join("; ")}`);
            
            // Extract recipient emails from Graph API data
            const forwardedToEmails = [
                ...toRecipients.map((r: any) => r.emailAddress?.address).filter(Boolean),
                ...ccRecipients.map((r: any) => r.emailAddress?.address).filter(Boolean)
            ];
            
            // Update the forwarding tracking data with actual Graph API fields
            const updates: any[] = [
                { op: "set" as const, path: "/forwardingTracking/isForwarded", value: true },
                { op: "set" as const, path: "/forwardingTracking/forwardedBy", value: fromEmail },
                { op: "set" as const, path: "/forwardingTracking/forwardedAt", value: receivedDateTime },
                { op: "set" as const, path: "/forwardingTracking/forwardedTo", value: forwardedToEmails },
                { op: "set" as const, path: "/forwardingTracking/forwardedMessageId", value: forwardedMessageId },
                { op: "set" as const, path: "/updatedAt", value: new Date().toISOString() }
            ];
            
            const partitionKey = originalEmail.user_id;
            await dbService.patchTrackingData(originalMessageId, partitionKey, updates);
            
            console.log(`✅ Forwarding tracked: ${originalMessageId}`);
            console.log(`   Forwarded by: ${fromEmail}`);
            console.log(`   Forwarded at: ${receivedDateTime}`);
            console.log(`   Forwarded to: ${forwardedToEmails.join(", ")}`);
            console.log(`   Forwarded message ID: ${forwardedMessageId}`);
        } else {
            console.log(`📤 No forwarding detected for ${originalMessageId}`);
        }
        
    } catch (error) {
        // Fail silently - never break forwarding detection
        console.error("Forwarding detection failed:", error);
    }
}

