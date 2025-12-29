import OpenAI from "openai";
import { dbService } from "./dbService";
import { EmailTracking } from "../types/tracking";
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
- If open data is missing, engagement must be LOW.
- If reply content shows interest or questions, intent is INTERESTED.
- If reply is negative or declining, intent is NOT_INTERESTED.
- If no strong signals exist, set intent to UNKNOWN.
- Confidence score must reflect data completeness and clarity.

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
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const apiKey = process.env.AZURE_OPENAI_API_KEY;
        const apiVersionEnv = process.env.AZURE_OPENAI_API_VERSION;
        this.deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-35-turbo";
        
        // Use environment API version if provided, otherwise use default
        if (apiVersionEnv) {
            this.apiVersion = apiVersionEnv;
        }

        // Validate Azure OpenAI configuration
        if (!endpoint || !apiKey) {
            console.warn("⚠️ Azure OpenAI not configured. Missing required environment variables:");
            if (!endpoint) console.warn("   - AZURE_OPENAI_ENDPOINT is missing");
            if (!apiKey) console.warn("   - AZURE_OPENAI_API_KEY is missing");
            console.warn("   Email insights will use default values.");
            return;
        }

        // Check for placeholder values
        if (apiKey === "<REPLACE_WITH_YOUR_KEY_VALUE_HERE>" || apiKey.trim() === "") {
            console.warn("⚠️ Azure OpenAI API key is not set properly. Email insights will use default values.");
            return;
        }

        // Clean endpoint (remove trailing slash if present)
        const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;

        try {
            // Configure OpenAI client for Azure OpenAI
            // Azure OpenAI requires baseURL with deployment and api-version query param
            this.client = new OpenAI({
                apiKey: apiKey,
                baseURL: `${cleanEndpoint}/openai/deployments/${this.deployment}`,
                defaultQuery: { 'api-version': this.apiVersion },
                defaultHeaders: { 'api-key': apiKey },
            });
            
            console.log(`✅ Azure OpenAI configured successfully`);
            console.log(`   Endpoint: ${cleanEndpoint}`);
            console.log(`   Deployment: ${this.deployment}`);
            console.log(`   API Version: ${this.apiVersion}`);
        } catch (error) {
            console.error(`❌ Failed to initialize Azure OpenAI client:`, error);
            console.warn("   Email insights will use default values.");
            this.client = null;
        }
    }

    /**
     * Generate insights for a single email using OpenAI
     */
    private async analyzeEmailWithAI(emailDoc: EmailTracking): Promise<LatestEmailInsight> {
        if (!this.client) {
            // Return default insights if OpenAI is not configured
            console.log(`📊 Using DEFAULT insights for email ${emailDoc.id} (AI not configured)`);
            return {
                engagement_level: emailDoc.open.openCount > 0 ? "MEDIUM" : "LOW",
                buyer_intent: emailDoc.reply.status === "REPLIED" ? "INTERESTED" : "UNKNOWN",
                urgency_level: "LOW",
                sentiment: "NEUTRAL",
                next_best_action: "FOLLOW_UP_EMAIL",
                confidence_score: 0.5
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
            
            console.log(`✅ AI insights generated successfully for email ${emailDoc.id}`);
            console.log(`   Engagement: ${insight.engagement_level}, Intent: ${insight.buyer_intent}, Sentiment: ${insight.sentiment}`);
            
            return insight;
        } catch (error) {
            console.error(`⚠️ Error analyzing email ${emailDoc.id} with AI:`, error);
            console.log(`📊 Falling back to DEFAULT insights for email ${emailDoc.id} due to AI error`);
            // Return default insights on error
            return {
                engagement_level: emailDoc.open.openCount > 0 ? "MEDIUM" : "LOW",
                buyer_intent: emailDoc.reply.status === "REPLIED" ? "INTERESTED" : "UNKNOWN",
                urgency_level: "LOW",
                sentiment: "NEUTRAL",
                next_best_action: "FOLLOW_UP_EMAIL",
                confidence_score: 0.3
            };
        }
    }

    /**
     * Calculate summary statistics from email tracking data
     */
    private calculateSummary(emails: EmailTracking[]): EmailInsightSummary {
        const totalSent = emails.length;
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

        // Calculate engagement score (0-100)
        const openRate = totalSent > 0 ? (emailsOpened / totalSent) * 40 : 0; // 40% weight
        const replyRate = totalSent > 0 ? (emailsReplied / totalSent) * 60 : 0; // 60% weight
        const engagementScore = Math.round(openRate + replyRate);

        return {
            total_emails_sent: totalSent,
            emails_opened: emailsOpened,
            emails_replied: emailsReplied,
            avg_reply_time_seconds: avgReplyTime,
            engagement_score: engagementScore
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
                email_id: email.id,
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
     * Generate email insight and append/update it in tracking summary for a buyer_id
     * Only updates email_insight, preserves other insights (call_insight, whatsapp_insight, overall_buyer_profile)
     */
    async generateTrackingSummary(buyerId: string): Promise<TrackingSummary> {
        console.log(`📊 Generating email insight for buyer_id: ${buyerId}`);

        // Fetch emails for this buyer (limited to last 100 for performance)
        const emails = await dbService.getEmailsByBuyerId(buyerId, 10);
        if (emails.length === 0) {
            throw new Error(`No emails found for buyer_id: ${buyerId}`);
        }

        console.log(`📊 Processing ${emails.length} emails for buyer_id: ${buyerId}`);

        // Calculate summary statistics from all fetched emails
        const summary = this.calculateSummary(emails);

        // Get latest email (first in array since sorted DESC by sentAt)
        // This is the most recent email based on sentAt timestamp
        const latestEmail = emails[0];
        console.log(`📧 Latest email ID: ${latestEmail.id}, sentAt: ${latestEmail.sent.sentAt}`);
        
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
        const existingSummary = await dbService.getTrackingSummary(buyerId);

        // Build tracking summary: only update email_insight, preserve everything else
        const trackingSummary: TrackingSummary = {
            buyer_id: buyerId,
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
        console.log(`✅ Email insight updated for buyer_id: ${buyerId}`);
        console.log(`📊 Insight Summary: ${insightType} insights | Engagement: ${latestEmailInsight.engagement_level} | Intent: ${latestEmailInsight.buyer_intent} | Confidence: ${latestEmailInsight.confidence_score}`);
        
        return trackingSummary;
    }
}

export const emailInsightService = new EmailInsightService();
export default emailInsightService;

