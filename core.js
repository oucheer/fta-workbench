(function (global, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else global.TradeCalcCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CURRENCIES = {
    CNY: { label: '人民币', symbol: '¥', decimals: 2 },
    USD: { label: '美元', symbol: '$', decimals: 2 },
    EUR: { label: '欧元', symbol: '€', decimals: 2 },
    GBP: { label: '英镑', symbol: '£', decimals: 2 },
    JPY: { label: '日元', symbol: '¥', decimals: 0 },
    HKD: { label: '港币', symbol: 'HK$', decimals: 2 },
    AUD: { label: '澳元', symbol: 'A$', decimals: 2 },
    CAD: { label: '加元', symbol: 'C$', decimals: 2 },
    SGD: { label: '新加坡元', symbol: 'S$', decimals: 2 },
    CHF: { label: '瑞士法郎', symbol: 'CHF', decimals: 2 },
    NZD: { label: '新西兰元', symbol: 'NZ$', decimals: 2 },
    KRW: { label: '韩元', symbol: '₩', decimals: 0 },
    INR: { label: '印度卢比', symbol: '₹', decimals: 2 },
    RUB: { label: '卢布', symbol: '₽', decimals: 2 },
    BRL: { label: '雷亚尔', symbol: 'R$', decimals: 2 },
    MXN: { label: '墨西哥比索', symbol: 'MX$', decimals: 2 },
    AED: { label: '迪拉姆', symbol: 'AED', decimals: 2 },
    SAR: { label: '沙特里亚尔', symbol: 'SAR', decimals: 2 },
    TRY: { label: '土耳其里拉', symbol: '₺', decimals: 2 },
    THB: { label: '泰铢', symbol: '฿', decimals: 2 },
    MYR: { label: '林吉特', symbol: 'RM', decimals: 2 },
    IDR: { label: '印尼盾', symbol: 'Rp', decimals: 0 },
    VND: { label: '越南盾', symbol: '₫', decimals: 0 },
    PHP: { label: '菲律宾比索', symbol: '₱', decimals: 2 },
    PLN: { label: '波兰兹罗提', symbol: 'zł', decimals: 2 },
    CZK: { label: '捷克克朗', symbol: 'Kč', decimals: 2 },
    ZAR: { label: '南非兰特', symbol: 'R', decimals: 2 },
    TWD: { label: '新台币', symbol: 'NT$', decimals: 2 },
    NGN: { label: '尼日利亚奈拉', symbol: '₦', decimals: 2 },
    BDT: { label: '孟加拉塔卡', symbol: '৳', decimals: 2 },
    EGP: { label: '埃及镑', symbol: 'E£', decimals: 2 },
    COP: { label: '哥伦比亚比索', symbol: 'COP', decimals: 0 },
    CLP: { label: '智利比索', symbol: 'CLP', decimals: 0 },
    ARS: { label: '阿根廷比索', symbol: 'ARS', decimals: 2 },
    UAH: { label: '乌克兰格里夫纳', symbol: '₴', decimals: 2 }
  };

  var DEFAULT_RATE = 7.2;
  var CURRENCY_CODES = Object.keys(CURRENCIES);

  function toNumber(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) n = 0;
    return fallback !== undefined && n === 0 && typeof v === 'undefined' ? fallback : n;
  }

  function parseNum(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    if (s === '') return null;
    var n = Number(s.replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  function round2(n) {
    if (!isFinite(n)) return n;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function fmtMoney(v, code) {
    var c = CURRENCIES[code] || CURRENCIES.USD;
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var decimals = c.decimals;
    var s = Math.abs(v).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var sign = v < 0 ? '-' : '';
    return sign + (c.symbol ? c.symbol : '') + s;
  }

  function fmtPct(fraction, digits) {
    if (fraction === null || fraction === undefined || !isFinite(fraction)) return '—';
    var d = digits === undefined ? 1 : digits;
    return (fraction * 100).toFixed(d) + '%';
  }

  function volumetricWeight(l, w, h, divisor) {
    var d = toNumber(divisor, 6000);
    if (d <= 0) d = 6000;
    var L = toNumber(l), W = toNumber(w), H = toNumber(h);
    return round2((L * W * H) / d);
  }

  function billableWeight(actualKg, volKg) {
    return round2(Math.max(toNumber(actualKg), toNumber(volKg)));
  }

  function carrierCost(shipment, carrier) {
    var actual = toNumber(shipment.actualKg);
    var vol = volumetricWeight(shipment.l, shipment.w, shipment.h, shipment.divisor);
    var billable = billableWeight(actual, vol);
    var base = toNumber(carrier.baseFee);
    var perKg = toNumber(carrier.perKg);
    var handling = toNumber(carrier.handling);
    var fuel = toNumber(carrier.fuelPct) / 100;
    var minCharge = toNumber(carrier.minCharge);
    var freight = base + billable * perKg + handling;
    var fuelCost = freight * fuel;
    var final = freight + fuelCost;
    if (minCharge > 0 && final < minCharge) final = minCharge;
    return {
      carrier: carrier.name,
      actualKg: actual,
      volumetricKg: vol,
      billableKg: billable,
      usingVolumetric: vol > actual + 1e-9,
      freight: round2(freight),
      fuelCost: round2(fuelCost),
      fuelPct: fuel,
      final: round2(final)
    };
  }

  function compareCarriers(shipment) {
    var list = shipment.carriers || [];
    var results = list.map(function (c) { return carrierCost(shipment, c); });
    results.sort(function (a, b) { return a.final - b.final; });
    return results;
  }

  function normalizeFx(raw, base, source) {
    var src = raw && raw.rates;
    if (!src || typeof src !== 'object') return null;
    var rates = {};
    var baseCode = base || 'CNY';
    Object.keys(src).forEach(function (code) {
      var v = parseFloat(src[code]);
      if (isFinite(v) && v > 0) rates[code] = v;
    });
    if (rates[baseCode]) {
      var factor = 1 / rates[baseCode];
      Object.keys(rates).forEach(function (k) { rates[k] = round2(rates[k] * factor); });
    }
    if (!rates[baseCode]) rates[baseCode] = 1;
    return {
      base: baseCode,
      date: (raw && (raw.date || raw.time_last_update_utc || raw.time_last_update_unix)) || null,
      source: source || 'unknown',
      rates: rates,
      fetchedAt: new Date().toISOString()
    };
  }

  function convert(amount, from, to, rates) {
    if (from === to) return amount;
    var r = rates || {};
    var rf = r[from], rt = r[to];
    if (!rf || !rt || rf <= 0 || rt <= 0) return null;
    return amount * (rt / rf);
  }

  function computeItem(input) {
    input = input || {};
    var rate = toNumber(input.rate, DEFAULT_RATE);
    if (rate <= 0) rate = DEFAULT_RATE;

    var unitCost = toNumber(input.unitCost);
    var packaging = toNumber(input.packaging);
    var domestic = toNumber(input.domestic);
    var freight = toNumber(input.freight);
    var otherFixed = toNumber(input.otherFixed);

    var tariffPct = toNumber(input.tariffPct) / 100;
    var commissionPct = toNumber(input.commissionPct) / 100;
    var paymentPct = toNumber(input.paymentPct) / 100;
    var adPct = toNumber(input.adPct) / 100;
    var fxBufferPct = toNumber(input.fxBufferPct) / 100;
    var otherVarPct = toNumber(input.otherVarPct) / 100;
    var targetMarginPct = toNumber(input.targetMarginPct) / 100;

    var fixedCNY = unitCost + packaging + domestic + freight + otherFixed;
    var fixedQuote = round2(fixedCNY / rate);
    var customsBase = input.customsBaseMode === 'manual'
      ? toNumber(input.customsBaseManual)
      : fixedQuote;
    var duty = round2(customsBase * tariffPct);
    var totalFixed = round2(fixedQuote + duty);
    var varPct = commissionPct + paymentPct + adPct + fxBufferPct + otherVarPct;

    var denomBE = 1 - varPct;
    var denomSUG = 1 - varPct - targetMarginPct;

    var breakEvenPrice = denomBE > 0 ? round2(totalFixed / denomBE) : null;
    var suggestedPrice = denomSUG > 0 ? round2(totalFixed / denomSUG) : null;

    var parsedPrice = parseNum(input.price);
    var price = parsedPrice !== null ? parsedPrice : suggestedPrice;

    var profit = null, marginPct = null, varCost = null, revenue = null;
    var isLoss = false;
    if (price !== null && price > 0) {
      varCost = varPct * price;
      revenue = price;
      profit = round2(price - totalFixed - varCost);
      marginPct = profit / price;
      isLoss = profit < 0;
    }

    return {
      rate: rate,
      unitCost: unitCost, packaging: packaging, domestic: domestic,
      freight: freight, otherFixed: otherFixed,
      fixedCNY: round2(fixedCNY),
      fixedQuote: round2(fixedQuote),
      customsBaseMode: input.customsBaseMode === 'manual' ? 'manual' : 'auto',
      customsBase: round2(customsBase),
      duty: duty,
      totalFixed: totalFixed,
      varPct: varPct,
      breakEvenPrice: breakEvenPrice,
      targetMarginPct: targetMarginPct,
      suggestedPrice: suggestedPrice,
      price: price,
      revenue: revenue,
      varCost: round2(varCost),
      profit: profit,
      marginPct: marginPct,
      isLoss: isLoss,
      hasSuggestion: denomSUG > 0
    };
  }

  function fxScenarios(input, price) {
    var variations = [1, 0.99, 0.98, 0.95, 1.02, 1.05];
    return variations.map(function (f) {
      var rate = round2(toNumber(input.rate, DEFAULT_RATE) * f);
      var inp = Object.assign({}, input, { rate: rate, price: price });
      var item = computeItem(inp);
      var delta = (f - 1) * 100;
      return {
        factor: f,
        label: (delta >= 0 ? '+' : '') + delta.toFixed(0) + '%',
        rate: rate,
        totalFixed: item.totalFixed,
        profit: item.profit,
        marginPct: item.marginPct,
        isLoss: item.isLoss
      };
    });
  }

  function makeQuoteNo(prefix, seq) {
    var d = new Date();
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    var s = ('000' + (seq % 1000)).slice(-3);
    return (prefix || 'QT') + '-' + y + m + day + '-' + s;
  }

  function buildQuote(opts) {
    opts = opts || {};
    var company = opts.company || {};
    var customer = opts.customer || {};
    var items = opts.items || [];
    var terms = opts.terms || {};
    var rate = toNumber(opts.rate, DEFAULT_RATE);
    var currency = opts.currency || 'USD';

    var rows = items.map(function (it, i) {
      var qty = toNumber(it.qty, 1);
      var price = toNumber(it.price);
      return {
        no: it.no || i + 1,
        description: it.description || '',
        model: it.model || '',
        qty: qty,
        unit: it.unit || 'PCS',
        unitPrice: round2(price),
        amount: round2(qty * price)
      };
    });
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);

    return {
      quoteNo: opts.quoteNo || '',
      issueDate: opts.issueDate || '',
      company: company,
      customer: customer,
      terms: terms,
      currency: currency,
      rate: rate,
      rows: rows,
      total: round2(total),
      totalCNY: round2(total * rate)
    };
  }

  var api = {
    CURRENCIES: CURRENCIES,
    CURRENCY_CODES: CURRENCY_CODES,
    DEFAULT_RATE: DEFAULT_RATE,
    toNumber: toNumber,
    parseNum: parseNum,
    round2: round2,
    clamp: clamp,
    fmtMoney: fmtMoney,
    fmtPct: fmtPct,
    volumetricWeight: volumetricWeight,
    billableWeight: billableWeight,
    carrierCost: carrierCost,
    compareCarriers: compareCarriers,
    normalizeFx: normalizeFx,
    convert: convert,
    computeItem: computeItem,
    fxScenarios: fxScenarios,
    makeQuoteNo: makeQuoteNo,
    buildQuote: buildQuote
  };

  return api;
});