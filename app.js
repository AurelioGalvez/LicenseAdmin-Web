"use strict";

const state = { token: "", owner: "", repo: "", branch: "main", full: [], temporary: [], pendingDelete: null };
const $ = id => document.getElementById(id);
const generator = {
  repository: "LicenseAdmin-Web",
  branch: "main",
  workflow: "generate-premium-license.yml"
};
const discord = {
  repository: "LicenseAdmin-Web",
  branch: "main",
  workflow: "send-discord-notification.yml"
};
const licenseAuthority = {
  repository: "Launcher-Licenses"
};
let writeQueue = Promise.resolve();
const files = {
  full: "PremiumFullLicenses.json",
  fullIdentity: "PremiumFullIdentity.json",
  tempEnabled: "PremiumHwidEnabled.txt",
  tempDefaultDays: "PremiumHwidDefaultDays.txt",
  temporary: "PremiumTemporaryLicenses.json",
  premiumFreeEnabled: "PremiumFreeEnabled.txt",
  premiumFreeDays: "PremiumFreeDays.txt",
  premiumFreeUntil: "PremiumFreeAcquisitionUntilUtc.txt",
  premiumFreeIdentity: "PremiumFreeIdentity.json",
  freeEnabled: "EnableFreeTrial.txt",
  freeDays: "FreeTrialDays.txt",
  freeUntil: "FreeTrialAcquisitionUntilUtc.txt",
  freeIdentity: "FreeTrialIdentity.json"
};

function status(message, type = "") {
  $("status").textContent = message;
  $("status").className = type;
}

function requireConnection() {
  if (!state.token) throw new Error("Conecta primero con un token válido.");
}

function apiHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${state.token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function repositoryContentUrl(repository, path) {
  const escaped = path.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(repository)}/contents/${escaped}`;
}

function contentUrl(path) {
  return repositoryContentUrl(state.repo, path);
}

async function api(url, options = {}) {
  let response;
  try {
    const isGet = !options.method || options.method.toUpperCase() === 'GET';
    const finalUrl = isGet ? (url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`) : url;
    response = await fetch(finalUrl, {
      cache: "no-store",
      ...options,
      headers: {
        ...apiHeaders(),
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error("No se pudo conectar con la API de GitHub. Comprueba la conexión y recarga la página.");
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(`GitHub ${response.status}: ${data.message || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function connect() {
  state.token = $("token").value.trim();
  state.owner = $("owner").value.trim();
  state.repo = licenseAuthority.repository;
  $("repository").value = state.repo;
  requireConnection();
  const repo = await api(`https://api.github.com/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}`);
  state.branch = repo.default_branch;
  $("branch").value = state.branch;
  $("connectionBadge").textContent = "Conectado";
  $("connectionBadge").classList.add("connected");
  status(`Conectado a ${repo.full_name}.`, "success");
  await loadActivePanel();
}

async function readFile(path) {
  requireConnection();
  const query = new URLSearchParams({
    ref: state.branch,
    _: `${Date.now()}-${Math.random()}`
  });
  let response;
  try {
    response = await fetch(`${contentUrl(path)}?${query}`, {
      cache: "no-store",
      headers: apiHeaders()
    });
  } catch {
    throw new Error("No se pudo leer GitHub. Comprueba la conexión y recarga la página.");
  }
  if (response.status === 404) return { content: "", sha: null };
  const data = await response.json();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${data.message || response.statusText}`);
  return { content: decodeURIComponent(escape(atob(data.content.replace(/\s/g, "")))), sha: data.sha };
}

function writeFile(path, content, message) {
  const operation = () => writeFileImmediate(path, content, message);
  const result = writeQueue.then(operation, operation);
  writeQueue = result.catch(() => {});
  return result;
}

async function writeFileImmediate(path, content, message) {
  const encodedContent = btoa(unescape(encodeURIComponent(content)));

  for (let attempt = 1; attempt <= 3; attempt++) {
    const current = await readFile(path);
    const body = { message, content: encodedContent, branch: state.branch };
    if (current.sha) body.sha = current.sha;

    try {
      return await api(contentUrl(path), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (error.status !== 409 || attempt === 3) throw error;
    }
  }

  throw new Error(`No se pudo actualizar ${path} despues de varios intentos.`);
}

async function readRepositoryFile(repository, path, branch) {
  const query = new URLSearchParams({
    ref: branch,
    _: `${Date.now()}-${Math.random()}`
  });
  const response = await fetch(`${repositoryContentUrl(repository, path)}?${query}`, {
    cache: "no-store",
    headers: apiHeaders()
  });
  if (response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${data.message || response.statusText}`);
  return {
    content: decodeURIComponent(escape(atob(data.content.replace(/\s/g, "")))),
    sha: data.sha
  };
}

async function deleteRepositoryFile(repository, path, branch, sha) {
  return api(repositoryContentUrl(repository, path), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Remove generated license response ${path}`,
      branch,
      sha
    })
  });
}

async function authorizeSignedPremium(hardwareId, client, identity) {
  const repository = licenseAuthority.repository;
  const repositoryInfo = await api(
    `https://api.github.com/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(repository)}`
  );
  const branch = repositoryInfo.default_branch;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const current = await readRepositoryFile(repository, files.full, branch);
    const entries = parseList(current?.content || "");
    const existing = entries.find(
      entry => entry.hardwareId.toLowerCase() === hardwareId.toLowerCase()
    );

    if (existing) {
      existing.comment = existing.comment || `Signed Premium: ${client}`;
      existing.identity = identity;
    } else {
      entries.push({
        hardwareId,
        identity,
        comment: `Signed Premium: ${client}`
      });
    }

    const body = {
      message: `Authorize signed Premium FULL ${hardwareId}`,
      content: btoa(unescape(encodeURIComponent(serializeList(entries, identity)))),
      branch
    };
    if (current?.sha) body.sha = current.sha;

    try {
      await api(repositoryContentUrl(repository, files.full), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      break;
    } catch (error) {
      if (error.status !== 409 || attempt === 3) throw error;
    }
  }

  for (let attempt = 1; attempt <= 10; attempt++) {
    const verified = await readRepositoryFile(
      repository,
      files.full,
      branch
    );
    const authorized = parseList(verified?.content || "").some(
      entry => entry.hardwareId.toLowerCase() === hardwareId.toLowerCase()
    );
    if (authorized) return branch;
    await delay(1000);
  }

  throw new Error(
    `GitHub no confirmó el HWID en ${repository}/${files.full}. No se generó ninguna clave.`
  );
}

function parseList(content) {
  if (!content.trim()) return [];
  try {
    const document = JSON.parse(content);
    if (document.schemaVersion !== 2 || document.type !== "PremiumFullList" || !Array.isArray(document.entries)) return [];
    return document.entries.filter(x => x && x.schemaVersion === 2 && x.type === "PremiumFull" && x.hardwareId);
  } catch { return []; }
}
const serializeList = (entries, identity) => `${JSON.stringify({
  schemaVersion: 2,
  type: "PremiumFullList",
  entries: entries
    .sort((a, b) => a.hardwareId.localeCompare(b.hardwareId))
    .map(x => ({
      schemaVersion: 2,
      type: "PremiumFull",
      hardwareId: x.hardwareId.trim(),
      identity: x.identity || identity,
      comment: (x.comment || "").replace(/[\r\n]/g, " ")
    }))
}, null, 2)}\n`;

function parseTemporary(content) {
  if (!content.trim()) return [];
  try {
    const document = JSON.parse(content);
    if (document.schemaVersion !== 2 || document.type !== "PremiumTemporaryList" || !Array.isArray(document.entries)) return [];
    return document.entries.filter(x => x && x.schemaVersion === 2 && x.type === "PremiumTemporary" && x.hardwareId);
  } catch { return []; }
}
const serializeTemporary = (entries, identity) => `${JSON.stringify({
  schemaVersion: 2,
  type: "PremiumTemporaryList",
  entries: entries
    .sort((a, b) => a.hardwareId.localeCompare(b.hardwareId))
    .map(x => ({
      schemaVersion: 2,
      type: "PremiumTemporary",
      hardwareId: x.hardwareId.trim(),
      activationUtc: new Date(x.activationUtc).toISOString(),
      days: Number(x.days),
      identity: x.identity || identity,
      comment: (x.comment || "").replace(/[\r\n]/g, " ")
    }))
}, null, 2)}\n`;

const identityFields = {
  PremiumFull: {
    productName: "generatorProductName",
    productId: "generatorProductId",
    internalTrialKey: "generatorInternalKey",
    name: "generatorName"
  },
  PremiumFree: {
    productName: "premiumFreeProductName",
    productId: "premiumFreeProductIdPreview",
    internalTrialKey: "premiumFreeTrialNamePreview",
    name: "premiumFreeBasePreview"
  },
  FreeTrial: {
    productName: "productName",
    productId: "productIdPreview",
    internalTrialKey: "trialNamePreview",
    name: "productBasePreview"
  }
};

// El panel y LicensingLib aplican las mismas reglas. No se deriva un campo de
// otro: los cuatro valores forman el contrato exacto que se firma o se entrega
// a TrialMaker y se guardan juntos para evitar configuraciones parciales.
function identityFromForm(type) {
  const fields = identityFields[type];
  return validateIdentity({
    schemaVersion: 2,
    type,
    productName: $(fields.productName).value.trim(),
    productId: $(fields.productId).value.trim(),
    internalTrialKey: $(fields.internalTrialKey).value.trim(),
    name: $(fields.name).value.trim()
  }, type);
}

function applyIdentityToForm(identity) {
  const fields = identityFields[identity.type];
  $(fields.productName).value = identity.productName;
  $(fields.productId).value = identity.productId;
  $(fields.internalTrialKey).value = identity.internalTrialKey;
  $(fields.name).value = identity.name;
}

function validateIdentity(identity, expectedType) {
  if (!identity || identity.schemaVersion !== 2 || identity.type !== expectedType) {
    throw new Error(`La identidad ${expectedType} no usa el esquema 2.`);
  }
  if (!identity.productName || identity.productName.length > 120) {
    throw new Error("ProductName es obligatorio y admite hasta 120 caracteres.");
  }
  if (!/^#[A-Za-z0-9][A-Za-z0-9._-]{0,63}#$/.test(identity.productId)) {
    throw new Error("Product ID debe estar entre #, por ejemplo #2.0.0#.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$/.test(identity.internalTrialKey)) {
    throw new Error("La clave interna TrialMaker contiene caracteres no permitidos.");
  }
  if (!identity.name || identity.name.length > 120) {
    throw new Error("Nombre es obligatorio y admite hasta 120 caracteres.");
  }
  return identity;
}

function parseIdentity(content, expectedType) {
  if (!content.trim()) throw new Error(`No existe la identidad ${expectedType} de esquema 2.`);
  return validateIdentity(JSON.parse(content), expectedType);
}

const serializeIdentity = identity => `${JSON.stringify(identity, null, 2)}\n`;

async function assertIdentityIsDistinct(candidate) {
  const definitions = [
    [files.fullIdentity, "PremiumFull"],
    [files.premiumFreeIdentity, "PremiumFree"],
    [files.freeIdentity, "FreeTrial"]
  ];
  for (const [path, type] of definitions) {
    if (type === candidate.type) continue;
    const remote = await readFile(path);
    if (!remote.content.trim()) continue;
    const other = parseIdentity(remote.content, type);
    if (other.productName.toLowerCase() === candidate.productName.toLowerCase() ||
        other.productId.toLowerCase() === candidate.productId.toLowerCase() ||
        other.internalTrialKey.toLowerCase() === candidate.internalTrialKey.toLowerCase()) {
      throw new Error(`La identidad ${candidate.type} comparte ProductName, Product ID o clave TrialMaker con ${type}.`);
    }
  }
}

async function loadFullIdentity() {
  const identity = parseIdentity((await readFile(files.fullIdentity)).content, "PremiumFull");
  applyIdentityToForm(identity);
  return identity;
}

async function saveFullIdentity() {
  const identity = identityFromForm("PremiumFull");
  await assertIdentityIsDistinct(identity);
  await writeFile(files.fullIdentity, serializeIdentity(identity), "Update Premium FULL identity schema 2");
  await loadFullIdentity();
  status("Identidad Premium FULL guardada y verificada.", "success");
}

function renderFull() {
  $("fullRows").replaceChildren(...state.full.map(entry => row([
    entry.hardwareId, entry.comment,
    button("Eliminar", "danger", () => askDelete("full", entry.hardwareId))
  ], () => { $("fullHwid").value = entry.hardwareId; $("fullComment").value = entry.comment; })));
}

async function loadFull() {
  state.full = parseList((await readFile(files.full)).content);
  renderFull();
  status(`${state.full.length} licencias Premium FULL cargadas.`, "success");
}

async function saveFull() {
  const hardwareId = $("fullHwid").value.trim();
  if (!hardwareId) throw new Error("Introduce un Hardware ID.");
  const identity = await loadFullIdentity();
  const existing = state.full.find(x => x.hardwareId.toLowerCase() === hardwareId.toLowerCase());
  if (existing) {
    existing.comment = $("fullComment").value.trim();
    existing.identity = identity;
  } else {
    state.full.push({ hardwareId, identity, comment: $("fullComment").value.trim() });
  }
  await writeFile(files.full, serializeList(state.full, identity), `${existing ? "Update" : "Add"} Premium FULL ${hardwareId}`);
  renderFull();
  status(`Hardware ID ${hardwareId} ${existing ? "actualizado" : "agregado"} exitosamente.`, "success");
}

async function generateSignedLicense() {
  requireConnection();
  const hardwareId = $("generatorHwid").value.trim();
  const client = $("generatorClient").value.trim();
  const licenseType = $("generatorLicenseType").value;
  const totalDays = $("generatorDays").value.trim();

  if (!/^[A-Za-z0-9-]{10,200}$/.test(hardwareId)) {
    throw new Error("Introduce un Hardware ID válido.");
  }
  if (!client) throw new Error("Introduce el nombre del cliente.");
  if (!totalDays || isNaN(totalDays) || Number(totalDays) < 1) {
    throw new Error("Introduce días de duración válidos.");
  }

  // Cargar identidad Premium FULL para autorizar online
  const fullIdentity = parseIdentity((await readFile(files.fullIdentity)).content, "PremiumFull");

  const requestId = crypto.randomUUID();
  $("generatedLicense").value = "";
  status(
    `Autorizando el HWID en ${licenseAuthority.repository}...`,
    ""
  );
  const authorityBranch = await authorizeSignedPremium(hardwareId, client, fullIdentity);
  status("HWID autorizado. Solicitando la clave...", "");

  await api(
    `https://api.github.com/repos/${encodeURIComponent(state.owner)}/${generator.repository}/actions/workflows/${generator.workflow}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: generator.branch,
        inputs: {
          request_id: requestId,
          hardware_id: hardwareId,
          client,
          product_name: $("generatorProductName").value.trim(),
          product_id: $("generatorProductId").value.trim(),
          internal_trial_key: $("generatorInternalKey").value.trim(),
          display_name: $("generatorName").value.trim(),
          license_type: licenseType,
          total_days: totalDays
        }
      })
    }
  );

  const path = `generated/${requestId}.json`;
  for (let attempt = 1; attempt <= 60; attempt++) {
    await delay(3000);
    const response = await readRepositoryFile(
      generator.repository,
      path,
      generator.branch
    );
    if (!response) {
      status(`Generando licencia... intento ${attempt}/60`, "");
      continue;
    }

    const result = JSON.parse(response.content);
    if (result.requestId !== requestId || !result.license) {
      throw new Error("GitHub Actions devolvió una respuesta inválida.");
    }

    const authorization = await readRepositoryFile(
      licenseAuthority.repository,
      files.full,
      authorityBranch
    );
    const remainsAuthorized = parseList(
      authorization?.content || ""
    ).some(
      entry => entry.hardwareId.toLowerCase() === hardwareId.toLowerCase()
    );
    if (!remainsAuthorized) {
      throw new Error(
        `El HWID dejó de estar autorizado en ${licenseAuthority.repository}. La clave no será entregada.`
      );
    }

    $("generatedLicense").value = result.license;
    await deleteRepositoryFile(
      generator.repository,
      path,
      generator.branch,
      response.sha
    );
    status(`Licencia Premium FULL ${result.licenseId} generada.`, "success");
    return;
  }

  throw new Error(
    "GitHub Actions no respondió en 3 minutos. Revisa la pestaña Actions del repositorio."
  );
}

async function updateGeneratorFieldsFromLicenseType() {
  const type = $("generatorLicenseType").value;
  status(`Cargando identidad para ${type}...`, "");
  try {
    let identity;
    let days = 3650;
    if (type === "PremiumFull") {
      identity = parseIdentity((await readFile(files.fullIdentity)).content, "PremiumFull");
    }

    if (identity) {
      $("generatorProductName").value = identity.productName;
      $("generatorProductId").value = identity.productId;
      $("generatorInternalKey").value = identity.internalTrialKey;
      $("generatorName").value = identity.name;
      $("generatorDays").value = days;
      status(`Campos del generador actualizados para ${type}.`, "success");
    }
  } catch (error) {
    status(`Error al cargar la identidad: ${error.message}`, "error");
  }
}

async function copyGeneratedLicense() {
  const license = $("generatedLicense").value.trim();
  if (!license) throw new Error("Primero genera una licencia.");
  await navigator.clipboard.writeText(license);
  status("Clave de activación copiada.", "success");
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function renderTemporary() {
  $("tempRows").replaceChildren(...state.temporary.map(entry => {
    const expiry = new Date(new Date(entry.activationUtc).getTime() + entry.days * 86400000).toISOString();
    return row([entry.hardwareId, entry.activationUtc, String(entry.days), expiry, entry.comment,
      button("Eliminar", "danger", () => askDelete("temporary", entry.hardwareId))
    ], () => {
      $("tempHwid").value = entry.hardwareId; $("tempComment").value = entry.comment;
      $("tempDays").value = entry.days; $("tempRestart").checked = false;
    });
  }));
}

async function loadTemporary() {
  const [enabled, defaults, list] = await Promise.all([
    readFile(files.tempEnabled), readFile(files.tempDefaultDays), readFile(files.temporary)
  ]);
  $("tempEnabled").checked = enabled.content.trim().toLowerCase() !== "false" && !!list.content.trim();
  const defaultDays = Number(defaults.content.trim()) || 7;
  $("tempDefaultDays").value = defaultDays;
  $("tempDays").value = defaultDays;
  state.temporary = parseTemporary(list.content);
  renderTemporary();
  status(`${state.temporary.length} licencias Premium temporales cargadas.`, "success");
}

async function saveTempConfig() {
  await Promise.all([
    writeFile(files.tempEnabled, `${$("tempEnabled").checked ? "True" : "False"}\n`, "Update Premium HWID enabled state"),
    writeFile(files.tempDefaultDays, `${validDays("tempDefaultDays")}\n`, "Update Premium HWID default duration")
  ]);
  status("Configuración Premium temporal guardada.", "success");
}

async function saveTemporary() {
  const hardwareId = $("tempHwid").value.trim();
  if (!hardwareId) throw new Error("Introduce un Hardware ID.");
  const days = validDays("tempDays");
  let entry = state.temporary.find(x => x.hardwareId.toLowerCase() === hardwareId.toLowerCase());
  const identity = await loadFullIdentity();
  if (!entry) {
    entry = { hardwareId, activationUtc: new Date().toISOString(), days, identity, comment: "" };
    state.temporary.push(entry);
  } else if ($("tempRestart").checked) entry.activationUtc = new Date().toISOString();
  entry.days = days;
  entry.identity = identity;
  entry.comment = $("tempComment").value.trim();
  await Promise.all([
    writeFile(files.tempEnabled, "True\n", "Enable Premium HWID licenses"),
    writeFile(files.tempDefaultDays, `${validDays("tempDefaultDays")}\n`, "Ensure Premium HWID default duration"),
    writeFile(files.temporary, serializeTemporary(state.temporary, identity), `Update temporary Premium ${hardwareId}`)
  ]);
  renderTemporary();
  status(`Hardware ID temporal ${hardwareId} guardado exitosamente.`, "success");
}

async function loadPremiumFree() {
  const [enabled, days, until, identityRemote] = await Promise.all([
    readFile(files.premiumFreeEnabled),
    readFile(files.premiumFreeDays),
    readFile(files.premiumFreeUntil),
    readFile(files.premiumFreeIdentity)
  ]);
  $("premiumFreeEnabled").checked = enabled.content.trim().toLowerCase() === "true";
  $("premiumFreeDays").value = Number(days.content.trim()) || 7;
  $("premiumFreeUntil").value = until.content.trim();
  applyIdentityToForm(parseIdentity(identityRemote.content, "PremiumFree"));
  status("Configuración Premium-Free cargada.", "success");
}
async function savePremiumFree() {
  const identity = identityFromForm("PremiumFree");
  await assertIdentityIsDistinct(identity);
  await Promise.all([
    writeFile(files.premiumFreeEnabled, `${$("premiumFreeEnabled").checked ? "True" : "False"}\n`, "Update Premium-Free enabled state"),
    writeFile(files.premiumFreeDays, `${validDays("premiumFreeDays")}\n`, "Update Premium-Free duration"),
    writeFile(files.premiumFreeUntil, `${validDate("premiumFreeUntil")}\n`, "Update Premium-Free acquisition deadline"),
    writeFile(files.premiumFreeIdentity, serializeIdentity(identity), "Update Premium-Free identity schema 2")
  ]);
  status("Configuración Premium-Free guardada exitosamente.", "success");
}

async function loadFree() {
  const [enabled, days, identityRemote, until] = await Promise.all([readFile(files.freeEnabled), readFile(files.freeDays), readFile(files.freeIdentity), readFile(files.freeUntil)]);
  $("freeEnabled").checked = enabled.content.trim().toLowerCase() === "true";
  $("freeDays").value = Number(days.content.trim()) || 7;
  $("freeUntil").value = until.content.trim();
  applyIdentityToForm(parseIdentity(identityRemote.content, "FreeTrial"));
  status("Configuración FreeTrial cargada.", "success");
}
async function saveFree() {
  const identity = identityFromForm("FreeTrial");
  await assertIdentityIsDistinct(identity);
  await Promise.all([
    writeFile(files.freeEnabled, `${$("freeEnabled").checked ? "True" : "False"}\n`, "Update FreeTrial enabled state"),
    writeFile(files.freeDays, `${validDays("freeDays")}\n`, "Update FreeTrial duration"),
    writeFile(files.freeUntil, `${validDate("freeUntil")}\n`, "Update FreeTrial acquisition deadline"),
    writeFile(files.freeIdentity, serializeIdentity(identity), "Update FreeTrial identity schema 2")
  ]);
  status("Configuración FreeTrial guardada exitosamente.", "success");
}

function validDays(id) {
  const value = Number($(id).value);
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error("Los días deben estar entre 1 y 3650.");
  return value;
}

function validDate(id) {
  const value = $(id).value.trim();
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = match ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed ||
      parsed.getUTCFullYear() !== Number(match[1]) ||
      parsed.getUTCMonth() + 1 !== Number(match[2]) ||
      parsed.getUTCDate() !== Number(match[3])) {
    throw new Error("La fecha limite no es valida.");
  }
  return value;
}

async function sendDiscordWebhook() {
  requireConnection();
  const content = $("discordMessage").value.trim();
  const image = $("discordImage").value.trim();
  if (!content && !image) throw new Error("Agrega texto o una imagen por URL.");

  const requestId = crypto.randomUUID();
  await api(
    `https://api.github.com/repos/${encodeURIComponent(state.owner)}/${discord.repository}/actions/workflows/${discord.workflow}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: discord.branch,
        inputs: {
          request_id: requestId,
          channel: $("discordChannel").value,
          content,
          image_url: image,
          username: $("discordUsername").value.trim(),
          avatar_url: $("discordAvatar").value.trim()
        }
      })
    }
  );

  status("Envio autorizado. Esperando confirmacion de GitHub Actions...", "");
  const runsUrl =
    `https://api.github.com/repos/${encodeURIComponent(state.owner)}/${discord.repository}` +
    `/actions/workflows/${discord.workflow}/runs`;
  for (let attempt = 1; attempt <= 60; attempt++) {
    await delay(2000);
    const query = new URLSearchParams({
      event: "workflow_dispatch",
      branch: discord.branch,
      per_page: "50",
      _: `${Date.now()}-${Math.random()}`
    });
    const data = await api(`${runsUrl}?${query}`);
    const run = (data.workflow_runs || []).find(
      item => item.display_title === `Discord ${requestId}`
    );
    if (!run || run.status !== "completed") {
      status(`Enviando a Discord... intento ${attempt}/60`, "");
      continue;
    }
    if (run.conclusion !== "success") {
      throw new Error("GitHub Actions no pudo enviar el mensaje. Revisa que el secreto del canal este configurado.");
    }
    status(`Mensaje enviado a ${$("discordChannel").selectedOptions[0].textContent}.`, "success");
    return;
  }
  throw new Error("GitHub Actions no confirmo el envio dentro del tiempo esperado.");
}

