import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import { CosmosClient, Container } from "@azure/cosmos";
import { randomUUID } from "crypto";
import "isomorphic-fetch";

// Email log model for Cosmos DB tracking
export interface EmailLog {
  id: string;                    // UUID messageId (document ID)
  user_id: string;               // Partition key - recipient email
  messageId: string;             // Same as id (for consistency)
  recipientEmail: string;
  recipientName: string;
  subject: string;
  status: 'SENT' | 'DELIVERED' | 'BOUNCED' | 'FAILED';
  sentAt: string;                // ISO timestamp
  sentAt_readable: string;       // Human-readable: "Dec 26, 2025 5:00 PM IST"
  errorMessage?: string;         // Only present if FAILED
  templateName?: string;         // Optional template identifier
  // Delivery tracking fields
  deliveredAt?: string;          // ISO timestamp when delivered
  deliveredAt_readable?: string; // Human-readable
  bouncedAt?: string;            // ISO timestamp when bounced
  bouncedAt_readable?: string;   // Human-readable
  bounceReason?: string;         // Reason for bounce (from NDR)
  // Open tracking fields
  openedAt?: string;             // ISO timestamp
  openedAt_readable?: string;    // Human-readable
  openCount?: number;
  // Reply tracking fields
  repliedAt?: string;            // ISO timestamp
  repliedAt_readable?: string;   // Human-readable
  replyCount?: number;
  lastReplyFrom?: string;        // Email address of last reply sender
}

// Email template interfaces (improved type safety)
export interface EmailTemplate {
  subject: string;
  body: (name: string, ...args: any[]) => string;  // Keep flexible for template compatibility
}

export interface EmailRecipient {
  email: string;
  name: string;
  user_id?: string;  // Optional: User ID from your portal (for partition key)
}

export interface EmailOptions {
  recipient: EmailRecipient;
  template: EmailTemplate;
  templateData?: unknown[];  // Replaced any with unknown[] for type safety
}

// Predefined templates
export const EMAIL_TEMPLATES = {
  MIAMI_WELCOME: {
    subject: "Welcome to Agent Mira – Let's Get You Home",
    body: (name: string) => `
      <div style="font-family: Arial, sans-serif; color: #222;">
        <p>Hello ${name},</p>
        <p>Thanks for joining the Agent Mira movement.</p>
        <p>We're here to guide you with smart tools, local expertise, and personalized support—all focused on helping you buy the right home at the right price.</p>
        <p>
          You can now <strong>schedule your buyer workshop</strong> at a time that works best for you.
          This session will give you tailored advice on what to buy, when to buy, and where to look.
        </p>
        <p style="text-align:center; margin: 24px 0;">
          <a href="https://calendly.com/akaul-agentmira" style="background: #0078d4; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 15px; display: inline-block;">
            Book Your Workshop on Calendly
          </a>
        </p>
        <p style="margin: 16px 0 4px 0;">We'll also be in touch with you soon to make sure you're getting the support you need.</p>
        <p style="margin: 0; font-size: 1em; color: #222;">
          <strong>Team Agent Mira</strong><br/>
          <span style="font-size: 0.95em; color: #555;">AI + Real Agents. On your side.</span>
        </p>
      </div>
    `
  },

  ROUS_WELCOME: {
    subject: "Welcome to Agent Mira – You're on the List",
    body: (name: string) => `
      <div style="font-family: Arial, sans-serif; color: #222;">
        <p>Hello ${name},</p>
        <p>We're thrilled to have you with us.</p>
        <p>
          Agent Mira is built to give home buyers the upper hand, with smarter tools and expert guidance.
          While we're currently focused on Miami, we'll keep you updated as we expand to other areas.
        </p>
        <p>
          Stay tuned for insights, tools, and updates designed just for buyers like you.
        </p>
        <p style="margin: 0; font-size: 1em; color: #222;">
          <strong>Team Agent Mira</strong><br/>
          <span style="font-size: 0.95em; color: #555;">AI + Real Agents. Always on your side.</span>
        </p>
      </div>
    `
  },

  AGENT_CONVERSION: {
    subject: "Welcome to Agent Mira Portal – Your Realtor Account is Ready",
    body: (name: string, tempPassword: string) => `
      <div style="font-family: Arial, sans-serif; color: #222;">
        <p>Hello ${name},</p>
        <p>Congratulations! Your Agent Mira Realtor Portal account has been activated.</p>
        <p>
          You can now access your personalized dashboard with tools and resources designed specifically for real estate professionals.
        </p>
        <div style="background: #f8f9fa; padding: 16px; border-radius: 6px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0; font-weight: bold;">Your Login Credentials:</p>
          <p style="margin: 0 0 4px 0;"><strong>Email:</strong> Your registered email address</p>
          <p style="margin: 0;"><strong>Temporary Password:</strong> <code style="background: #e9ecef; padding: 2px 4px; border-radius: 3px;">${tempPassword}</code></p>
        </div>
        <p style="margin: 16px 0 4px 0;">
          <strong>Important:</strong> Please change your password on first login for security.
        </p>
        <p style="text-align:center; margin: 24px 0;">
          <a href="https://realtor.agentmira.ai" style="background: #0078d4; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 15px; display: inline-block;">
            Access Your Realtor Portal
          </a>
        </p>
        <p style="margin: 0; font-size: 1em; color: #222;">
          <strong>Team Agent Mira</strong><br/>
          <span style="font-size: 0.95em; color: #555;">AI + Real Agents. On your side.</span>
        </p>
      </div>
    `
  }
};

