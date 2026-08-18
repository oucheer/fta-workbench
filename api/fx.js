'use strict';

const FX_SOURCES = [
  { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/CNY' },
  { name: 'frankfurter.app', url: 'https://api.frankfurter.app/latest?base=CNY' }
];

const cache = { data: null, at: 0, ttl: 15 * 60 * 1000 };

function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
  return fetch(url, { signal: ctrl.signal })
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .finally(() => clearTimeout(timer));
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
    fxLoader()
      .then((r) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.statusCode = 200;
        res.end(JSON.stringify(r));
      })
      .catch((e) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 502;
        res.end(JSON.stringify({ error: '汇率源不可用，请检查网络或稍后重试', detail: e.message }));
      });
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.loadFx = loadFx;

module.exports = handler;