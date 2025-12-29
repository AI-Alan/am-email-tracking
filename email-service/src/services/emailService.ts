import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import { randomUUID } from "crypto";
import "isomorphic-fetch";
import { dbService } from "./dbService";
import { EmailTracking, LifecycleStatus } from "../types/emailTracking";

// Email log model for Cosmos DB tracking
// Replaced by EmailTracking from ../types/tracking.ts

export interface EmailRecipient {
  email: string;
  name: string;
  user_id?: string;  // Optional: User ID from your portal (for partition key)
}

// Default email template when no body is provided
const DEFAULT_EMAIL_BODY = (recipientName: string) => `
  <div style="font-family: Arial, sans-serif; color: #222;">
    <p>Hello ${recipientName},</p>
    <p>Thank you for your message.</p>
    <p style="margin: 0; font-size: 1em; color: #222;">
      <strong>Team Agent Mira</strong><br/>
      <span style="font-size: 0.95em; color: #555;">AI + Real Agents. On your side.</span>
    </p>
  </div>
`;

/**
 * Convert plain text to HTML format
 * Handles line breaks, URLs, and basic formatting
 */
function formatPlainTextToHTML(text: string, recipientName: string): string {
  if (!text || text.trim().length === 0) {
    return DEFAULT_EMAIL_BODY(recipientName);
  }

  // Escape HTML entities
  const escapeHtml = (str: string) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Convert URLs to links
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const linkify = (text: string) => {
    return text.replace(urlRegex, '<a href="$1" style="color: #0078d4; text-decoration: none;">$1</a>');
  };

  // Convert line breaks to paragraphs
  const lines = text.split(/\n+/);
  const paragraphs = lines
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const escaped = escapeHtml(line);
      const linked = linkify(escaped);
      return `<p style="margin: 0 0 12px 0; line-height: 1.5;">${linked}</p>`;
    });

  // Build the HTML structure
  const bodyContent = paragraphs.join('\n');

  return `
    <div style="font-family: Arial, sans-serif; color: #222; max-width: 600px;">
      ${bodyContent}
      <p style="margin: 20px 0 0 0; font-size: 1em; color: #222;">
        <strong>Team Agent Mira</strong><br/>
        <span style="font-size: 0.95em; color: #555;">AI + Real Agents. On your side.</span>
      </p>
    </div>
  `;
}

/**
 * Check if text is HTML or plain text
 */
function isHTML(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  // Check for common HTML tags
  return /<\/?[a-z][\s\S]*>/i.test(trimmed);
}

class EmailService {
  private client: Client;
  private senderEmail: string;
  private baseUrl: string;

