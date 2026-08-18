'use strict';
const test = require('node:test');
const assert = require('node:assert');
const core = require('../core.js');

test('parseNum / toNumber 基本解析', () => {
  assert.strictEqual(core.parseNum('1,234.5'), 1234.5);
  assert.strictEqual(core.parseNum(''), null);
  assert.strictEqual(core.parseNum('abc'), null);
  assert.strictEqual(core.parseNum('0'), 0);
  assert.strictEqual(core.toNumber(undefined, 7.2), 7.2);
  assert.strictEqual(core.toNumber('3.5'), 3.5);
});

test('fmtMoney 分币种小数位', () => {
  assert.strictEqual(core.fmtMoney(1234.5, 'USD'), '$1,234.50');
  assert.strictEqual(core.fmtMoney(1234.5, 'CNY'), '¥1,234.50');
  assert.strictEqual(core.fmtMoney(12345, 'JPY'), '¥12,345');
  assert.strictEqual(core.fmtMoney(null, 'USD'), '—');
  assert.strictEqual(core.fmtMoney(-5, 'USD'), '-$5.00');
});

test('体积重计算：按 6000 除数', () => {
  assert.strictEqual(core.volumetricWeight(60, 40, 50, 6000), 20);
  assert.strictEqual(core.volumetricWeight(60, 40, 50, 5000), 24);
  assert.strictEqual(core.volumetricWeight(0, 0, 0, 6000), 0);
});

test('计费重取实重与体积重最大值', () => {
  assert.strictEqual(core.billableWeight(25, 20), 25);
  assert.strictEqual(core.billableWeight(15, 20), 20);
});

test('承运商运费：基础费+每公斤+操作费+燃油', () => {
  const shipment = { actualKg: 1.25, l: 15, w: 10, h: 5, divisor: 6000 };
  const carrier = { name: 'DHL', baseFee: 0, perKg: 45, handling: 0, fuelPct: 25, minCharge: 0 };
  // 体积重 = 15*10*5/6000 = 1.25, 计费重 1.25
  // freight = 1.25*45 = 56.25; fuel = 14.0625; final = 70.31
  const r = core.carrierCost(shipment, carrier);
  assert.strictEqual(r.billableKg, 1.25);
  assert.strictEqual(r.final, 70.31);
});

test('承运商运费：最低消费约束', () => {
  const shipment = { actualKg: 0.1, l: 10, w: 10, h: 10, divisor: 6000 };
  const carrier = { name: 'X', baseFee: 0, perKg: 40, handling: 0, fuelPct: 0, minCharge: 50 };
  const r = core.carrierCost(shipment, carrier);
  assert.strictEqual(r.final, 50);
});

test('多承运商比价结果按费用升序', () => {
  const shipment = {
    actualKg: 2, l: 30, w: 20, h: 20, divisor: 6000,
    carriers: [
      { name: '贵', baseFee: 0, perKg: 60, handling: 0, fuelPct: 0, minCharge: 0 },
      { name: '便宜', baseFee: 0, perKg: 30, handling: 0, fuelPct: 0, minCharge: 0 }
    ]
  };
  const list = core.compareCarriers(shipment);
  assert.strictEqual(list[0].carrier, '便宜');
  assert.ok(list[0].final < list[1].final);
});

test('normalizeFx 解析汇率响应并重定基准', () => {
  const raw = { rates: { CNY: 7.2, USD: 1, EUR: 0.9 }, date: '2026-08-18' };
  const fx = core.normalizeFx(raw, 'CNY', 'test');
  assert.strictEqual(fx.base, 'CNY');
  assert.strictEqual(fx.rates.CNY, 1);
  assert.strictEqual(fx.source, 'test');

  const fxUsd = core.normalizeFx(raw, 'USD', 'test');
  assert.strictEqual(fxUsd.base, 'USD');
  assert.strictEqual(fxUsd.rates.USD, 1);
  assert.strictEqual(fxUsd.rates.CNY, 7.2);

  assert.strictEqual(core.normalizeFx({}, 'CNY', 'x'), null);
});

test('convert 货币换算', () => {
  const rates = { CNY: 1, USD: 7.2, JPY: 0.048 };
  assert.strictEqual(core.convert(100, 'USD', 'CNY', rates), 100 / 7.2);
  assert.strictEqual(core.convert(100, 'CNY', 'USD', rates), 720);
  assert.strictEqual(core.convert(100, 'USD', 'USD', rates), 100);
  assert.strictEqual(core.convert(100, 'USD', 'XXX', rates), null);
});

