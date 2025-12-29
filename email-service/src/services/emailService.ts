import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import { randomUUID } from "crypto";
import "isomorphic-fetch";
import { dbService } from "./dbService";
import { EmailTracking, LifecycleStatus } from "../types/tracking";

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
   */
  private async fetchGraphMessageDetails(internalMessageId: string): Promise<{
    messageId?: string;
    conversationId?: string;
    internetMessageId?: string;
  }> {
    try {
      // Wait a bit for the message to appear in Sent Items
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Query Sent Items for the message with our custom header
      const result = await this.client
        .api(`/users/${this.senderEmail}/mailFolders/SentItems/messages`)
        .filter(`internetMessageHeaders/any(x:x/name eq 'X-AgentMira-Message-Id' and x/value eq '${internalMessageId}')`)
        .orderby('sentDateTime desc')
        .top(1)
        .select('id,conversationId,internetMessageId')
        .get();

      if (result.value && result.value.length > 0) {
        const message = result.value[0];
        console.log(`📋 Retrieved Graph API details for ${internalMessageId}`);
        return {
          messageId: message.id,
          conversationId: message.conversationId,
          internetMessageId: message.internetMessageId
        };
      }
    } catch (error) {
      console.warn(`⚠️ Could not fetch Graph message details for ${internalMessageId}:`, error);
    }
    return {};
  }

  /**
   * Log email attempt to Cosmos DB with new structured format
   */
  private async logEmailToCosmosDB(
    messageId: string,
    recipient: EmailRecipient,
    subject: string,
    status: 'SENT' | 'FAILED',
    errorMessage?: string,
    templateName?: string,
    bodyHtml?: string,
    graphDetails?: { messageId?: string; conversationId?: string; internetMessageId?: string }
  ): Promise<void> {
    try {
      const now = new Date().toISOString();

      const emailLog: EmailTracking = {
        id: messageId,
        userId: recipient.user_id || recipient.email,
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
          messageId: graphDetails?.messageId || "",
          conversationId: graphDetails?.conversationId,
          internetMessageId: graphDetails?.internetMessageId,
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

      // Fetch Graph API message details from Sent Items
      const graphDetails = await this.fetchGraphMessageDetails(messageId);

      // Log successful send to Cosmos DB with Graph details and body
      await this.logEmailToCosmosDB(
        messageId, 
        recipient, 
        subject, 
        'SENT',
        undefined,
        undefined, // No template name for custom emails
        bodyWithTracking, // Store body with tracking pixel
        graphDetails
      );

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
