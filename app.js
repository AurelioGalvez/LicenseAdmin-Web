"use strict";

const state = { token: "", owner: "", repo: "", branch: "main", full: [], temporary: [], pendingDelete: null };
const $ = id => document.getElementById(id);
const generator = {
  repository: "LicenseAdmin-Web",
  branch: "main",
  workflow: "generate-premium-license.yml"
};
const licenseAuthority = {
  repository: "Launcher-Licenses"
};
const files = {
  full: "Licenses.txt",
  tempEnabled: "PremiumHwidEnabled.txt",
  tempDefaultDays: "PremiumHwidDefaultDays.txt",
  temporary: "PremiumHwidLicenses.txt",
  premiumFreeEnabled: "PremiumFreeEnabled.txt",
  premiumFreeDays: "PremiumFreeDays.txt",
  freeEnabled: "EnableFreeTrial.txt",
  freeDays: "FreeTrialDays.txt",
  productName: "ProductName.txt"
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
    response = await fetch(url, {
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

async function writeFile(path, content, message) {
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

async function authorizeSignedPremium(hardwareId, client) {
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
    } else {
      entries.push({
        hardwareId,
        comment: `Signed Premium: ${client}`
      });
    }

    const body = {
      message: `Authorize signed Premium FULL ${hardwareId}`,
      content: btoa(unescape(encodeURIComponent(serializeList(entries)))),
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

const parseList = content => content.split(/\r?\n/).filter(Boolean).map(line => {
  const [hardwareId, comment = ""] = line.split("//", 2);
  return { hardwareId: hardwareId.trim(), comment: comment.trim() };
});
const serializeList = entries => entries
  .sort((a, b) => a.hardwareId.localeCompare(b.hardwareId))
  .map(x => x.comment ? `${x.hardwareId}//${x.comment.replace(/[\r\n]/g, " ")}` : x.hardwareId).join("\n") + "\n";

function parseTemporary(content) {
  return content.split(/\r?\n/).filter(Boolean).flatMap(line => {
    const [hardwareId, activationUtc, days, comment = ""] = line.split("//", 4);
    const parsedDays = Number(days);
    const date = new Date(activationUtc);
    return hardwareId && Number.isFinite(parsedDays) && !Number.isNaN(date.valueOf())
      ? [{ hardwareId: hardwareId.trim(), activationUtc: date.toISOString(), days: parsedDays, comment: comment.trim() }]
      : [];
  });
}
const serializeTemporary = entries => entries
  .sort((a, b) => a.hardwareId.localeCompare(b.hardwareId))
  .map(x => `${x.hardwareId}//${x.activationUtc}//${x.days}//${x.comment.replace(/[\r\n]/g, " ")}`).join("\n") + "\n";

function parseProductIdentity(value) {
  const match = /^([A-Za-z0-9_]+)-([1-9][0-9]*)$/.exec(value.trim());
  if (!match) {
    throw new Error(
      "ProductName debe usar el formato NOMBRE_PRODUCTO-N, por ejemplo PROYECTO-1."
    );
  }
  return {
    name: match[1],
    signedProduct: match[1].replace(/_/g, " "),
    id: `#${match[2]}#`
  };
}

function updateProductIdPreview() {
  try {
    $("productIdPreview").value = parseProductIdentity($("productName").value).id;
  } catch {
    $("productIdPreview").value = "Formato inválido";
  }
}

async function loadGeneratorProduct() {
  const remote = await readFile(files.productName);
  if (!remote.content.trim()) {
    $("generatorProduct").value = "";
    throw new Error(
      `${files.productName} no existe o esta vacio en ${licenseAuthority.repository}.`
    );
  }

  const identity = parseProductIdentity(remote.content);
  $("generatorProduct").value = identity.signedProduct;
  return identity.signedProduct;
}

async function loadFull() {
  state.full = parseList((await readFile(files.full)).content);
  $("fullRows").replaceChildren(...state.full.map(entry => row([
    entry.hardwareId, entry.comment,
    button("Eliminar", "danger", () => askDelete("full", entry.hardwareId))
  ], () => { $("fullHwid").value = entry.hardwareId; $("fullComment").value = entry.comment; })));
  status(`${state.full.length} licencias Premium FULL cargadas.`, "success");
}

async function saveFull() {
  const hardwareId = $("fullHwid").value.trim();
  if (!hardwareId) throw new Error("Introduce un Hardware ID.");
  const existing = state.full.find(x => x.hardwareId.toLowerCase() === hardwareId.toLowerCase());
  if (existing) existing.comment = $("fullComment").value.trim();
  else state.full.push({ hardwareId, comment: $("fullComment").value.trim() });
  await writeFile(files.full, serializeList(state.full), `${existing ? "Update" : "Add"} Premium FULL ${hardwareId}`);
  await loadFull();
}

async function generateSignedLicense() {
  requireConnection();
  const hardwareId = $("generatorHwid").value.trim();
  const client = $("generatorClient").value.trim();
  const product = await loadGeneratorProduct();
  if (!/^[A-Za-z0-9-]{10,200}$/.test(hardwareId)) {
    throw new Error("Introduce un Hardware ID válido.");
  }
  if (!client) throw new Error("Introduce el nombre del cliente.");

  const requestId = crypto.randomUUID();
  $("generatedLicense").value = "";
  status(
    `Autorizando el HWID en ${licenseAuthority.repository}...`,
    ""
  );
  const authorityBranch = await authorizeSignedPremium(hardwareId, client);
  status("HWID autorizado. Solicitando la firma...", "");

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
          product
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

async function copyGeneratedLicense() {
  const license = $("generatedLicense").value.trim();
  if (!license) throw new Error("Primero genera una licencia.");
  await navigator.clipboard.writeText(license);
  status("Clave de activación copiada.", "success");
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function loadTemporary() {
  const [enabled, defaults, list] = await Promise.all([
    readFile(files.tempEnabled), readFile(files.tempDefaultDays), readFile(files.temporary)
  ]);
  $("tempEnabled").checked = enabled.content.trim().toLowerCase() !== "false" && !!list.content.trim();
  const defaultDays = Number(defaults.content.trim()) || 7;
  $("tempDefaultDays").value = defaultDays;
  $("tempDays").value = defaultDays;
  state.temporary = parseTemporary(list.content);
  $("tempRows").replaceChildren(...state.temporary.map(entry => {
    const expiry = new Date(new Date(entry.activationUtc).getTime() + entry.days * 86400000).toISOString();
    return row([entry.hardwareId, entry.activationUtc, String(entry.days), expiry, entry.comment,
      button("Eliminar", "danger", () => askDelete("temporary", entry.hardwareId))
    ], () => {
      $("tempHwid").value = entry.hardwareId; $("tempComment").value = entry.comment;
      $("tempDays").value = entry.days; $("tempRestart").checked = false;
    });
  }));
  status(`${state.temporary.length} licencias Premium temporales cargadas.`, "success");
}

async function saveTempConfig() {
  await Promise.all([
    writeFile(files.tempEnabled, `${$("tempEnabled").checked ? "True" : "False"}\n`, "Update Premium HWID enabled state"),
    writeFile(files.tempDefaultDays, `${validDays("tempDefaultDays")}\n`, "Update Premium HWID default duration")
  ]);
  await loadTemporary();
  status("Configuración Premium temporal guardada y verificada.", "success");
}

async function saveTemporary() {
  const hardwareId = $("tempHwid").value.trim();
  if (!hardwareId) throw new Error("Introduce un Hardware ID.");
  const days = validDays("tempDays");
  let entry = state.temporary.find(x => x.hardwareId.toLowerCase() === hardwareId.toLowerCase());
  if (!entry) {
    entry = { hardwareId, activationUtc: new Date().toISOString(), days, comment: "" };
    state.temporary.push(entry);
  } else if ($("tempRestart").checked) entry.activationUtc = new Date().toISOString();
  entry.days = days;
  entry.comment = $("tempComment").value.trim();
  await Promise.all([
    writeFile(files.tempEnabled, "True\n", "Enable Premium HWID licenses"),
    writeFile(files.tempDefaultDays, `${validDays("tempDefaultDays")}\n`, "Ensure Premium HWID default duration"),
    writeFile(files.temporary, serializeTemporary(state.temporary), `Update temporary Premium ${hardwareId}`)
  ]);
  await loadTemporary();
}

async function loadPremiumFree() {
  const [enabled, days] = await Promise.all([readFile(files.premiumFreeEnabled), readFile(files.premiumFreeDays)]);
  $("premiumFreeEnabled").checked = enabled.content.trim().toLowerCase() === "true";
  $("premiumFreeDays").value = Number(days.content.trim()) || 7;
  status("Configuración Premium-Free cargada.", "success");
}
async function savePremiumFree() {
  await Promise.all([
    writeFile(files.premiumFreeEnabled, `${$("premiumFreeEnabled").checked ? "True" : "False"}\n`, "Update Premium-Free enabled state"),
    writeFile(files.premiumFreeDays, `${validDays("premiumFreeDays")}\n`, "Update Premium-Free duration")
  ]);
  await loadPremiumFree();
  status("Premium-Free actualizado y verificado.", "success");
}

async function loadFree() {
  const [enabled, days, product] = await Promise.all([readFile(files.freeEnabled), readFile(files.freeDays), readFile(files.productName)]);
  $("freeEnabled").checked = enabled.content.trim().toLowerCase() === "true";
  $("freeDays").value = Number(days.content.trim()) || 7;
  if (product.content.trim()) {
    $("productName").value = product.content.trim();
    $("generatorProduct").value =
      parseProductIdentity(product.content).signedProduct;
  }
  updateProductIdPreview();
  status("Configuración FreeTrial cargada.", "success");
}
async function saveFree() {
  const product = $("productName").value.trim();
  parseProductIdentity(product);
  await Promise.all([
    writeFile(files.freeEnabled, `${$("freeEnabled").checked ? "True" : "False"}\n`, "Update FreeTrial enabled state"),
    writeFile(files.freeDays, `${validDays("freeDays")}\n`, "Update FreeTrial duration"),
    writeFile(files.productName, `${product}\n`, "Update license ProductName")
  ]);
  await loadFree();
  status("FreeTrial actualizado y verificado.", "success");
}

function validDays(id) {
  const value = Number($(id).value);
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error("Los días deben estar entre 1 y 3650.");
  return value;
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
    await writeFile(files.full, serializeList(state.full), `Remove Premium FULL ${pending.hardwareId}`);
    await loadFull();
  } else {
    state.temporary = state.temporary.filter(x => x.hardwareId.toLowerCase() !== pending.hardwareId.toLowerCase());
    await writeFile(files.temporary, serializeTemporary(state.temporary), `Remove temporary Premium ${pending.hardwareId}`);
    await loadTemporary();
  }
}

async function loadActivePanel() {
  const active = document.querySelector(".panel.active").id;
  const loaders = {
    full: loadFull,
    generator: async () => {
      const product = await loadGeneratorProduct();
      status(`Generador Premium FULL listo para ${product}.`, "success");
    },
    temporary: loadTemporary,
    premiumFree: loadPremiumFree,
    freeTrial: loadFree
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
  "load-temporary": loadTemporary, "save-temp-config": saveTempConfig, "save-temporary": saveTemporary,
  "load-premium-free": loadPremiumFree, "save-premium-free": savePremiumFree,
  "load-free": loadFree, "save-free": saveFree
};
document.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", () => run(actions[el.dataset.action])));
$("connect").addEventListener("click", () => run(connect));
$("cancelDelete").addEventListener("click", () => $("confirmDialog").close());
$("confirmDelete").addEventListener("click", () => run(confirmDelete));
$("productName").addEventListener("input", updateProductIdPreview);
updateProductIdPreview();
window.addEventListener("pagehide", () => { state.token = ""; $("token").value = ""; });
