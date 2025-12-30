import OpenAI from "openai";

/**
 * Service for converting plain text emails to HTML format using LLM
 * Falls back to rule-based conversion if LLM is not available
 */
class HtmlConversionService {
    private client: OpenAI | null = null;
    private deployment: string = "gpt-35-turbo";
    private apiVersion: string = "2024-02-15-preview";
    private isInitialized: boolean = false;

    constructor() {
        this.init();
    }

    /**
     * Initialize Azure OpenAI client for HTML conversion
     */
    private init(): void {
        if (this.isInitialized) return;

        const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
        const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
        const apiVersionEnv = process.env.AZURE_OPENAI_API_VERSION?.trim();
        this.deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim() || "gpt-35-turbo";

        if (apiVersionEnv) {
            this.apiVersion = apiVersionEnv;
        }

        // Validate Azure OpenAI configuration
        const missingVars: string[] = [];
        if (!endpoint || endpoint === "") {
            missingVars.push("AZURE_OPENAI_ENDPOINT");
        }
        if (!apiKey || apiKey === "") {
            missingVars.push("AZURE_OPENAI_API_KEY");
        }

        if (missingVars.length > 0) {
            console.log(`⚠️ HtmlConversionService: Azure OpenAI not configured (missing: ${missingVars.join(", ")}). Will use rule-based conversion.`);
            this.client = null;
            this.isInitialized = true;
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
            console.log(`⚠️ HtmlConversionService: Azure OpenAI API key appears to be placeholder. Will use rule-based conversion.`);
            this.client = null;
            this.isInitialized = true;
            return;
        }

        // Clean endpoint (remove trailing slash if present)
        const cleanEndpoint = endpoint!.endsWith('/') ? endpoint!.slice(0, -1) : endpoint!;

        try {
            const baseURL = `${cleanEndpoint}/openai/deployments/${this.deployment}`;

            this.client = new OpenAI({
                apiKey: apiKey!,
                baseURL: baseURL,
                defaultQuery: { 'api-version': this.apiVersion },
                defaultHeaders: { 'api-key': apiKey! },
            });

            console.log(`✅ HtmlConversionService: Azure OpenAI client initialized successfully`);
        } catch (error: any) {
            console.error(`❌ HtmlConversionService: Failed to initialize Azure OpenAI client:`, error?.message || error);
            console.log(`   Will use rule-based conversion as fallback.`);
            this.client = null;
        }

        this.isInitialized = true;
    }

    /**
     * Check if LLM-based conversion is available
     */
    public isLLMAvailable(): boolean {
        return this.client !== null;
    }

    /**
     * Convert plain text to HTML using LLM
     * Falls back to rule-based conversion if LLM is not available or fails
     */
    public async convertPlainTextToHTML(
        plainText: string,
        recipientName: string,
        fallbackConverter: (text: string, name: string) => string
    ): Promise<string> {
        // If LLM is not available, use fallback immediately
        if (!this.client) {
            console.log(`📝 HtmlConversionService: LLM not available, using rule-based conversion`);
            return fallbackConverter(plainText, recipientName);
        }

        try {
            console.log(`🤖 HtmlConversionService: Converting plain text to HTML using LLM (${plainText.length} chars)`);

            const systemPrompt = `You are an email formatting assistant. Convert plain text emails into clean, professional HTML format suitable for email clients.

Requirements:
- Use professional email styling (Arial or sans-serif fonts, readable colors)
- Preserve line breaks and paragraph structure
- Convert URLs to clickable links
- Use inline CSS for email compatibility
- Keep the tone and formatting professional
- Add proper HTML structure with div containers
- Do NOT add tracking pixels or metadata comments
- Return ONLY the HTML content, no markdown code blocks, no explanations`;

            const userPrompt = `Convert the following plain text email to HTML format:

Recipient name: ${recipientName}

Plain text email:
${plainText}

Return ONLY valid HTML that can be used directly in an email body. Include proper styling for professional appearance.`;

            const response = await this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 1500
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error("Empty response from OpenAI");
            }

            // Extract HTML from response (may have markdown code blocks)
            let htmlContent = content.trim();
            const htmlMatch = htmlContent.match(/```(?:html)?\s*([\s\S]*?)\s*```/);
            if (htmlMatch) {
                htmlContent = htmlMatch[1];
            }

            // Remove any XML/HTML declaration if present
            htmlContent = htmlContent.replace(/^<\?xml[\s\S]*?\?>/, '');
            htmlContent = htmlContent.replace(/^<!DOCTYPE[\s\S]*?>/, '');

            // Validate it's HTML (contains HTML tags)
            if (!/<[a-z][\s\S]*>/i.test(htmlContent)) {
                throw new Error("LLM response does not contain valid HTML");
            }

            // Add signature if not present
            if (!htmlContent.includes("Agent Mira") && !htmlContent.includes("Team Agent Mira")) {
                htmlContent = `${htmlContent}
      <p style="margin: 20px 0 0 0; font-size: 1em; color: #222;">
          <strong>Team Agent Mira</strong><br/>
          <span style="font-size: 0.95em; color: #555;">AI + Real Agents. On your side.</span>
        </p>`;
            }

            console.log(`✅ HtmlConversionService: Successfully converted plain text to HTML using LLM (${htmlContent.length} chars)`);
            return htmlContent.trim();

        } catch (error: any) {
            console.error(`⚠️ HtmlConversionService: LLM conversion failed:`, error?.message || error);
            console.log(`   Falling back to rule-based conversion`);
            return fallbackConverter(plainText, recipientName);
        }
    }
}

// Export singleton instance
export const htmlConversionService = new HtmlConversionService();
export default htmlConversionService;