function clearDiscordForm() {
  $("discordChannel").value = "announcements";
  $("discordUsername").value = "";
  $("discordAvatar").value = "";
  $("discordMessage").value = "";
  $("discordImage").value = "";
  status("Campos de Discord limpiados.", "success");
}

const discordFormats = {
  bold: ["**", "**"], italic: ["*", "*"], underline: ["__", "__"],
  strike: ["~~", "~~"], spoiler: ["||", "||"], code: ["`", "`"],
  codeblock: ["```\n", "\n```"], quote: ["> ", ""], blockquote: [">>> ", ""],
  heading: ["# ", ""], heading2: ["## ", ""], heading3: ["### ", ""],
  subtext: ["-# ", ""], bullet: ["- ", ""], numbered: ["1. ", ""],
  link: ["[", "](https://example.com)"]
};

function applyDiscordFormat(format) {
  const textarea = $("discordMessage");
  const pair = discordFormats[format];
  if (!pair) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || "texto";
  textarea.setRangeText(pair[0] + selected + pair[1], start, end, "select");
  textarea.focus();
}

function row(values, select) {
  const tr = document.createElement("tr");
  tr.addEventListener("dblclick", select);
  values.forEach(value => {
    const td = document.createElement("td");
    if (value instanceof Node) td.append(value); else td.textContent = value;
    tr.append(td);
  });
  return tr;
}
function button(text, className, action) {
  const el = document.createElement("button"); el.textContent = text; el.className = className; el.addEventListener("click", e => { e.stopPropagation(); action(); }); return el;
}

