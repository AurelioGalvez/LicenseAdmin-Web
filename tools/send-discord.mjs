const channel = process.env.CHANNEL;
const webhooks = {
  announcements: process.env.DISCORD_WEBHOOK_ANNOUNCEMENTS,
  tests: process.env.DISCORD_WEBHOOK_TESTS,
  infamous: process.env.DISCORD_WEBHOOK_INFAMOUS
};

if (!Object.hasOwn(webhooks, channel)) {
  throw new Error("Unknown Discord destination.");
}

const webhook = webhooks[channel];
if (!webhook) {
  throw new Error(`The GitHub secret for ${channel} is not configured.`);
}

const content = (process.env.CONTENT || "").trim();
const imageUrl = (process.env.IMAGE_URL || "").trim();
if (!content && !imageUrl) {
  throw new Error("A message or image URL is required.");
}
if (content.length > 2000) {
  throw new Error("Discord messages cannot exceed 2000 characters.");
}

function requireHttpsUrl(value, name) {
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS.`);
  }
  return parsed.toString();
}

const payload = { content };
const username = (process.env.USERNAME || "").trim();
const avatarUrl = requireHttpsUrl(
  (process.env.AVATAR_URL || "").trim(),
  "Avatar URL"
);
const safeImageUrl = requireHttpsUrl(imageUrl, "Image URL");

if (username) payload.username = username.slice(0, 80);
if (avatarUrl) payload.avatar_url = avatarUrl;
if (safeImageUrl) payload.embeds = [{ image: { url: safeImageUrl } }];

const response = await fetch(`${webhook}?wait=true`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

if (!response.ok) {
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`Discord returned ${response.status}: ${detail}`);
}

console.log(`Discord notification ${process.env.REQUEST_ID} sent to ${channel}.`);
