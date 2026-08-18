'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {}

const it = (name, fn) => test(name, { skip: !JSDOM ? 'jsdom 未安装（可选：npm i -D jsdom 后启用 DOM e2e）' : false }, fn);

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const coreJs = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function bootDom(overrides) {
  overrides = overrides || {};
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://localhost:8080/',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.fetch = overrides.fetch || function (url) {
    if (url === '/api/fx') {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ data: { base: 'CNY', date: '2026-08-18', rates: { USD: 0.15, EUR: 0.12, JPY: 23, GBP: 0.11, HKD: 1.17, CNY: 1 } }, source: 'mock', cached: false })
      });
    }
    return Promise.reject(new Error('unexpected fetch ' + url));
  };
  w.confirm = function () { return true; };
  w.print = function () {};
  if (w.URL.createObjectURL === undefined) {
    w.URL.createObjectURL = function () { return 'blob:mock'; };
    w.URL.revokeObjectURL = function () {};
  }
  if (overrides.beforeEval) overrides.beforeEval(w);
  w.eval(coreJs);
  w.eval(appJs);
  return dom;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

it('页面加载：核心对象与初始渲染', async () => {
  const dom = bootDom();
  const w = dom.window;
  await wait(30);
  assert.ok(w.TradeCalcCore, 'TradeCalcCore 已挂载');
  const result = w.document.querySelector('#q-result');
  assert.ok(result && result.innerHTML.length > 0, '核算结果区已渲染');
  const billable = w.document.querySelector('#s-billable');
  assert.ok(billable, '物流模块渲染');
  w.close();
});

it('载入示例后：建议售价/利润率正确显示', async () => {
  const dom = bootDom();
  const w = dom.window;
  await wait(30);
  w.document.querySelector('#btnLoadDemo').click();
  await wait(50);
  const result = w.document.querySelector('#q-result').textContent;
  assert.match(result, /建议售价/, '含建议售价');
  assert.match(result, /保本价/, '含保本价');
  assert.match(result, /汇率敏感性/, '含敏感性分析');
  assert.match(result, /利润率/, '含利润率');
  assert.ok(!w.document.querySelector('#fxStatus.err'), 'fx 状态正常');
  w.close();
});

it('报价单打印内容生成', async () => {
  const dom = bootDom();
  const w = dom.window;
  await wait(30);
  w.document.querySelector('#btnLoadDemo').click();
  await wait(50);
  w.document.querySelector('#t-company').value = 'Acme Ltd';
  w.document.querySelector('#t-company').dispatchEvent(new w.Event('input'));
  w.document.querySelector('#t-buyerCompany').value = 'Buyer Inc';
  w.document.querySelector('#t-buyerCompany').dispatchEvent(new w.Event('input'));
  w.document.querySelector('#t-genNo').click();
  w.document.querySelector('#t-print').click();
  await wait(100);
  const pa = w.document.querySelector('#printArea').innerHTML;
  assert.match(pa, /QUOTATION/, '报价单标题');
  assert.match(pa, /Acme Ltd/, '公司名');
  assert.match(pa, /Buyer Inc/, '客户名');
  assert.match(pa, /QT-/, '报价单号');
  assert.match(pa, /Total:/, '合计');
  w.close();
});

it('运费模块：输入尺寸后计算体积重', async () => {
  const dom = bootDom();
  const w = dom.window;
  await wait(30);
  const setVal = (sel, val) => {
    const el = w.document.querySelector(sel);
    el.value = val;
    el.dispatchEvent(new w.Event('input'));
  };
  setVal('#s-actual', '1');
  setVal('#s-l', '30');
  setVal('#s-w', '20');
  setVal('#s-h', '20');
  await wait(20);
  assert.strictEqual(w.document.querySelector('#s-vol').textContent, '2 kg');
  assert.strictEqual(w.document.querySelector('#s-billable').textContent, '2 kg');
  w.close();
});

