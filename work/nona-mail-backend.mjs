import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const port = Number(process.env.NONA_MAIL_PORT || 8798);
const dataDir = path.resolve(process.env.NONA_DATA_DIR || path.join(process.cwd(), "nona-data"));
const notesPath = path.join(dataDir, "notes.json");
const statePath = path.join(dataDir, "mail-state.json");
const mailMode = (process.env.NONA_MAIL_MODE || "send").toLowerCase();
const mailTo = process.env.NONA_MAIL_TO || "t.larlet@brm.nc";

await fs.mkdir(dataDir, { recursive: true });

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  return Math.ceil((due - today) / 86400000);
}

function openNotes(notes) {
  return notes.filter(note => (note.status || "À traiter") !== "Terminé");
}

function alertNotes(notes) {
  return openNotes(notes).filter(note => {
    const days = daysUntil(note.dueDate);
    return days !== null && days >= 0 && days <= 10;
  });
}

function noteKey(note) {
  return `${note.id || note.title || "note"}:${note.dueDate || "no-date"}`;
}

function noteBody(note) {
  return [
    `Sujet: ${note.title || "Note à traiter"}`,
    `Société: ${note.company || "-"}`,
    `Échéance: ${formatDate(note.dueDate)}`,
    `Responsable: ${note.owner || "-"}`,
    `Risque: ${note.risk || "-"}`,
    `Montant: ${note.amount || "-"}`,
    "",
    "Action attendue:",
    "",
    "Résumé:",
    note.aiSummary || note.note || ""
  ].join("\r\n");
}

function monthlyDigestBody(notes) {
  const rows = openNotes(notes).map((note, index) => [
    `${index + 1}. ${note.title || "Note sans titre"}`,
    `   Société: ${note.company || "-"}`,
    `   Statut: ${note.status || "-"}`,
    `   Échéance: ${formatDate(note.dueDate)}`,
    `   Responsable: ${note.owner || "-"}`,
    `   Risque: ${note.risk || "-"}`,
    `   Montant: ${note.amount || "-"}`,
    `   Résumé: ${(note.aiSummary || note.note || "").replace(/\s+/g, " ").slice(0, 260)}`,
    ""
  ].join("\r\n"));

  return [
    "Bonjour,",
    "",
    "Voici la synthèse mensuelle des notes Nona non clôturées.",
    "",
    rows.length ? rows.join("\r\n") : "Aucune note ouverte.",
    "",
    "Bonne journée,"
  ].join("\r\n");
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function outlookMail({ subject, body }) {
  return new Promise((resolve, reject) => {
    const action = mailMode === "send" && mailTo ? "send" : "draft";
    const command = [
      "$ErrorActionPreference='Stop'",
      "$outlook=New-Object -ComObject Outlook.Application",
      "$mail=$outlook.CreateItem(0)",
      `$mail.Subject='${escapePowerShellString(subject)}'`,
      `$mail.Body='${escapePowerShellString(body)}'`,
      mailTo ? `$mail.To='${escapePowerShellString(mailTo)}'` : "",
      action === "send" ? "$mail.Send()" : "$mail.Save()",
      `"${action}"`
    ].filter(Boolean).join("; ");

    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", data => { stdout += data.toString(); });
    child.stderr.on("data", data => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code) reject(new Error(stderr || `PowerShell exited ${code}`));
      else resolve({ action, stdout: stdout.trim() });
    });
  });
}

async function runAlerts() {
  const { notes = [] } = await readJson(notesPath, { notes: [] });
  const state = await readJson(statePath, { sentAlerts: {}, sentMonths: {} });
  const sent = [];
  const skipped = [];

  for (const note of alertNotes(notes)) {
    const key = noteKey(note);
    if (state.sentAlerts[key]) {
      skipped.push(note.title || key);
      continue;
    }
    const result = await outlookMail({
      subject: `Alerte Nona J-10 - ${note.title || "note à traiter"}`,
      body: noteBody(note)
    });
    state.sentAlerts[key] = new Date().toISOString();
    sent.push({ title: note.title || key, result });
  }

  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  return { sent, skipped };
}

async function runMonthlyDigest(force = false) {
  const { notes = [] } = await readJson(notesPath, { notes: [] });
  const state = await readJson(statePath, { sentAlerts: {}, sentMonths: {} });
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (!force && state.sentMonths[monthKey]) {
    return { sent: false, reason: "already-sent", monthKey };
  }

  const result = await outlookMail({
    subject: `Nona - notes non clôturées ${monthKey}`,
    body: monthlyDigestBody(notes)
  });
  state.sentMonths[monthKey] = new Date().toISOString();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  return { sent: true, monthKey, result };
}

async function syncNotes(payload) {
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  const companies = Array.isArray(payload.companies) ? payload.companies : [];
  await fs.writeFile(notesPath, JSON.stringify({
    syncedAt: new Date().toISOString(),
    notes,
    companies
  }, null, 2), "utf8");
  return { ok: true, notes: notes.length, companies: companies.length };
}

async function status() {
  const data = await readJson(notesPath, { notes: [] });
  const state = await readJson(statePath, { sentAlerts: {}, sentMonths: {} });
  return {
    ok: true,
    mode: mailMode === "send" && mailTo ? "send" : "draft",
    mailTo: mailTo || null,
    notes: data.notes?.length || 0,
    openNotes: openNotes(data.notes || []).length,
    alertNotes: alertNotes(data.notes || []).length,
    sentAlerts: Object.keys(state.sentAlerts || {}).length,
    sentMonths: Object.keys(state.sentMonths || {}).length
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/status") return json(res, 200, await status());
    if (req.method === "POST" && url.pathname === "/api/sync-notes") return json(res, 200, await syncNotes(await readBody(req)));
    if (req.method === "POST" && url.pathname === "/api/run-alerts") return json(res, 200, await runAlerts());
    if (req.method === "POST" && url.pathname === "/api/monthly-digest") return json(res, 200, await runMonthlyDigest(url.searchParams.get("force") === "1"));

    return json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Nona mail backend on http://127.0.0.1:${port}`);
  console.log(`Mode: ${mailMode === "send" && mailTo ? "send" : "draft"}`);
});

setInterval(() => {
  runAlerts().catch(error => console.error("alerts", error.message));
}, 60 * 60 * 1000);

setInterval(() => {
  const now = new Date();
  if (now.getDate() === 1) runMonthlyDigest().catch(error => console.error("monthly", error.message));
}, 6 * 60 * 60 * 1000);
