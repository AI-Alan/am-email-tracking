import "dotenv/config"; // Load environment variables
import express, { Request, Response } from "express";
import { handleEmailOpen } from "./services/openTrackingHandler";
import { TRANSPARENT_PNG } from "./services/transparetPng";

const app = express();
const PORT = 3001;

// Open tracking endpoint
app.get("/open/:messageId.png", async (req: Request, res: Response) => {
    const { messageId } = req.params;

    console.log(`📧 Open tracking pixel requested for: ${messageId}`);

    // Track asynchronously - don't wait
    handleEmailOpen(messageId).catch(() => { }); // Suppress errors

    // Always return the image immediately
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(TRANSPARENT_PNG);
});

app.listen(PORT, () => {
    console.log(`🔍 Open tracking server running on http://localhost:${PORT}`);
    console.log(`   GET /open/:messageId.png - Track email opens`);
});
