import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const requestId = required("REQUEST_ID");
const hardwareId = required("HARDWARE_ID");
const client = required("CLIENT");
const productName = required("PRODUCT_NAME");
const productId = required("PRODUCT_ID");
const internalTrialKey = required("INTERNAL_TRIAL_KEY");
const displayName = required("DISPLAY_NAME");
const privateKey = required("SIGNED_LICENSE_PRIVATE_KEY").replace(/\\n/g, "\n");

if (!/^[a-f0-9-]{36}$/i.test(requestId)) {
  throw new Error("Invalid request identifier.");
}
if (!/^[A-Za-z0-9-]{10,200}$/.test(hardwareId)) {
  throw new Error("Invalid Hardware ID.");
}
if (client.length > 120 || productName.length > 120 || displayName.length > 120) {
  throw new Error("Client, ProductName or Name is too long.");
}
if (!/^#[A-Za-z0-9][A-Za-z0-9._-]{0,63}#$/.test(productId)) {
  throw new Error("Invalid Product ID.");
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$/.test(internalTrialKey)) {
  throw new Error("Invalid TrialMaker internal key.");
}

const payload = {
  version: 2,
  licenseId: crypto.randomUUID(),
  type: "PremiumFull",
  hardwareId,
  client,
  identity: {
    schemaVersion: 2,
    type: "PremiumFull",
    productName,
    productId,
    internalTrialKey,
    name: displayName
  },
  issuedUtc: new Date().toISOString()
};

const payloadBase64 = base64Url(Buffer.from(JSON.stringify(payload), "utf8"));
const signature = crypto.sign(
  "RSA-SHA256",
  Buffer.from(payloadBase64, "ascii"),
  privateKey
);
const license = `SI2.${payloadBase64}.${base64Url(signature)}`;
const output = {
  requestId,
  license,
  licenseId: payload.licenseId,
  hardwareId,
  client,
  identity: payload.identity,
  issuedUtc: payload.issuedUtc
};

fs.mkdirSync("generated", { recursive: true });
fs.writeFileSync(
  path.join("generated", `${requestId}.json`),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8"
);

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function base64Url(value) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
