import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const requestId = required("REQUEST_ID");
const hardwareId = required("HARDWARE_ID");
const client = required("CLIENT");
const productName = required("PRODUCT_NAME");
const productId = required("PRODUCT_ID");
const internalTrialKey = required("INTERNAL_TRIAL_KEY");
const displayName = required("DISPLAY_NAME");
const licenseType = required("LICENSE_TYPE"); // PremiumFull, PremiumFree, FreeTrial
const totalDaysStr = required("TOTAL_DAYS");
const totalDays = parseInt(totalDaysStr, 10);

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
if (isNaN(totalDays) || totalDays < 1 || totalDays > 3650) {
  throw new Error("Invalid total days duration.");
}

// Map license type to TrialMaker LicenseTypes enum (0 = FreeTrial, 1 = Premium)
const typeValue = (licenseType === "PremiumFull") ? 1 : 0;

const activationDate = new Date();
const expiryDate = new Date(activationDate.getTime() + totalDays * 24 * 60 * 60 * 1000);

// Build License object JSON matching TrialMaker schema
const licenseObj = {
  IsValid: true,
  FirstTime: false,
  Activations: 1,
  Uses: 0,
  TotalDays: totalDays,
  RemainingDays: totalDays,
  Client: client,
  ProductID: productId,
  Product: internalTrialKey,
  LicenseKey: "",
  HardwareIDs: [hardwareId],
  LastUsed: activationDate.toISOString(),
  ActivationDate: activationDate.toISOString(),
  ExpiryDate: expiryDate.toISOString(),
  Type: typeValue,
  Status: 0 // LicenseStatus.Active
};

const jsonStr = JSON.stringify(licenseObj);

// Derived Rijndael Key and IV (AES-256-CBC)
const KEY_BASE64 = "rrH4NZ/2R7SnegeJzn004xoLPf2PPbQ7zUbFzWIH8nY=";
const IV_BASE64 = "XXilIApfptlJ4DndOj4+OA==";

const key = Buffer.from(KEY_BASE64, "base64");
const iv = Buffer.from(IV_BASE64, "base64");

// Encrypt payload using AES-256-CBC with PKCS7 padding
const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
let encrypted = cipher.update(jsonStr, "utf8", "base64");
encrypted += cipher.final("base64");

// Format output response
const output = {
  requestId,
  license: encrypted,
  licenseId: requestId,
  hardwareId,
  client,
  identity: {
    schemaVersion: 2,
    type: licenseType,
    productName,
    productId,
    internalTrialKey,
    name: displayName
  },
  issuedUtc: activationDate.toISOString()
};

fs.mkdirSync("generated", { recursive: true });
fs.writeFileSync(
  path.join("generated", `${requestId}.json`),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8"
);
