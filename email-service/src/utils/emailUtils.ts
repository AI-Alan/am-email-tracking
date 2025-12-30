/**
 * Utility functions for email processing
 */

/**
 * Convert HTML to plain text
 * Removes HTML tags, decodes HTML entities, and preserves basic formatting
 */
export function htmlToPlainText(html: string): string {
    if (!html) return '';

    // Remove HTML comments
    let text = html.replace(/<!--[\s\S]*?-->/g, '');

    // Replace common block elements with line breaks
    text = text.replace(/<\/?(div|p|br|h[1-6]|li|tr)[^>]*>/gi, '\n');

    // Replace list items with bullet points
    text = text.replace(/<li[^>]*>/gi, '• ');

    // Remove all other HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");

    // Decode numeric entities (e.g., &#39;)
    text = text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
    text = text.replace(/&#x([a-f\d]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

    // Clean up whitespace
    text = text
        .replace(/\n\s*\n\s*\n/g, '\n\n') // Multiple newlines to double
        .replace(/[ \t]+/g, ' ') // Multiple spaces to single
        .trim();

    return text;
}

/**
 * Clean reply content by removing quoted text, signatures, and original email content
 * This extracts only the user's actual reply text
 */
export function cleanReplyContent(content: string): string {
    if (!content) return '';

    let cleaned = content.trim();

    // Split into lines for processing
    const lines = cleaned.split('\n');
    const cleanedLines: string[] = [];
    
    let foundQuoteStart = false;
    let foundSignature = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines if we've already started finding quotes/signatures
        if (!line && (foundQuoteStart || foundSignature)) {
            continue;
        }

        // Detect quoted text patterns
        // Common patterns:
        // - Lines starting with ">"
        // - "On [date] [person] wrote:"
        // - "From: ..."
        // - "Sent: ..."
        // - "To: ..."
        // - "Subject: ..."
        // - "-----Original Message-----"
        // - Multiple ">" characters at start (nested quotes)
        if (
            line.startsWith('>') ||
            line.match(/^On .+ wrote:?$/i) ||
            line.match(/^From:/i) ||
            line.match(/^Sent:/i) ||
            line.match(/^To:/i) ||
            line.match(/^Subject:/i) ||
            line.match(/^-{3,}Original Message-{3,}/i) ||
            line.match(/^-{3,}Forwarded Message-{3,}/i) ||
            line.match(/^From:.*Sent:.*To:.*Subject:/i) || // Email headers in one line
            line.match(/^<[^>]+> wrote:$/i) || // <email@example.com> wrote:
            line.match(/^\*?From:\s*.+\s+\[mailto:/i) // From: Name [mailto:email]
        ) {
            foundQuoteStart = true;
            continue; // Skip this line and all subsequent lines
        }

        // If we found quote start, skip everything after
        if (foundQuoteStart) {
            continue;
        }

        // Detect signature patterns (usually at end of email)
        // Common signatures:
        // - "Best regards"
        // - "Sincerely"
        // - "Thanks"
        // - "Sent from..."
        // - "Get Outlook for..."
        // - Lines with "---" or "___"
        // - Contact info patterns
        if (
            line.match(/^(Best regards|Regards|Sincerely|Thanks|Thank you|Cheers|Yours truly)/i) ||
            line.match(/^Sent from/i) ||
            line.match(/^Get (Outlook|Mail|iPhone|Android)/i) ||
            line.match(/^-{3,}$/) ||
            line.match(/^_{3,}$/) ||
            line.match(/^Phone:|^Mobile:|^Email:|^Web:/i) ||
            line.match(/^www\.|^http/i) // URLs often in signatures
        ) {
            // Check if this is likely a signature (appears after some content)
            if (cleanedLines.length > 2) {
                foundSignature = true;
                break; // Stop here, everything after is likely signature
            }
        }

        // If we haven't hit quotes or signature yet, keep the line
        if (!foundSignature) {
            cleanedLines.push(lines[i]); // Keep original formatting
        }
    }

    // Join lines back and clean up
    cleaned = cleanedLines.join('\n')
        .replace(/\n{3,}/g, '\n\n') // Multiple blank lines to double
        .trim();

    return cleaned;
}



