'use strict';
const https = require('https');
const http = require('http');

const FX_SOURCES = [
  { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/CNY' },
  { name: 'frankfurter.app', url: 'https://api.frankfurter.app/latest?base=CNY' }
];

const cache = { data: null, at: 0, ttl: 15 * 60 * 1000 };

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
    const respond = (statusCode, payload) => {
      try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.statusCode = statusCode;
        res.end(JSON.stringify(payload));
      } catch (e) { /* ignore */ }
    };
    Promise.resolve()
      .then(() => fxLoader())
      .then((r) => respond(200, r))
      .catch((e) => respond(502, { error: '汇率源不可用，请检查网络或稍后重试', detail: e.message }));
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.loadFx = loadFx;

module.exports = handler;