'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT, 10) || 8080;

const FX_SOURCES = [
  { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/CNY' },
  { name: 'frankfurter.app', url: 'https://api.frankfurter.app/latest?base=CNY' }
];

const cache = { data: null, at: 0, ttl: 15 * 60 * 1000 };

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain'
};

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 8000, () => req.destroy(new Error('timeout')));
  });
}

function loadFx(now) {
  now = now || Date.now();
  if (cache.data && now - cache.at < cache.ttl) {
    return Promise.resolve({ data: cache.data, source: cache.source, fetchedAt: cache.fetchedAt, cached: true });
  }
  let chain = Promise.reject(new Error('start'));
  FX_SOURCES.forEach((s) => {
    chain = chain.catch(() =>
      fetchJson(s.url, 8000).then((raw) => {
        if (!raw || !raw.rates) throw new Error('no rates in response');
        cache.data = { base: 'CNY', rates: raw.rates, date: raw.date || raw.time_last_update_utc || null };
        cache.source = s.name;
        cache.fetchedAt = new Date().toISOString();
        cache.at = Date.now();
        return { data: cache.data, source: s.name, fetchedAt: cache.fetchedAt, cached: false };
      })
    );
  });
  return chain.catch((err) => {
    if (cache.data) {
      return { data: cache.data, source: 'cache(offline)', fetchedAt: cache.fetchedAt, cached: true, offline: true };
    }
    throw err;
  });
}

function createHandler(deps) {
  const fxLoader = (deps && deps.loadFx) || loadFx;

  return function handler(req, res) {
    const url = String(req.url || '/').split('?')[0];

    if (url === '/api/fx') {
      fxLoader()
        .then((r) => {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(r));
        })
        .catch((e) => {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: '汇率源不可用，请检查网络或稍后重试', detail: e.message }));
        });
      return;
    }

    const rel = url === '/' ? '/index.html' : url;
    const fp = path.normalize(path.join(ROOT, rel));
    if (!fp.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.readFile(fp, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      const mime = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  };
}

function main() {
  const server = http.createServer(createHandler());
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[!] 端口 ${PORT} 已被占用，可用 PORT=xxxx npm start 指定其他端口`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║   外贸智算台 · TradeCalc Workbench                 ║');
    console.log('  ║   报价 · 物流 · 利润核算 · 汇率 · 报价单            ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  ➜ 打开浏览器访问:  http://localhost:${PORT}`);
    console.log('');
  });
}

if (require.main === module) {
  main();
}

module.exports = { createHandler, loadFx, fetchJson, ROOT, PORT, cache };