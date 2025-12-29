# Email Insight Calculation Breakdown

## 📊 What's Calculated vs. From LLM

### ✅ **Calculated by Code (Not from LLM)**

These are computed from tracking data in the database:

1. **Summary Statistics** (`EmailInsightSummary`)
   - `total_emails_sent` - Count of all emails
   - `emails_opened` - Count of emails with openCount > 0
   - `emails_replied` - Count of emails with reply.status === "REPLIED"
   - `avg_reply_time_seconds` - Average time between sent and replied
   - `engagement_score` - Calculated formula: (openRate * 40%) + (replyRate * 60%)

2. **Email History** (`EmailHistoryItem[]`)
   - Basic intent/sentiment inference from reply status
   - For latest email: Uses LLM insight if available
   - For older emails: Simple inference (REPLIED = INTERESTED/POSITIVE)

3. **Overall Buyer Profile** (`OverallBuyerProfile`)
   - `engagement_level` - Based on engagement_score thresholds
   - `decision_stage` - Based on buyer_intent and reply count
   - `preferred_channel` - Hardcoded to "EMAIL" (default)

### 🤖 **From LLM (OpenAI)**

These come from AI analysis of the latest email document:

1. **Latest Email Insight** (`LatestEmailInsight`)
   - `engagement_level` - AI analyzes engagement patterns
   - `buyer_intent` - INTERESTED / NOT_INTERESTED / UNKNOWN
   - `urgency_level` - LOW / MEDIUM / HIGH
   - `sentiment` - POSITIVE / NEUTRAL / NEGATIVE
   - `key_signals` - Array of important signals detected
   - `topics_detected` - Array of topics mentioned
   - `objections` - Array of objections raised
   - `next_best_action` - Recommended action (e.g., "CALL_BUYER")
   - `follow_up_priority` - Priority level for follow-up
   - `confidence_score` - AI's confidence in analysis (0.0 - 1.0)

## 📝 LLM Prompt Flow

1. **Input to LLM**: 
   - Full `EmailTracking` document (JSON stringified)
   - Includes: email body, open data, reply data, timestamps, etc.

2. **Prompt Structure**:
   - System Prompt: Instructions on how to analyze
   - User Prompt: Contains the email document JSON at `{{email_document_json}}`

3. **Replacement Check**:
   - Code checks if placeholder was replaced correctly
   - If `{{email_document_json}}` still exists after replacement, logs error

4. **LLM Response**:
   - Expected JSON format with `email_insight` object
   - Extracts JSON even if wrapped in markdown code blocks

## 🔧 Fixed Issues

### 1. Tracking Service Updated ✅
- Now uses new structure: `open.openCount`, `open.firstOpenedAt`, `open.lastOpenedAt`
- Updates `lifecycleStatus` to `OPENED` when email is first opened
- Properly updates all open tracking fields

### 2. Prompt Verification ✅
- Added debug check to ensure `{{email_document_json}}` is replaced
- Logs error if replacement fails

### 3. Tracking Pixel ✅
- Automatically added to ALL emails via `addTrackingPixel()` method
- Called in both `sendTemplateEmail()` and `sendCustomEmail()`
- Uses baseUrl from environment (TRACKING_SERVICE_URL or RENDER_EXTERNAL_URL)

## 📋 Summary

**Code Calculates:**
- Summary statistics (counts, averages, engagement score)
- Email history array
- Overall profile basics

**LLM Provides:**
- Engagement level analysis
- Buyer intent detection
- Urgency assessment
- Sentiment analysis
- Key signals and topics
- Objections detection
- Next best action recommendation
- Follow-up priority
- Confidence score

