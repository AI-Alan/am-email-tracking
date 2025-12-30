import OpenAI from "openai";
import { dbService } from "./dbService";
import { EmailTracking } from "../types/emailTracking";
import {
    TrackingSummary,
    EmailInsight,
    EmailInsightSummary,
    LatestEmailInsight,
    EmailHistoryItem,
    OverallBuyerProfile
} from "../types/trackingSummary";

const SYSTEM_PROMPT = `You are an AI assistant that analyzes email tracking records for a real estate buyer engagement system.

You will be given a raw email document exactly as stored in the database.
This document may include sent data, open tracking, reply data, and forwarding indicators.

Your task:
- Derive buyer engagement, intent, urgency, and sentiment
- Recommend the next best action for the agent
- Be conservative and factual
- Do NOT assume information that is missing
- Use timestamps and counts to infer engagement
- Follow the output JSON schema strictly
- Return VALID JSON only, no explanations`;

const USER_PROMPT_TEMPLATE = `Analyze the following email tracking document and generate structured insights.

Context:
- This is an outbound email sent by an agent to a property buyer.
- The document below is the raw database record.
- Some fields may be missing or null.
- If reply data is missing, do not assume intent.
- Do NOT use open tracking counts (openCount) - they are unreliable and can be blocked.
- Only use reply status, reply content, and timestamps for engagement analysis.
- If reply content shows interest or questions, intent is INTERESTED.
- If reply is negative or declining, intent is NOT_INTERESTED.
- If no strong signals exist, set intent to UNKNOWN.
- Confidence score (0.0-1.0) must reflect data completeness and clarity:
  * 0.9-1.0: Very high confidence (clear reply content with strong signals)
  * 0.7-0.8: High confidence (reply exists with moderate signals)
  * 0.5-0.6: Moderate confidence (reply exists but signals are weak)
  * 0.3-0.4: Low confidence (limited or ambiguous data)
  * 0.0-0.2: Very low confidence (minimal or no data available)

RAW EMAIL DOCUMENT:
{{email_document_json}}

Return the response in the following JSON format ONLY:

{
  "email_insight": {
    "engagement_level": "",
    "buyer_intent": "",
    "urgency_level": "",
    "sentiment": "",
    "key_signals": [],
    "topics_detected": [],
    "objections": [],
    "next_best_action": "",
    "follow_up_priority": "",
    "confidence_score": 0.0
  }
}`;

class EmailInsightService {
    private client: OpenAI | null = null;
    private deployment: string;
    private apiVersion: string = "2024-02-15-preview";

    constructor() {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
        const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
        const apiVersionEnv = process.env.AZURE_OPENAI_API_VERSION?.trim();
        this.deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim() || "gpt-35-turbo";
        
        // Use environment API version if provided, otherwise use default
        if (apiVersionEnv) {
            this.apiVersion = apiVersionEnv;
        }

        console.log(`🔧 Initializing Azure OpenAI configuration...`);
        console.log(`   AZURE_OPENAI_ENDPOINT: ${endpoint ? `SET (${endpoint.substring(0, 30)}...)` : 'NOT SET'}`);
        console.log(`   AZURE_OPENAI_API_KEY: ${apiKey ? `SET (length: ${apiKey.length})` : 'NOT SET'}`);
        console.log(`   AZURE_OPENAI_DEPLOYMENT: ${this.deployment}`);
        console.log(`   AZURE_OPENAI_API_VERSION: ${this.apiVersion}`);

        // Validate Azure OpenAI configuration with detailed logging
        const missingVars: string[] = [];
        if (!endpoint || endpoint === "") {
            missingVars.push("AZURE_OPENAI_ENDPOINT");
        }
        if (!apiKey || apiKey === "") {
            missingVars.push("AZURE_OPENAI_API_KEY");
        }

        if (missingVars.length > 0) {
            console.warn("⚠️ Azure OpenAI not configured. Missing required environment variables:");
            missingVars.forEach(v => console.warn(`   - ${v} is missing or empty`));
            console.warn("   Email insights will use default rule-based values.");
            console.warn(`   Action: Add these variables to Render Dashboard → Environment → Environment Variables`);
            this.client = null;
            return;
        }

        // Check for placeholder values
        const placeholderValues = [
            "<REPLACE_WITH_YOUR_KEY_VALUE_HERE>",
            "your-api-key-here",
            "YOUR_API_KEY",
            "placeholder",
            "changeme"
        ];
        
        if (placeholderValues.some(placeholder => apiKey!.toLowerCase().includes(placeholder.toLowerCase()))) {
            console.warn("⚠️ Azure OpenAI API key appears to be a placeholder value. Email insights will use default values.");
            this.client = null;
            return;
        }

        // Clean endpoint (remove trailing slash if present)
        const cleanEndpoint = endpoint!.endsWith('/') ? endpoint!.slice(0, -1) : endpoint!;

        try {
            // Configure OpenAI client for Azure OpenAI
            // Azure OpenAI requires baseURL with deployment and api-version query param
            // Note: For Azure OpenAI, we use the deployment name in the baseURL path
            const baseURL = `${cleanEndpoint}/openai/deployments/${this.deployment}`;
            
            this.client = new OpenAI({
                apiKey: apiKey!,
                baseURL: baseURL,
                defaultQuery: { 'api-version': this.apiVersion },
                defaultHeaders: { 'api-key': apiKey! },
            });
            
            console.log(`✅ Azure OpenAI client initialized successfully`);
            console.log(`   Base URL: ${baseURL}`);
            console.log(`   Deployment: ${this.deployment}`);
            console.log(`   API Version: ${this.apiVersion}`);
            
            // Test the connection by making a simple request (optional - can be removed if too slow)
            // We'll let the first actual request fail gracefully if there's a connection issue
        } catch (error: any) {
            console.error(`❌ Failed to initialize Azure OpenAI client:`, error?.message || error);
            console.error(`   Error details:`, error);
            console.warn("   Email insights will use default rule-based values.");
            this.client = null;
        }
    }

