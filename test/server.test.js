'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createHandler } = require('../server.js');

function withServer(mockFx, fn) {
  const server = http.createServer(createHandler({ loadFx: mockFx }));
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;
      const done = (val) => { server.close(); resolve(val); };
      fn(base).then(done, (e) => { server.close(); reject(e); });
    });
  });
}

function getJson(url) {
  return fetch(url).then((r) => r.json());
}
function getText(url) {
  return fetch(url).then((r) => ({ status: r.status, text: r.text() }));
}

test('GET /api/fx 返回汇率 JSON（mock 成功路径）', async () => {
  const mock = () => Promise.resolve({ data: { base: 'CNY', rates: { USD: 7.2 } }, source: 'mock', fetchedAt: 'x', cached: false });
  const out = await withServer(mock, async (base) => {
    const j = await getJson(base + '/api/fx');
    return j;
  });
  assert.strictEqual(out.source, 'mock');
  assert.strictEqual(out.data.rates.USD, 7.2);
});

test('GET /api/fx 上游全部失败时返回 502 + 错误信息', async () => {
  const mock = () => Promise.reject(new Error('network down'));
  const out = await withServer(mock, async (base) => {
    const res = await fetch(base + '/api/fx');
    return { status: res.status, body: await res.json() };
  });
  assert.strictEqual(out.status, 502);
  assert.match(out.body.error, /不可用/);
});

test('GET / 返回 index.html', async () => {
  const mock = () => Promise.reject(new Error('n/a'));
  const out = await withServer(mock, async (base) => {
    const res = await fetch(base + '/');
    const text = await res.text();
    return { status: res.status, text };
  });
  assert.strictEqual(out.status, 200);
  assert.match(out.text, /外贸智算台/);
});

test('GET /core.js 返回可执行 JS', async () => {
  const mock = () => Promise.reject(new Error('n/a'));
  const out = await withServer(mock, async (base) => {
    const res = await fetch(base + '/core.js');
    return { status: res.status, text: await res.text() };
  });
  assert.strictEqual(out.status, 200);
  assert.match(out.text, /TradeCalcCore/);
});

test('GET /nonexistent 返回 404', async () => {
  const mock = () => Promise.reject(new Error('n/a'));
  const out = await withServer(mock, async (base) => {
    const res = await fetch(base + '/nope.js');
    return { status: res.status };
  });
  assert.strictEqual(out.status, 404);
});

test('路径穿越被拦截返回 403', async () => {
  const mock = () => Promise.reject(new Error('n/a'));
  const out = await withServer(mock, async (base) => {
    const res = await fetch(base + '/..%2fserver.js');
    return { status: res.status };
  });
  assert.ok(out.status === 403 || out.status === 400 || out.status === 404);
});