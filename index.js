require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const app = express();

// Twilio sends application/x-www-form-urlencoded for webhooks
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get('/', (_req, res) => res.send('WA → Video → FB Page MVP is running ✅'));
app.get('/health', (_req, res) => res.send('ok'));

// Twilio WhatsApp webhook (Sandbox)
// Set this path as your Twilio Sandbox "When a message comes in" URL
app.post('/webhooks/whatsapp-twilio', async (req, res) => {
  try {
    const from = req.body.From;               // e.g., "whatsapp:+27..."
    const numMedia = parseInt(req.body.NumMedia || '0', 10);

    if (numMedia > 0) {
      // Take first media (photo)
      const mediaUrl = req.body.MediaUrl0;
      // Download image (Twilio media is already public URL)
      const imgResp = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
      const inPath = `in_${Date.now()}.jpg`;
      fs.writeFileSync(inPath, imgResp.data);

      // Render a 12s vertical 1080x1920 MP4 with gentle zoom (Ken Burns style)
      const outPath = `out_${Date.now()}.mp4`;
      // Simple, reliable filter chain; keep it basic for MVP
      const ff = `ffmpeg -y -loop 1 -i ${inPath} -t 12 -vf "scale=1080:1920,zoompan=z='min(zoom+0.0015,1.15)':d=300" -pix_fmt yuv420p -c:v libx264 -r 30 ${outPath}`;
      execSync(ff, { stdio: 'ignore' });

      // --- Post to Facebook Page as a video ---
      // Start upload session
      const startParams = new URLSearchParams();
      startParams.append('access_token', process.env.FB_PAGE_ACCESS_TOKEN);
      startParams.append('upload_phase', 'start');

      const start = await axios.post(
        `https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/videos`,
        startParams
      );
      const upload_session_id = start.data.upload_session_id;

      // Transfer the bytes
      const videoData = fs.readFileSync(outPath);
      await axios.post(
        `https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/videos`,
        videoData,
        {
          headers: { 'Content-Type': 'application/octet-stream' },
          params: {
            upload_phase: 'transfer',
            upload_session_id,
            start_offset: 0,
            access_token: process.env.FB_PAGE_ACCESS_TOKEN
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        }
      );

      // Finish upload
      const finishParams = new URLSearchParams();
      finishParams.append('access_token', process.env.FB_PAGE_ACCESS_TOKEN);
      finishParams.append('upload_phase', 'finish');
      finishParams.append('upload_session_id', upload_session_id);
      finishParams.append('title', 'Auto-generated 12s video');
      finishParams.append('description', 'Posted via WA→Video MVP');

      await axios.post(
        `https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/videos`,
        finishParams
      );

      // WhatsApp confirmation back to sender (via Twilio)
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,  // e.g., "whatsapp:+14155238886"
        to: from,
        body: '✅ Received your photo, created a 12s video, and posted to your Facebook Page.'
      });

      // Clean up (best effort)
      try { fs.unlinkSync(inPath); } catch {}
      try { fs.unlinkSync(outPath); } catch {}
    } else {
      // No media; send help text
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: req.body.From,
        body: 'Send me a photo on WhatsApp and I will auto-post a 12s vertical video to your Facebook Page.'
      });
    }

    res.status(200).end(); // Acknowledge so Twilio doesn’t retry
  } catch (err) {
    console.error('Webhook error:', err?.response?.data || err);
    res.status(200).end(); // Still 200 to stop retries; log the error
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server up on ${PORT}`));