test('computeItem：目标利润率反推建议售价（闭式解）', () => {
  // 固定成本 CNY=45+2+1.5+55+0=103.5; 汇率7.2 => 14.375 报价币
  // 变动费率 = 15%+2.5%+5%+1% = 23.5%
  // 建议售价 = 14.375 / (1-0.235-0.20) = 14.375/0.565 = 25.44
  const r = core.computeItem({
    unitCost: 45, packaging: 2, domestic: 1.5, freight: 55, otherFixed: 0,
    rate: 7.2, tariffPct: 0, commissionPct: 15, paymentPct: 2.5,
    adPct: 5, fxBufferPct: 1, otherVarPct: 0, targetMarginPct: 20
  });
  assert.strictEqual(r.fixedCNY, 103.5);
  assert.strictEqual(r.fixedQuote, 14.38);
  assert.strictEqual(r.varPct, 0.235);
  assert.strictEqual(r.hasSuggestion, true);
  assert.strictEqual(r.suggestedPrice, 25.45);
  // 在该售价下利润率应约等于 20%
  assert.ok(Math.abs(r.marginPct - 0.2) < 0.001);
});

test('computeItem：指定售价正向核算利润', () => {
  const r = core.computeItem({
    unitCost: 45, packaging: 2, domestic: 1.5, freight: 55, otherFixed: 0,
    rate: 7.2, tariffPct: 0, commissionPct: 15, paymentPct: 2.5,
    adPct: 5, fxBufferPct: 1, otherVarPct: 0, targetMarginPct: 20,
    price: 25.44
  });
  // profit = 25.44 - 14.38 - 0.235*25.44 = 5.0816 -> 5.08
  assert.strictEqual(r.profit, 5.08);
  assert.ok(Math.abs(r.marginPct - 0.2) < 0.002);
  assert.strictEqual(r.isLoss, false);
});

test('computeItem：关税计入固定成本（计税基数=自动）', () => {
  const r = core.computeItem({
    unitCost: 100, packaging: 0, domestic: 0, freight: 0, otherFixed: 0,
    rate: 7.2, tariffPct: 3, commissionPct: 0, paymentPct: 0, adPct: 0,
    fxBufferPct: 0, otherVarPct: 0, targetMarginPct: 0
  });
  // fixedQuote = 100/7.2 = 13.8889; duty = 13.8889*3% = 0.4167; totalFixed = 14.31
  assert.strictEqual(r.customsBase, 13.89);
  assert.strictEqual(r.duty, 0.42);
  assert.strictEqual(r.totalFixed, 14.31);
});

test('computeItem：变动费率≥100% 时无保本价与建议价', () => {
  const r = core.computeItem({
    unitCost: 10, rate: 7.2, commissionPct: 60, paymentPct: 50,
    adPct: 0, fxBufferPct: 0, otherVarPct: 0, targetMarginPct: 10
  });
  assert.strictEqual(r.varPct, 1.1);
  assert.strictEqual(r.breakEvenPrice, null);
  assert.strictEqual(r.suggestedPrice, null);
  assert.strictEqual(r.hasSuggestion, false);
});

test('computeItem：价格≤0 时利润为空，不产生 NaN', () => {
  const r = core.computeItem({
    unitCost: 10, rate: 7.2, price: 0
  });
  assert.strictEqual(r.profit, null);
  assert.strictEqual(r.marginPct, null);
});

test('fxScenarios：汇率敏感性分析', () => {
  const base = {
    unitCost: 45, packaging: 2, domestic: 1.5, freight: 55, otherFixed: 0,
    rate: 7.2, tariffPct: 0, commissionPct: 15, paymentPct: 2.5,
    adPct: 5, fxBufferPct: 1, otherVarPct: 0, targetMarginPct: 20
  };
  const price = core.computeItem(base).suggestedPrice;
  const list = core.fxScenarios(base, price);
  assert.strictEqual(list.length, 6);
  assert.strictEqual(list[0].factor, 1);
  // 人民币升值（rate 下降）时固定成本换算为报价币增加 -> 利润下降
  assert.ok(list[0].marginPct > list[2].marginPct);
  assert.ok(list[5].marginPct > list[0].marginPct);
});

test('makeQuoteNo 生成编号', () => {
  const no = core.makeQuoteNo('QT', 5);
  assert.match(no, /^QT-\d{8}-005$/);
});

test('buildQuote 报价单聚合', () => {
  const q = core.buildQuote({
    quoteNo: 'QT-1', issueDate: '2026-08-18',
    company: { name: 'ACME' }, customer: { name: 'Buyer' },
    currency: 'USD', rate: 7.2,
    items: [
      { description: 'A', qty: 2, price: 10 },
      { description: 'B', qty: 3, price: 5.5 }
    ],
    terms: { tradeTerm: 'FOB' }
  });
  assert.strictEqual(q.rows.length, 2);
  assert.strictEqual(q.total, 36.5);
  assert.strictEqual(q.totalCNY, 262.8);
});

test('fmtPct 分数转百分数', () => {
  assert.strictEqual(core.fmtPct(0.2), '20.0%');
  assert.strictEqual(core.fmtPct(null), '—');
});