function askDelete(type, hardwareId) {
  state.pendingDelete = { type, hardwareId };
  $("confirmText").textContent = `Se eliminará ${hardwareId} de GitHub.`;
  $("confirmDialog").showModal();
}
async function confirmDelete() {
  const pending = state.pendingDelete;
  $("confirmDialog").close();
  if (!pending) return;
  if (pending.type === "full") {
    state.full = state.full.filter(x => x.hardwareId.toLowerCase() !== pending.hardwareId.toLowerCase());
    const identity = await loadFullIdentity();
    await writeFile(files.full, serializeList(state.full, identity), `Remove Premium FULL ${pending.hardwareId}`);
    renderFull();
    status(`Hardware ID ${pending.hardwareId} eliminado exitosamente.`, "success");
  } else {
    state.temporary = state.temporary.filter(x => x.hardwareId.toLowerCase() !== pending.hardwareId.toLowerCase());
    const identity = await loadFullIdentity();
    await writeFile(files.temporary, serializeTemporary(state.temporary, identity), `Remove temporary Premium ${pending.hardwareId}`);
    renderTemporary();
    status(`Hardware ID ${pending.hardwareId} temporal eliminado exitosamente.`, "success");
  }
}

async function loadActivePanel() {
  const active = document.querySelector(".panel.active").id;
  const loaders = {
    full: loadFull,
    generator: updateGeneratorFieldsFromLicenseType,
    temporary: loadTemporary,
    premiumFree: loadPremiumFree,
    freeTrial: loadFree,
    communications: async () => status("Comunicaciones de Discord listas.", "success")
  };
  return loaders[active]();
}

