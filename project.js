const MAX_SMS_LENGTH = 480;
const SMS_COOLDOWN_MINUTES = 15;
const SMS_DELAY_MS = 1500;

module.exports = async function (context) {
  const secret = context.secrets.AUTOMATE_CLOUD_SECRET;
  const accountEmail = context.secrets.AUTOMATE_ACCOUNT_EMAIL;
  const gatewayUrl = String(context.secrets.CLOUDFLARE_GATEWAY_URL || "").replace(/\/+$/, "");
  const gatewayKey = context.secrets.GATEWAY_SECRET_KEY;

  if (!secret || !accountEmail || !gatewayUrl || !gatewayKey) {
    throw new Error('Missing required secrets "AUTOMATE_CLOUD_SECRET", "AUTOMATE_ACCOUNT_EMAIL", "CLOUDFLARE_GATEWAY_URL", or "GATEWAY_SECRET_KEY".');
  }

  const rawRecipients = String(process.env.SMS_TO || "").trim();
  const messageText = String(process.env.SMS_MESSAGE || "").trim().slice(0, MAX_SMS_LENGTH);
  const baseAlertKey = String(process.env.SMS_ALERT_KEY || "").trim();

  const recipients = [];
  for (const entry of rawRecipients.split(/[,;\s]+/)) {
    const phone = entry.trim();
    if (phone && !recipients.includes(phone)) {
      recipients.push(phone);
    }
  }

  if (recipients.length === 0 || !messageText) {
    throw new Error('Missing required inputs "to" or "message".');
  }

  const nowMs = Date.now();

  for (const targetNumber of recipients) {
    const alertKey = baseAlertKey ? `${baseAlertKey}:${targetNumber}` : "";

    if (alertKey) {
      const lastSentMs = Number(context.state.get("SMS_SENT_AT", alertKey) || 0);
      if (lastSentMs > 0 && (nowMs - lastSentMs) / 60000 < SMS_COOLDOWN_MINUTES) {
        console.log(`Cooldown active for "${alertKey}", skipped.`);
        continue;
      }
    }

    const response = await fetch(`${gatewayUrl}/automate/automate/cloud/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-gateway-key": gatewayKey
      },
      body: JSON.stringify({
        secret,
        to: accountEmail,
        priority: "high",
        payload: JSON.stringify({
          to: targetNumber,
          message: messageText
        })
      })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Automate Cloud HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
    }

    if (alertKey) {
      context.state.set("SMS_SENT_AT", alertKey, String(nowMs));
    }

    console.log(`Dispatched SMS to ${targetNumber}.`);
    await context.sleep(SMS_DELAY_MS);
  }
};
