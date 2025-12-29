export interface EmailInsightSummary {
  total_emails_sent: number;
  emails_opened: number;
  emails_replied: number;
  avg_reply_time_seconds: number;
  engagement_score: number;
}

export interface LatestEmailInsight {
  engagement_level: "LOW" | "MEDIUM" | "HIGH";
  buyer_intent: "UNKNOWN" | "INTERESTED" | "NOT_INTERESTED";
  urgency_level: "LOW" | "MEDIUM" | "HIGH";
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  key_signals?: string[];
  topics_detected?: string[];
  objections?: string[];
  next_best_action: string;
  follow_up_priority?: string;
  confidence_score: number;
}

export interface EmailHistoryItem {
  email_id: string;
  sentAt: string;
  insight: {
    buyer_intent: "UNKNOWN" | "INTERESTED" | "NOT_INTERESTED";
    sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  };
}

export interface EmailInsight {
  summary: EmailInsightSummary;
  latest_email_insight: LatestEmailInsight;
  history: EmailHistoryItem[];
}

export interface CallInsight {
  last_call_outcome?: string;
  preferred_call_time?: string;
}

export interface WhatsAppInsight {
  preferred?: boolean;
}

export interface OverallBuyerProfile {
  engagement_level: "LOW" | "MEDIUM" | "HIGH";
  preferred_channel: "EMAIL" | "CALL" | "WHATSAPP" | "SMS";
  decision_stage: "AWARENESS" | "CONSIDERATION" | "DECISION" | "PURCHASE";
}

export interface TrackingSummary {
  buyer_id: string;
  email_insight: EmailInsight;
  call_insight?: CallInsight;
  whatsapp_insight?: WhatsAppInsight;
  overall_buyer_profile: OverallBuyerProfile;
  createdAt: string;
  updatedAt: string;
}