  constructor() {
    const {
      CLIENT_ID,
      TENANT_ID,
      CLIENT_SECRET,
      SENDER_EMAIL,
      COSMOS_URI,
      COSMOS_KEY,
      COSMOS_DATABASE_REALTOR_MANAGEMENT,
      COSMOS_CONTAINER_EMAIL,
    } = process.env;

    if (!CLIENT_ID || !TENANT_ID || !CLIENT_SECRET || !SENDER_EMAIL) {
      throw new Error('Missing required Microsoft Graph API environment variables');
    }

    this.senderEmail = SENDER_EMAIL;
    // Base URL for tracking pixel - use TRACKING_SERVICE_URL if set, otherwise use email-service URL
    this.baseUrl = process.env.TRACKING_SERVICE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

    // Initialize Microsoft Graph client
    const credential = new ClientSecretCredential(
      TENANT_ID,
      CLIENT_ID,
      CLIENT_SECRET
    );

    this.client = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => {
          const token = await credential.getToken("https://graph.microsoft.com/.default");
          return token?.token || '';
        },
      },
    });
  }

  // formatReadableTimestamp method removed in favor of standard ISO strings for better structure

  /**
   * Add tracking pixel to email body
   * This is automatically called for all emails to enable open tracking
   */
  private addTrackingPixel(messageId: string, emailBody: string): string {
    const trackingPixel = `<img src="${this.baseUrl}/open/${messageId}.png" width="1" height="1" style="display:none" alt="" />`;
    
    // Append tracking pixel to the email body
    return `${emailBody}${trackingPixel}`;
  }

  /**
   * Fetch Graph API message details from Sent Items
   * Retrieves messageId, conversationId, and internetMessageId after sending
   * Retries up to 3 times with increasing delays
   */
  private async fetchGraphMessageDetails(internalMessageId: string, userId: string): Promise<{
    messageId?: string;
    conversationId?: string;
    internetMessageId?: string;
  }> {
    const maxRetries = 5;
    // Longer delays: 5s, 10s, 15s, 20s, 30s (messages can take 5-30 seconds to appear in Sent Items)
    const delays = [5000, 10000, 15000, 20000, 30000];

    console.log(`🔍 Starting to fetch Graph API details for message ${internalMessageId}...`);
    console.log(`ℹ️ Note: Microsoft Graph API sendMail doesn't return message IDs. We must query Sent Items after the message appears.`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Wait for the message to appear in Sent Items (increasing delay)
        const delay = delays[attempt - 1] || delays[delays.length - 1];
        if (attempt > 1) {
          console.log(`⏳ Waiting ${delay/1000}s before attempt ${attempt}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        console.log(`🔍 Attempt ${attempt}/${maxRetries}: Querying Sent Items for message with header X-AgentMira-Message-Id: ${internalMessageId}`);

        // Primary method: Query by custom header
        try {
          const result = await this.client
            .api(`/users/${this.senderEmail}/mailFolders/SentItems/messages`)
            .filter(`internetMessageHeaders/any(x:x/name eq 'X-AgentMira-Message-Id' and x/value eq '${internalMessageId}')`)
            .orderby('sentDateTime desc')
            .top(1)
            .select('id,conversationId,internetMessageId')
            .get();

          if (result.value && result.value.length > 0) {
            const message = result.value[0];
            const graphDetails = {
              messageId: message.id,
              conversationId: message.conversationId,
              internetMessageId: message.internetMessageId
            };
            
            console.log(`✅ Successfully retrieved Graph API details for ${internalMessageId}:`);
            console.log(`   - messageId (Graph API id): ${graphDetails.messageId}`);
            console.log(`   - conversationId: ${graphDetails.conversationId || 'N/A'}`);
            console.log(`   - internetMessageId: ${graphDetails.internetMessageId || 'N/A'}`);
            
            // Update the document in Cosmos DB with Graph details
            await this.updateGraphDetailsInDB(internalMessageId, userId, graphDetails);
            
            return graphDetails;
          } else {
            console.warn(`⚠️ Message not found in Sent Items (attempt ${attempt}/${maxRetries}). The message may still be processing.`);
          }
        } catch (filterError: any) {
          // If header filter fails, try alternative: get latest messages and search
          console.warn(`⚠️ Header filter query failed (attempt ${attempt}):`, filterError?.message || filterError);
          
          if (attempt >= 3) {
            // On later attempts, try getting recent messages and checking headers manually
            try {
              console.log(`🔄 Trying alternative method: Fetching recent messages from Sent Items...`);
              const recentMessages = await this.client
                .api(`/users/${this.senderEmail}/mailFolders/SentItems/messages`)
                .orderby('sentDateTime desc')
                .top(10)
                .select('id,conversationId,internetMessageId,internetMessageHeaders')
                .get();

              if (recentMessages.value) {
                for (const msg of recentMessages.value) {
                  const headers = msg.internetMessageHeaders || [];
                  const customHeader = headers.find((h: any) => 
                    h.name === 'X-AgentMira-Message-Id' && h.value === internalMessageId
                  );
                  
                  if (customHeader) {
                    const graphDetails = {
                      messageId: msg.id,
                      conversationId: msg.conversationId,
                      internetMessageId: msg.internetMessageId
                    };
                    
                    console.log(`✅ Found message using alternative method:`, graphDetails);
                    await this.updateGraphDetailsInDB(internalMessageId, userId, graphDetails);
                    return graphDetails;
                  }
                }
              }
            } catch (altError: any) {
              console.warn(`⚠️ Alternative query method also failed:`, altError?.message || altError);
            }
          }
        }
      } catch (error: any) {
        console.warn(`⚠️ Error fetching Graph details (attempt ${attempt}/${maxRetries}):`, error?.message || error);
        if (attempt === maxRetries) {
          console.error(`❌ Failed to fetch Graph details after ${maxRetries} attempts for message ${internalMessageId}`);
          console.error(`ℹ️ This is normal if the message takes longer than ~30 seconds to appear in Sent Items.`);
          console.error(`ℹ️ The message was sent successfully, but Graph API IDs are not available yet.`);
          console.error(`ℹ️ Consider implementing a background job to retry fetching these details later.`);
        }
      }
    }
    
    console.warn(`⚠️ Returning empty Graph details. Message ${internalMessageId} may still be processing or query failed.`);
    return {};
  }

  /**
   * Update Graph API details in the tracking document
   */
  private async updateGraphDetailsInDB(
    messageId: string,
    userId: string,
    graphDetails: { messageId?: string; conversationId?: string; internetMessageId?: string }
  ): Promise<void> {
    try {
      const updates: any[] = [];
      
      if (graphDetails.messageId) {
        updates.push({ op: "set" as const, path: "/graph/messageId", value: graphDetails.messageId });
      }
      if (graphDetails.conversationId) {
        updates.push({ op: "set" as const, path: "/graph/conversationId", value: graphDetails.conversationId });
      }
      if (graphDetails.internetMessageId) {
        updates.push({ op: "set" as const, path: "/graph/internetMessageId", value: graphDetails.internetMessageId });
      }
      
      if (updates.length > 0) {
        updates.push({ op: "set" as const, path: "/updatedAt", value: new Date().toISOString() });
        await dbService.patchTrackingData(messageId, userId, updates);
        console.log(`✅ Updated Graph details in database for ${messageId}`);
      }
    } catch (error) {
      console.error(`⚠️ Failed to update Graph details in database:`, error);
    }
  }

  /**
   * Log email attempt to Cosmos DB with new structured format
   * Graph details are fetched and updated separately after sending
   */
  private async logEmailToCosmosDB(
    messageId: string,
    recipient: EmailRecipient,
    subject: string,
    status: 'SENT' | 'FAILED',
    errorMessage?: string,
    templateName?: string,
    bodyHtml?: string
  ): Promise<void> {
    try {
      const now = new Date().toISOString();

      const emailLog: EmailTracking = {
        id: messageId,
        user_id: recipient.user_id || recipient.email, // Partition key field (must match Cosmos DB partition key path /user_id)
        channel: "EMAIL",
        provider: "MICROSOFT_GRAPH",
        direction: "OUTBOUND",
        lifecycleStatus: status === "SENT" ? LifecycleStatus.SENT : LifecycleStatus.FAILED,
        recipient: {
          email: recipient.email,
          name: recipient.name,
        },
        email: {
          subject,
          bodyHtml: bodyHtml, // Store email body for AI insights
          templateId: templateName,
        },
        graph: {
          messageId: "", // Will be updated by fetchGraphMessageDetails
          conversationId: undefined,
          internetMessageId: undefined,
        },
        sent: {
          status: status as any,
          sentAt: now,
        },
        open: {
          openCount: 0,
          uniqueUserAgents: 0,
        },
        reply: {
          status: "NONE",
          isAutoReply: false,
        },
        forwarding: {
          suspected: false,
          confidence: "NONE",
        },
        createdAt: now,
        updatedAt: now,
      };

      await dbService.saveTrackingData(emailLog);
    } catch (error) {
      console.error(`⚠️ Failed to log email to Cosmos DB:`, error);
    }
  }


  /**
   * Send custom email with subject and HTML body
   */
  async sendCustomEmail(recipient: EmailRecipient, subject: string, htmlBody: string, providedMessageId?: string): Promise<boolean> {
    const messageId = providedMessageId || randomUUID();  // Use provided messageId or generate new one
    console.log(`📧 Sending custom email to ${recipient.email} [${messageId}]`);

    try {
      // Embed messageId in email body as HTML comment
      const bodyWithMessageId = `<!-- messageId: ${messageId} -->${htmlBody}`;
      
      // Automatically add tracking pixel to all emails
      const bodyWithTracking = this.addTrackingPixel(messageId, bodyWithMessageId);

      const message = {
        subject,
        body: {
          contentType: "HTML" as const,
          content: bodyWithTracking,
        },
        toRecipients: [
          {
            emailAddress: {
              address: recipient.email,
            },
          },
        ],
        internetMessageHeaders: [  // Add custom header with messageId
          {
            name: "X-AgentMira-Message-Id",
            value: messageId,
          },
        ],
        isDeliveryReceiptRequested: true,  // Request delivery confirmation
        isReadReceiptRequested: true,      // Request read confirmation
      };

      // Send email with saveToSentItems enabled
      await this.client.api(`/users/${this.senderEmail}/sendMail`).post({
        message,
        saveToSentItems: true  // Ensure email is saved to Sent Items
      });

      console.log(`✅ Custom email sent successfully to ${recipient.email} [${messageId}]`);

      // Log email to Cosmos DB first (Graph details might not be available immediately)
      await this.logEmailToCosmosDB(
        messageId, 
        recipient, 
        subject, 
        'SENT',
        undefined,
        undefined, // No template name for custom emails
        bodyWithTracking // Store body with tracking pixel
      );

      // Fetch Graph API message details from Sent Items and update the document
      // This runs asynchronously and updates the document when details are available
      this.fetchGraphMessageDetails(messageId, recipient.user_id || recipient.email).catch(err => {
        console.error(`Failed to fetch/update Graph details:`, err);
      });

      return true;
    } catch (error) {
      console.error(`❌ Error sending custom email to ${recipient.email}:`, error);

      // Log failed send to Cosmos DB
      await this.logEmailToCosmosDB(
        messageId,
        recipient,
        subject,
        'FAILED',
        error instanceof Error ? error.message : String(error)
      );

      throw error;
    }
  }

  /**
   * Send email - main method that accepts email content
   * Accepts both plain text and HTML. If plain text, converts to HTML format.
   * If no body is provided, uses a simple default template
   * Tracking pixel is automatically added to all emails
   */
  async sendEmail(
    email: string,
    user_id?: string,
    subject?: string,
    body?: string,
    name?: string
  ): Promise<boolean> {
    const recipient: EmailRecipient = {
      email,
      name: name || email.split('@')[0], // Use name or extract from email
      ...(user_id && { user_id })
    };

    // Use provided subject or default
    const emailSubject = subject || 'Message from Agent Mira';

    // Format body: convert plain text to HTML if needed, or use default
    let emailBody: string;
    if (!body) {
      emailBody = DEFAULT_EMAIL_BODY(recipient.name);
    } else if (isHTML(body)) {
      // Body is already HTML, use as is
      emailBody = body;
    } else {
      // Body is plain text, convert to HTML
      emailBody = formatPlainTextToHTML(body, recipient.name);
    }

    // Use sendCustomEmail - tracking pixel will be automatically added
    return this.sendCustomEmail(recipient, emailSubject, emailBody);
  }
}

// Export singleton instance
export const emailService = new EmailService();
export default emailService;