    /**
     * Check if AI insights are enabled
     */
    public isAIEnabled(): boolean {
        return this.client !== null;
    }

    /**
     * Generate insights for a single email using OpenAI
     */
    private async analyzeEmailWithAI(emailDoc: EmailTracking): Promise<LatestEmailInsight> {
        if (!this.client) {
            // Return default insights if OpenAI is not configured
            console.log(`📊 Using DEFAULT insights for email ${emailDoc.id} (AI not configured)`);
            console.log(`   To enable AI insights, set these environment variables in Render Dashboard:`);
            console.log(`   - AZURE_OPENAI_ENDPOINT`);
            console.log(`   - AZURE_OPENAI_API_KEY`);
            console.log(`   - AZURE_OPENAI_DEPLOYMENT (optional, default: gpt-35-turbo)`);
            console.log(`   - AZURE_OPENAI_API_VERSION (optional, default: 2024-02-15-preview)`);
            // Default insights: Only use reply status, NOT open count (unreliable)
            // Confidence 0.5 = moderate confidence since we're using simple rules
            return {
                engagement_level: emailDoc.reply.status === "REPLIED" ? "MEDIUM" : "LOW",
                buyer_intent: emailDoc.reply.status === "REPLIED" ? "INTERESTED" : "UNKNOWN",
                urgency_level: "LOW",
                sentiment: "NEUTRAL",
                next_best_action: "FOLLOW_UP_EMAIL",
                confidence_score: 0.5 // Fixed: moderate confidence for default rule-based insights
            };
        }

        try {
            console.log(`🤖 Using AI INSIGHTS for email ${emailDoc.id} (Azure OpenAI)`);
            
            const emailJson = JSON.stringify(emailDoc, null, 2);
            // Replace the placeholder with actual email document JSON
            const userPrompt = USER_PROMPT_TEMPLATE.replace("{{email_document_json}}", emailJson);
            
            // Debug: Log if replacement worked (remove in production)
            if (userPrompt.includes("{{email_document_json}}")) {
                console.error(`⚠️ ERROR: Prompt placeholder not replaced for email ${emailDoc.id}`);
            }

            const requestOptions: any = {
                model: this.deployment,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 1000
            };

            // Try to use json_object format if supported
            try {
                requestOptions.response_format = { type: "json_object" };
            } catch {
                // If not supported, continue without it
            }

            // For Azure OpenAI, the model should be the deployment name (already set in baseURL)
            // But we still need to specify it in the request
            const response = await this.client.chat.completions.create({
                ...requestOptions,
                model: this.deployment
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error("Empty response from OpenAI");
            }

            // Extract JSON from response (may have markdown code blocks)
            let jsonContent = content.trim();
            const jsonMatch = jsonContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
            if (jsonMatch) {
                jsonContent = jsonMatch[1];
            }

            const parsed = JSON.parse(jsonContent);
            const insight = parsed.email_insight as LatestEmailInsight;
            
            // Validate required fields
            if (!insight.engagement_level || !insight.buyer_intent || !insight.sentiment) {
                throw new Error("AI response missing required fields");
            }
            
            console.log(`✅ AI insights generated successfully for email ${emailDoc.id}`);
            console.log(`   Engagement: ${insight.engagement_level}, Intent: ${insight.buyer_intent}, Sentiment: ${insight.sentiment}, Confidence: ${insight.confidence_score}`);
            
            return insight;
        } catch (error: any) {
            console.error(`⚠️ Error analyzing email ${emailDoc.id} with AI:`, error?.message || error);
            if (error?.response?.status) {
                console.error(`   HTTP Status: ${error.response.status}`);
                console.error(`   Error Code: ${error.code || 'N/A'}`);
            }
            if (error?.message?.includes('401') || error?.message?.includes('authentication')) {
                console.error(`   💡 Authentication error - check AZURE_OPENAI_API_KEY`);
            }
            if (error?.message?.includes('404') || error?.message?.includes('not found')) {
                console.error(`   💡 Resource not found - check AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT`);
            }
            console.log(`📊 Falling back to DEFAULT insights for email ${emailDoc.id} due to AI error`);
            // Return default insights on error: Only use reply status, NOT open count (unreliable)
            // Confidence 0.3 = low confidence since AI failed and we're using simple rules
            return {
                engagement_level: emailDoc.reply.status === "REPLIED" ? "MEDIUM" : "LOW",
                buyer_intent: emailDoc.reply.status === "REPLIED" ? "INTERESTED" : "UNKNOWN",
                urgency_level: "LOW",
                sentiment: "NEUTRAL",
                next_best_action: "FOLLOW_UP_EMAIL",
                confidence_score: 0.3 // Fixed: low confidence when AI fails and we fall back to rules
            };
        }
    }

    /**
     * Calculate summary statistics from email tracking data
     * NOTE: We do NOT use openCount for insights as it's unreliable (tracking pixels can be blocked).
     * Only reply status and timestamps are used for engagement calculations.
     */
    private calculateSummary(emails: EmailTracking[]): EmailInsightSummary {
        const totalSent = emails.length;
        // Count emails with open tracking (for display only, NOT used in engagement calculations)
        const emailsOpened = emails.filter(e => e.open.openCount > 0).length;
        const emailsReplied = emails.filter(e => e.reply.status === "REPLIED").length;

        // Calculate average reply time in seconds
        let totalReplyTime = 0;
        let replyCount = 0;
        emails.forEach(email => {
            if (email.reply.status === "REPLIED" && email.reply.repliedAt && email.sent.sentAt) {
                const sentTime = new Date(email.sent.sentAt).getTime();
                const repliedTime = new Date(email.reply.repliedAt).getTime();
                totalReplyTime += (repliedTime - sentTime) / 1000; // Convert to seconds
                replyCount++;
            }
        });
        const avgReplyTime = replyCount > 0 ? Math.round(totalReplyTime / replyCount) : 0;

        // Calculate engagement score (0-100) - ONLY based on reply rate (no open tracking)
        // Open tracking is unreliable (blocked by email clients, privacy tools, etc.)
        const replyRate = totalSent > 0 ? (emailsReplied / totalSent) * 100 : 0;
        const engagementScore = Math.round(replyRate); // 0-100, based solely on replies

        return {
            total_emails_sent: totalSent,
            emails_opened: emailsOpened, // For display/reference only, NOT used in engagement_score
            emails_replied: emailsReplied,
            avg_reply_time_seconds: avgReplyTime,
            engagement_score: engagementScore // Based ONLY on reply rate (0-100)
        };
    }

    /**
     * Build email history from tracking data
     */
    private buildEmailHistory(emails: EmailTracking[], latestInsight: LatestEmailInsight): EmailHistoryItem[] {
        return emails.map(email => {
            // Use AI insight if available for latest email, otherwise infer from data
            const isLatest = email.id === emails[0]?.id;
            return {
                message_id: email.id, // Internal message ID (UUID) - same as EmailTracking.id
                sentAt: email.sent.sentAt,
                insight: {
                    buyer_intent: isLatest ? latestInsight.buyer_intent : (email.reply.status === "REPLIED" ? "INTERESTED" : "UNKNOWN"),
                    sentiment: isLatest ? latestInsight.sentiment : (email.reply.status === "REPLIED" ? "POSITIVE" : "NEUTRAL")
                }
            };
        });
    }

    /**
     * Determine overall buyer profile
     */
    private calculateOverallProfile(
        summary: EmailInsightSummary,
        latestInsight: LatestEmailInsight
    ): OverallBuyerProfile {
        let engagementLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";
        if (summary.engagement_score >= 70) engagementLevel = "HIGH";
        else if (summary.engagement_score >= 40) engagementLevel = "MEDIUM";

        let decisionStage: "AWARENESS" | "CONSIDERATION" | "DECISION" | "PURCHASE" = "AWARENESS";
        if (latestInsight.buyer_intent === "INTERESTED") {
            decisionStage = summary.emails_replied >= 2 ? "DECISION" : "CONSIDERATION";
        }

        return {
            engagement_level: engagementLevel,
            preferred_channel: "EMAIL", // Default, can be enhanced with other channel data
            decision_stage: decisionStage
        };
    }

    /**
     * Generate email insight and append/update it in tracking summary for a user_id
     * Only updates email_insight, preserves other insights (call_insight, whatsapp_insight, overall_buyer_profile)
     */
    async generateTrackingSummary(userId: string): Promise<TrackingSummary> {
        console.log(`📊 Generating email insight for user_id: ${userId}`);

        // Fetch emails for this user with conversation thread grouping
        // preferGraphData=true ensures we analyze emails with complete Graph API metadata
        const emails = await dbService.getEmailsByBuyerId(userId, 10, true);
        if (emails.length === 0) {
            throw new Error(`No emails found for user_id: ${userId}`);
        }

        console.log(`📊 Processing ${emails.length} emails for user_id: ${userId} (already grouped by conversation threads)`);

        // Calculate summary statistics from all fetched emails
        // These are already optimized: one email per conversation thread + standalone emails
        const summary = this.calculateSummary(emails);

        // Get latest email (first in array since sorted DESC by sentAt)
        // This is the most recent email from the most recent conversation thread
        const latestEmail = emails[0];
        const hasGraphData = latestEmail.graph?.messageId && latestEmail.graph.messageId !== '';
        console.log(`📧 Latest email ID: ${latestEmail.id}, sentAt: ${latestEmail.sent.sentAt}, hasGraphData: ${hasGraphData}`);
        if (latestEmail.graph?.conversationId) {
            console.log(`   Conversation thread: ${latestEmail.graph.conversationId}`);
        }
        
        // Log insight source at the start
        if (this.client) {
            console.log(`🤖 AI-powered insights enabled - analyzing with Azure OpenAI`);
        } else {
            console.log(`📊 AI insights disabled - using default rule-based insights`);
        }
        
        // Analyze latest email with AI (or default)
        const latestEmailInsight = await this.analyzeEmailWithAI(latestEmail);

        // Build email history (limit to last 50 for history to avoid large payloads)
        const historyEmails = emails.slice(0, 50); // Most recent 50 emails
        const history = this.buildEmailHistory(historyEmails, latestEmailInsight);

        // Build email insight object
        const emailInsight: EmailInsight = {
            summary,
            latest_email_insight: latestEmailInsight,
            history
        };

        // Get existing summary to preserve other insights
        const existingSummary = await dbService.getTrackingSummary(userId);

        // Build tracking summary: only update email_insight, preserve everything else
        // Use user_id as document id for consistent upsert (one document per user)
        const trackingSummary: TrackingSummary = {
            id: userId, // Use user_id as document id for upsert to work correctly
            user_id: userId, // Changed from buyer_id for consistency
            email_insight: emailInsight, // Only field we update
            call_insight: existingSummary?.call_insight, // Preserve if exists
            whatsapp_insight: existingSummary?.whatsapp_insight, // Preserve if exists
            overall_buyer_profile: existingSummary?.overall_buyer_profile || { // Preserve if exists, or use default
                engagement_level: "LOW",
                preferred_channel: "EMAIL",
                decision_stage: "AWARENESS"
            },
            createdAt: existingSummary?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save to database
        await dbService.saveTrackingSummary(trackingSummary);

        // Log summary of insight type used
        const insightType = this.client ? "AI-powered" : "default rule-based";
        console.log(`✅ Email insight updated for user_id: ${userId}`);
        console.log(`📊 Insight Summary: ${insightType} insights | Engagement: ${latestEmailInsight.engagement_level} | Intent: ${latestEmailInsight.buyer_intent} | Confidence: ${latestEmailInsight.confidence_score}`);
        
        return trackingSummary;
    }
}

export const emailInsightService = new EmailInsightService();
export default emailInsightService;

