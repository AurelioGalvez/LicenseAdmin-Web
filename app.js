"use strict";

const state = { token: "", owner: "", repo: "", branch: "main", full: [], temporary: [], pendingDelete: null };
const $ = id => document.getElementById(id);
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

function contentUrl(path) {
  const escaped = path.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents/${escaped}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      ...apiHeaders(),
      "Cache-Control": "no-cache",
      ...(options.headers || {})
    }
  });
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
  state.repo = $("repository").value.trim();
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
  const response = await fetch(`${contentUrl(path)}?${query}`, {
    cache: "no-store",
    headers: {
      ...apiHeaders(),
      "Cache-Control": "no-cache"
    }
  });
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
  if (product.content.trim()) $("productName").value = product.content.trim();
  status("Configuración FreeTrial cargada.", "success");
}
async function saveFree() {
  const product = $("productName").value.trim();
  if (!product) throw new Error("ProductName no puede estar vacío.");
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
  return ({ full: loadFull, temporary: loadTemporary, premiumFree: loadPremiumFree, freeTrial: loadFree })[active]();
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
  "load-temporary": loadTemporary, "save-temp-config": saveTempConfig, "save-temporary": saveTemporary,
  "load-premium-free": loadPremiumFree, "save-premium-free": savePremiumFree,
  "load-free": loadFree, "save-free": saveFree
};
document.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", () => run(actions[el.dataset.action])));
$("connect").addEventListener("click", () => run(connect));
$("cancelDelete").addEventListener("click", () => $("confirmDialog").close());
$("confirmDelete").addEventListener("click", () => run(confirmDelete));
window.addEventListener("pagehide", () => { state.token = ""; $("token").value = ""; });
