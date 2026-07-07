const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8787;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ROOT = __dirname;

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
  };
  const type = types[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

function stripJsonFence(text) {
  return text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '');
}

async function analyzeNote(payload) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY missing on server');
  }

  const { title = '', note = '', model = OPENAI_MODEL } = payload || {};
  const prompt = [
    'Tu es un assistant de prise de notes pour un DAF. Retourne STRICTEMENT du JSON valide, sans markdown.',
    'Schéma attendu: {"theme":"...","company_hint":"...","summary":"...","questions":["...","..."]}',
    'Règles: theme doit être un seul mot parmi Admin, Financier, Légal, RH, Commercial, Logistique, Achats, Immobilier, IT, Stratégique, Autre.',
    'company_hint doit être un nom de société si identifiable sinon chaîne vide.',
    'summary doit être une synthèse courte et opérationnelle.',
    'questions doit contenir 3 à 5 questions utiles, orientées risques, délais, validation, finance, juridique ou admin.',
    '',
    `Titre: ${title || '(sans titre)'}`,
    `Note: ${note || '(vide)'}`
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.2,
      max_output_tokens: 500
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI ${response.status}: ${text.slice(0, 240)}`);
  }

  const data = await response.json();
  const textOutput = extractText(data);
  const result = JSON.parse(stripJsonFence(textOutput));
  return result;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    res.end();
    return;
  }

  if (pathname === '/api/analyze' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      try {
        const payload = raw ? JSON.parse(raw) : {};
        const result = await analyzeNote(payload);
        send(res, 200, result);
      } catch (error) {
        send(res, 500, { error: error.message || String(error) });
      }
    });
    return;
  }

  const target = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT, target);
  if (filePath.startsWith(ROOT) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveFile(res, filePath);
    return;
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Notes Assistant server running on http://localhost:${PORT}`);
});