it('汇率表渲染为手动覆盖提供输入框', async () => {
  const dom = bootDom();
  const w = dom.window;
  await wait(30);
  const rows = w.document.querySelectorAll('#fx-tbody tr');
  assert.ok(rows.length >= 10, '汇率表有足够行');
  const usdInput = w.document.querySelector('#fx-tbody input[data-code="USD"]');
  assert.ok(usdInput, 'USD 行存在');
  assert.ok(parseFloat(usdInput.value) > 0, 'USD 汇率已自动填充');
  w.close();
});

it('离线降级：汇率源失败时显示错误提示', async () => {
  const dom = bootDom({
    fetch: function () { return Promise.reject(new Error('network down')); }
  });
  const w = dom.window;
  await wait(30);
  assert.ok(w.document.querySelector('#fxStatus.err'), '离线状态标记');
  assert.match(w.document.querySelector('#fxStatusText').textContent, /不可用/);
  w.close();
});

it('报价明细首行单价与核算价联动', async () => {
  const dom = bootDom();
  const w = dom.window;
  await wait(30);
  w.document.querySelector('#btnLoadDemo').click();
  await wait(80);
  const qText = w.document.querySelector('#q-result').textContent;
  const m = qText.match(/建议售价[^$]*\$([\d.]+)/);
  assert.ok(m, '能读到建议售价: ' + qText.slice(0, 60));
  const suggested = parseFloat(m[1]);
  const totalText = w.document.querySelector('#t-total').textContent;
  const total = parseFloat(totalText.replace(/[^0-9.]/g, ''));
  assert.strictEqual(total, 500 * suggested, '总价 = 数量 x 联动单价');
  w.close();
});

it('打印 HTML 含完整条款与合计', async () => {
  const dom = bootDom();
  const w = dom.window;
  await wait(30);
  w.document.querySelector('#btnLoadDemo').click();
  await wait(50);
  const set = (sel, val) => {
    const el = w.document.querySelector(sel);
    el.value = val;
    el.dispatchEvent(new w.Event('input'));
  };
  set('#t-company', 'Acme Trading Co.');
  set('#t-buyerCompany', 'Buyer Inc.');
  set('#t-remarks', 'Warranty 12 months.');
  w.document.querySelector('#t-genNo').click();
  w.document.querySelector('#t-print').click();
  await wait(80);
  const pa = w.document.querySelector('#printArea').innerHTML;
  assert.match(pa, /Acme Trading Co\./, '卖方');
  assert.match(pa, /Buyer Inc\./, '买方');
  assert.match(pa, /QUOTATION/, '标题');
  assert.match(pa, /QT-\d{8}-\d{3}/, '编号');
  assert.match(pa, /Warranty 12 months\./, '备注');
  assert.match(pa, /Trade Term/, '贸易条款');
  assert.match(pa, /USD/, '币种');
  w.close();
});

it('「取物流模块」把最低承运商费用填入运费', async () => {
  const dom = bootDom();
  const w = dom.window;
  await wait(30);
  w.document.querySelector('#btnLoadDemo').click();
  await wait(50);
  w.document.querySelector('#q-fillFromShipping').click();
  await wait(30);
  // 示例：实重0.3kg，体积重0.125kg(按实重计费)，美国专线 5+0.3*25=12.5 最省
  assert.strictEqual(w.document.querySelector('#q-freight').value, '12.5');
  w.close();
});

it('数据导出产生 JSON 下载', async () => {
  const dom = bootDom();
  const w = dom.window;
  await wait(30);
  let downloaded = null;
  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = function (tag) {
    const el = origCreate(tag);
    if (tag === 'a') {
      el.click = function () { downloaded = el.download || null; };
    }
    return el;
  };
  w.document.querySelector('#d-export').click();
  await wait(20);
  assert.ok(downloaded && /tradecalc-backup/.test(downloaded), '导出文件名正确: ' + downloaded);
  w.close();
});