class EmailService {
  private client: Client;
  private senderEmail: string;
  private cosmosContainer: Container;  // Cosmos DB container for email logging

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

    if (!COSMOS_URI || !COSMOS_KEY || !COSMOS_DATABASE_REALTOR_MANAGEMENT || !COSMOS_CONTAINER_EMAIL) {
      throw new Error('Missing required Cosmos DB environment variables');
    }

    this.senderEmail = SENDER_EMAIL;

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

    // Initialize Cosmos DB client and container
    const cosmosClient = new CosmosClient({ endpoint: COSMOS_URI, key: COSMOS_KEY });
    this.cosmosContainer = cosmosClient
      .database(COSMOS_DATABASE_REALTOR_MANAGEMENT)
      .container(COSMOS_CONTAINER_EMAIL);
  }

  /**
   * Format timestamp to human-readable format
   */
  private formatReadableTimestamp(isoTimestamp: string): string {
    const date = new Date(isoTimestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
      timeZoneName: 'short'
    });
  }

  /**
   * Log email attempt to Cosmos DB
   */
  private async logEmailToCosmosDB(
    messageId: string,
    recipient: EmailRecipient,
    subject: string,
    status: 'SENT' | 'FAILED',
    errorMessage?: string,
    templateName?: string
  ): Promise<void> {
    try {
      const now = new Date().toISOString();

      const emailLog: EmailLog = {
        id: messageId,
        user_id: recipient.user_id || recipient.email,  // Use portal user_id if provided, else email
        messageId,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        subject,
        status,
        sentAt: now,
        sentAt_readable: this.formatReadableTimestamp(now),
        ...(errorMessage && { errorMessage }),
        ...(templateName && { templateName }),
      };

      await this.cosmosContainer.items.create(emailLog);
      console.log(`📝 Email log saved to Cosmos DB: ${messageId} - ${status}`);
    } catch (error) {
      // Log error but don't throw - email logging failure shouldn't break email sending
      console.error(`⚠️ Failed to log email to Cosmos DB:`, error);
    }
  }

  /**
   * Send email using a predefined template
   */
  async sendTemplateEmail(options: EmailOptions): Promise<boolean> {
    const messageId = randomUUID();  // Generate UUID for message tracking

    try {
      const { recipient, template, templateData } = options;

      // Build email body with embedded messageId as HTML comment
      const emailBody = template.body(recipient.name, ...(templateData || []));
      const bodyWithMessageId = `<!-- messageId: ${messageId} -->${emailBody}`;

      const message = {
        subject: template.subject,
        body: {
          contentType: "HTML" as const,
          content: bodyWithMessageId,
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

      console.log(`✅ Email sent successfully to ${recipient.email} [${messageId}]`);

      // Log successful send to Cosmos DB
      await this.logEmailToCosmosDB(messageId, recipient, template.subject, 'SENT');

      return true;
    } catch (error) {
      console.error(`❌ Error sending email to ${options.recipient.email}:`, error);

      // Log failed send to Cosmos DB
      await this.logEmailToCosmosDB(
        messageId,
        options.recipient,
        options.template.subject,
        'FAILED',
        error instanceof Error ? error.message : String(error)
      );

      throw error;
    }
  }

  /**
   * Send custom email with subject and HTML body
   */
  async sendCustomEmail(recipient: EmailRecipient, subject: string, htmlBody: string, providedMessageId?: string): Promise<boolean> {
    const messageId = providedMessageId || randomUUID();  // Use provided messageId or generate new one

    try {
      // Embed messageId in email body as HTML comment
      const bodyWithMessageId = `<!-- messageId: ${messageId} -->${htmlBody}`;

      const message = {
        subject,
        body: {
          contentType: "HTML" as const,
          content: bodyWithMessageId,
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

      // Log successful send to Cosmos DB
      await this.logEmailToCosmosDB(messageId, recipient, subject, 'SENT');

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
   * Send region-based welcome email (Miami or Rest of US)
   */
  async sendRegionEmail(recipient: EmailRecipient, region: 'Miami' | 'ROUS'): Promise<boolean> {
    const template = region === 'Miami' ? EMAIL_TEMPLATES.MIAMI_WELCOME : EMAIL_TEMPLATES.ROUS_WELCOME;

    return this.sendTemplateEmail({
      recipient,
      template
    });
  }

  /**
   * Send agent conversion email with temporary password
   */
  async sendAgentConversionEmail(recipient: EmailRecipient, tempPassword: string): Promise<boolean> {
    return this.sendTemplateEmail({
      recipient,
      template: EMAIL_TEMPLATES.AGENT_CONVERSION,
      templateData: [tempPassword]
    });
  }

  /**
   * Test email service with a simple message (includes tracking pixel)
   */
  async sendTestEmail(testEmail: string, user_id?: string): Promise<boolean> {
    const testRecipient: EmailRecipient = {
      email: testEmail,
      name: 'Test User',
      ...(user_id && { user_id })  // Include user_id if provided
    };

    const testSubject = 'Agent Mira Email Service Test';

    // Generate messageId first so we can include it in the tracking pixel
    const messageId = randomUUID();

    // Use environment variable for tracking service URL (for deployment)
    const trackingUrl = process.env.TRACKING_SERVICE_URL || 'http://localhost:3001';

    const testBody = `
      <div style="font-family: Arial, sans-serif; color: #222;">
        <h2>Email Service Test</h2>
        <p>This is a test email from the Agent Mira Email Service.</p>
        <p>If you receive this email, the service is working correctly!</p>
        <p><strong>Message ID:</strong> <code>${messageId}</code></p>
        <p style="margin: 0; font-size: 1em; color: #222;">
          <strong>Team Agent Mira</strong><br/>
          <span style="font-size: 0.95em; color: #555;">AI + Real Agents. On your side.</span>
        </p>
      </div>
      <img src="${trackingUrl}/open/${messageId}.png" width="1" height="1" style="display:none" alt="" />
    `;

    // Use sendCustomEmail but pass the messageId we generated for the tracking pixel
    return this.sendCustomEmail(testRecipient, testSubject, testBody, messageId);
  }
}

// Export singleton instance
export const emailService = new EmailService();
export default emailService;