async function run(action) {
  document.querySelectorAll("button").forEach(x => x.disabled = true);
  try { await action(); } catch (error) { status(error.message, "error"); }
  finally { document.querySelectorAll("button").forEach(x => x.disabled = false); }
}

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab,.panel").forEach(x => x.classList.remove("active"));
  tab.classList.add("active"); $(tab.dataset.panel).classList.add("active");
  if (state.token) run(loadActivePanel);
}));

const actions = {
  "load-full": loadFull, "save-full": saveFull,
  "generate-license": generateSignedLicense, "copy-license": copyGeneratedLicense,
  "load-full-identity": loadFullIdentity, "save-full-identity": saveFullIdentity,
  "load-temporary": loadTemporary, "save-temp-config": saveTempConfig, "save-temporary": saveTemporary,
  "load-premium-free": loadPremiumFree, "save-premium-free": savePremiumFree,
  "load-free": loadFree, "save-free": saveFree,
  "send-discord": sendDiscordWebhook, "clear-discord": clearDiscordForm
};
document.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", () => run(actions[el.dataset.action])));
$("connect").addEventListener("click", () => run(connect));
$("generatorLicenseType").addEventListener("change", () => run(updateGeneratorFieldsFromLicenseType));
$("cancelDelete").addEventListener("click", () => $("confirmDialog").close());
$("confirmDelete").addEventListener("click", () => run(confirmDelete));
document.querySelectorAll("[data-format]").forEach(button =>
  button.addEventListener("click", () => applyDiscordFormat(button.dataset.format)));
window.addEventListener("pagehide", () => {
  state.token = "";
  $("token").value = "";
});
