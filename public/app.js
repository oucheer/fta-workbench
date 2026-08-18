(function () {
  'use strict';
  var C = window.TradeCalcCore;
  if (!C) throw new Error('core.js 未加载');

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };
  var num = function (v, d) {
    if (v == null || !isFinite(v)) return '—';
    if (d == null) d = 2;
    var s = v.toFixed(d);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  };

  var LS_KEY = 'tradecalc.v1';

  var PRESET_CARRIERS = [
    { name: 'DHL 国际快递', baseFee: 0, perKg: 45, handling: 0, fuelPct: 25, minCharge: 0 },
    { name: 'FedEx 国际快递', baseFee: 0, perKg: 42, handling: 0, fuelPct: 30, minCharge: 0 },
    { name: 'UPS 国际快递', baseFee: 0, perKg: 40, handling: 0, fuelPct: 28, minCharge: 0 },
    { name: '美国专线', baseFee: 5, perKg: 25, handling: 0, fuelPct: 0, minCharge: 0 },
    { name: '欧洲专线', baseFee: 5, perKg: 26, handling: 0, fuelPct: 0, minCharge: 0 },
    { name: 'EMS 国际', baseFee: 10, perKg: 38, handling: 0, fuelPct: 0, minCharge: 0 }
  ];

  var MAJOR = ['USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'SGD', 'CHF', 'RUB', 'KRW', 'INR', 'AED', 'THB', 'MYR', 'VND', 'IDR', 'PHP', 'BRL', 'MXN', 'TRY', 'PLN', 'ZAR', 'NGN', 'BDT', 'EGP'];

  function defaultState() {
    return {
      fx: { cnyPerUnit: {}, source: '', date: '', fetchedAt: null, override: {} },
      shippingForm: { actual: '', l: '', w: '', h: '', divisor: '6000' },
      carriers: [],
      quoteForm: {
        currency: 'USD', rate: '', targetMargin: '20', unitCost: '', packaging: '', domestic: '',
        freight: '', otherFixed: '', tariffPct: '', customsBaseMode: 'auto', customsBaseManual: '',
        commissionPct: '15', paymentPct: '2.5', adPct: '', fxBufferPct: '1', otherVarPct: '', price: ''
      },
      qRateEdited: false,
      row0PriceEdited: false,
      quoteItems: [{ desc: '', model: '', qty: '1', unit: 'PCS', price: '' }],
      company: { name: '', contact: '', phone: '', email: '', address: '' },
      customer: { name: '', contact: '', email: '', phone: '', address: '' },
      terms: { tradeTerm: 'FOB', payment: '', delivery: '', validity: '30 days', portFrom: '', portTo: '', remarks: '' },
      quoteNo: '', seq: 0
    };
  }

  var state;
  try {
    state = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch (e) { state = null; }
  if (!state || !state.quoteForm) state = defaultState();
  state.fx = state.fx || defaultState().fx;
  state.fx.override = state.fx.override || {};
  state.shippingForm = state.shippingForm || defaultState().shippingForm;
  state.quoteItems = state.quoteItems && state.quoteItems.length ? state.quoteItems : defaultState().quoteItems;
  state.quoteForm = Object.assign(defaultState().quoteForm, state.quoteForm);
  state.terms = Object.assign(defaultState().terms, state.terms);
  state.company = Object.assign(defaultState().company, state.company);
  state.customer = Object.assign(defaultState().customer, state.customer);

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { console.warn('保存失败', e); }
    }, 250);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  /* ==================== 汇率 ==================== */

  function fxEffective(code) {
    if (state.fx.override[code] != null) return state.fx.override[code];
    var v = state.fx.cnyPerUnit[code];
    return v == null ? null : v;
  }

  function fetchJson(url, timeoutMs) {
    var opts = {};
    if (timeoutMs) opts.signal = AbortSignal.timeout(timeoutMs);
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function fetchFxFromServer() {
    return fetchJson('/api/fx').then(function (j) {
      if (!j.data || !j.data.rates) throw new Error('bad server fx');
      return { name: j.source, date: j.data.date, rates: j.data.rates };
    });
  }

  function fetchFxDirect() {
    var urls = [
      { url: 'https://open.er-api.com/v6/latest/CNY', name: 'open.er-api.com' },
      { url: 'https://api.frankfurter.app/latest?base=CNY', name: 'frankfurter.app' }
    ];
    var chain = Promise.reject(new Error('start'));
    urls.forEach(function (u) {
      chain = chain.catch(function () {
        return fetchJson(u.url, 8000).then(function (j) {
          if (!j.rates) throw new Error('no rates');
          return { name: u.name, date: j.date || j.time_last_update_utc || '', rates: j.rates };
        });
      });
    });
    return chain;
  }

  function applyFxResult(r) {
    var cnyPerUnit = { CNY: 1 };
    Object.keys(r.rates).forEach(function (k) {
      var v = parseFloat(r.rates[k]);
      if (isFinite(v) && v > 0) cnyPerUnit[k] = C.round2(1 / v);
    });
    state.fx.cnyPerUnit = cnyPerUnit;
    state.fx.source = r.name;
    state.fx.date = r.date || '';
    state.fx.fetchedAt = new Date().toISOString();
    saveNow();
    renderFxStatus();
    renderFxTable();
    autoFillQuoteRate();
  }

  function fillFreightFromShipping() {
    var f = state.shippingForm;
    var actual = pn(f.actual) != null ? pn(f.actual) : 0;
    var l = pn(f.l) != null ? pn(f.l) : 0;
    var w = pn(f.w) != null ? pn(f.w) : 0;
    var h = pn(f.h) != null ? pn(f.h) : 0;
    var divisor = parseInt(f.divisor, 10) || 6000;
    var carriers = state.carriers.filter(function (c) { return c && c.name; }).map(function (c) {
      return { name: c.name, baseFee: pn(c.baseFee) != null ? pn(c.baseFee) : 0, perKg: pn(c.perKg) != null ? pn(c.perKg) : 0, handling: pn(c.handling) != null ? pn(c.handling) : 0, fuelPct: pn(c.fuelPct) != null ? pn(c.fuelPct) : 0, minCharge: pn(c.minCharge) != null ? pn(c.minCharge) : 0 };
    });
    var billable = C.billableWeight(actual, C.volumetricWeight(l, w, h, divisor));
    if (carriers.length === 0 || billable <= 0) {
      toast('请先在「物流运费计算」填入包裹尺寸/重量并添加承运商');
      return;
    }
    var results = C.compareCarriers({ actualKg: actual, l: l, w: w, h: h, divisor: divisor, carriers: carriers });
    var cheapest = results[0].final;
    state.quoteForm.freight = String(cheapest);
    var el = $('#q-freight');
    if (el) el.value = String(cheapest);
    save();
    recalcQuote();
    toast('已填入最低承运商费用 ¥' + cheapest + '（多件装一箱请按件均摊）');
  }

  function loadFx() {
    setFxStatus('loading');
    fetchFxFromServer().catch(function () { return fetchFxDirect(); })
      .then(applyFxResult)
      .then(function () { setFxStatus('ok'); })
      .catch(function () {
        state.fx.source = 'offline';
        state.fx.fetchedAt = null;
        saveNow();
        setFxStatus('err');
        renderFxTable();
      });
  }

  function renderFxStatus() {
    if (!state.fx.fetchedAt && state.fx.source === 'offline') {
      setFxStatus('err');
    } else if (!state.fx.fetchedAt) {
      setFxStatus('loading');
    } else {
      setFxStatus('ok');
    }
  }

  function setFxStatus(mode) {
    var el = $('#fxStatus');
    var txt = $('#fxStatusText');
    if (!el || !txt) return;
    el.classList.remove('ok', 'err');
    if (mode === 'loading') {
      txt.textContent = '汇率加载中…';
    } else if (mode === 'ok') {
      el.classList.add('ok');
      var src = state.fx.source;
      var d = state.fx.date ? ' · ' + String(state.fx.date).slice(0, 10) : '';
      txt.textContent = '汇率已更新（' + src + '）' + d;
    } else {
      el.classList.add('err');
      var hasOverride = Object.keys(state.fx.override).length > 0;
      txt.textContent = hasOverride ? '汇率源不可用，使用手动汇率' : '汇率源不可用，请联网或手动输入汇率';
    }
  }

  /* ==================== 报价核算 ==================== */

  var QUOTE_FIELDS = {
    'q-currency': 'currency', 'q-rate': 'rate', 'q-targetMargin': 'targetMargin',
    'q-unitCost': 'unitCost', 'q-packaging': 'packaging', 'q-domestic': 'domestic',
    'q-freight': 'freight', 'q-otherFixed': 'otherFixed', 'q-tariffPct': 'tariffPct',
    'q-customsBaseMode': 'customsBaseMode', 'q-customsBaseManual': 'customsBaseManual',
    'q-commissionPct': 'commissionPct', 'q-paymentPct': 'paymentPct', 'q-adPct': 'adPct',
    'q-fxBufferPct': 'fxBufferPct', 'q-otherVarPct': 'otherVarPct', 'q-price': 'price'
  };

  function pn(v) { return C.parseNum(v); }

  function quoteInput() {
    var f = state.quoteForm;
    var rate = pn(f.rate) != null ? pn(f.rate) : C.DEFAULT_RATE;
    return {
      rate: rate,
      targetMarginPct: pn(f.targetMargin) != null ? pn(f.targetMargin) : 0,
      unitCost: pn(f.unitCost) != null ? pn(f.unitCost) : 0,
      packaging: pn(f.packaging) != null ? pn(f.packaging) : 0,
      domestic: pn(f.domestic) != null ? pn(f.domestic) : 0,
      freight: pn(f.freight) != null ? pn(f.freight) : 0,
      otherFixed: pn(f.otherFixed) != null ? pn(f.otherFixed) : 0,
      tariffPct: pn(f.tariffPct) != null ? pn(f.tariffPct) : 0,
      customsBaseMode: f.customsBaseMode,
      customsBaseManual: pn(f.customsBaseManual) != null ? pn(f.customsBaseManual) : 0,
      commissionPct: pn(f.commissionPct) != null ? pn(f.commissionPct) : 0,
      paymentPct: pn(f.paymentPct) != null ? pn(f.paymentPct) : 0,
      adPct: pn(f.adPct) != null ? pn(f.adPct) : 0,
      fxBufferPct: pn(f.fxBufferPct) != null ? pn(f.fxBufferPct) : 0,
      otherVarPct: pn(f.otherVarPct) != null ? pn(f.otherVarPct) : 0,
      price: f.price === '' || f.price == null ? undefined : pn(f.price)
    };
  }

  function quoteCurrency() { return state.quoteForm.currency || 'USD'; }

  function fmtQuote(v) { return C.fmtMoney(v, quoteCurrency()); }

  function recalcQuote() {
    var r = C.computeItem(quoteInput());
    var effPrice = r.price;
    var currency = quoteCurrency();
    var fmt = function (v) { return C.fmtMoney(v, currency); };
    var html = '';

    html += '<div class="result-kpis">';
    html += '<div class="kpi"><div class="kpi-label">建议售价（目标利润率' + num(r.targetMarginPct * 100, 1) + '%）</div><div class="kpi-val">' + fmt(r.suggestedPrice) + '</div></div>';
    html += '<div class="kpi"><div class="kpi-label">保本价（盈亏平衡）</div><div class="kpi-val">' + fmt(r.breakEvenPrice) + '</div></div>';
    if (r.price != null) {
      var cls = r.isLoss ? 'loss' : 'gain';
      html += '<div class="kpi ' + cls + '"><div class="kpi-label">当前售价</div><div class="kpi-val">' + fmt(r.price) + '</div></div>';
      html += '<div class="kpi ' + cls + '"><div class="kpi-label">单件利润</div><div class="kpi-val">' + fmt(r.profit) + '</div></div>';
      html += '<div class="kpi ' + cls + '"><div class="kpi-label">利润率</div><div class="kpi-val">' + C.fmtPct(r.marginPct, 2) + '</div></div>';
    }
    html += '</div>';

    if (r.price != null) {
      html += '<table class="tbl"><thead><tr><th>成本构成</th><th>金额（报价币）</th><th>金额（CNY）</th></tr></thead><tbody>';
    var rows = [
      ['采购单价', r.unitCost], ['包装费', r.packaging], ['国内费用', r.domestic],
      ['单件物流费', r.freight], ['其他固定', r.otherFixed],
      ['固定成本小计', r.fixedCNY / r.rate, r.fixedCNY],
      ['关税', r.duty, r.duty * r.rate],
      ['总固定成本（含关税）', r.totalFixed, r.totalFixed * r.rate]
    ];
    rows.forEach(function (row) {
      html += '<tr><td>' + row[0] + '</td><td class="num">' + fmt(row.length > 2 ? row[1] : row[1] / r.rate) + '</td><td class="num">' + num(row.length > 2 ? row[2] : row[1]) + '</td></tr>';
    });
    html += '<tr class="total"><td>变动费率合计</td><td colspan="2">' + C.fmtPct(r.varPct, 2) + '（' + num(r.varCost) + ' ' + currency + ' @ 售价）</td></tr>';
    html += '</tbody></table>';
    }

    html += '<h3 class="sub-title">汇率敏感性分析（当前售价 ' + fmt(effPrice) + '）</h3>';
    var scenarios = C.fxScenarios(quoteInput(), effPrice);
    var margins = scenarios.map(function (s) { return s.marginPct; });
    var minM = Math.min.apply(null, margins.filter(function (m) { return m != null; }));
    var maxM = Math.max.apply(null, margins.filter(function (m) { return m != null; }));
    var span = (maxM - minM) || 1;
    scenarios.forEach(function (s) {
      var w = s.marginPct != null ? Math.max(2, ((s.marginPct - minM) / span) * 100) : 0;
      var barCls = s.marginPct != null && s.marginPct < 0 ? 'loss' : 'gain';
      html += '<div class="bar-wrap"><div class="bar-label">人民币' + s.label + '（汇率 ' + num(s.rate, 4) + '）→ 利润率 ' + C.fmtPct(s.marginPct, 2) + ' · 利润 ' + fmt(s.profit) + '</div>';
      html += '<div class="bar-track"><div class="bar-fill ' + barCls + '" style="width:' + num(w, 1) + '%"></div></div></div>';
    });

    $('#q-result').innerHTML = html;

    var warnMsg = '';
    if (!r.hasSuggestion) {
      warnMsg = '⚠️ 变动费率合计已达 ' + C.fmtPct(r.varPct, 2) + '，无法通过提价覆盖目标利润，请检查费率或目标利润率。';
    } else if (r.price != null && r.isLoss) {
      warnMsg = '⚠️ 当前售价低于保本价，处于亏损状态。建议售价为 ' + fmt(r.suggestedPrice) + '。';
    } else if (r.price != null && r.marginPct != null && r.marginPct < r.targetMarginPct - 0.0001) {
      warnMsg = '⚠️ 当前利润率（' + C.fmtPct(r.marginPct, 2) + '）低于目标利润率（' + C.fmtPct(r.targetMarginPct, 2) + '）。';
    }
    if (warnMsg) {
      $('#q-result').insertAdjacentHTML('afterbegin', '<div class="warn-box">' + warnMsg + '</div>');
    }

    syncQuoteItemPrice(r.price);
    renderQuoteItems();
    return r;
  }

  function syncQuoteItemPrice(effPrice) {
    if (effPrice == null || state.row0PriceEdited) return;
    var row0 = state.quoteItems[0];
    if (row0) {
      row0.price = C.round2(effPrice);
    }
  }

  function autoFillQuoteRate() {
    if (state.qRateEdited) return;
    var eff = fxEffective(quoteCurrency());
    if (eff == null) return;
    state.quoteForm.rate = String(eff);
    var el = $('#q-rate');
    if (el) el.value = state.quoteForm.rate;
    recalcQuote();
  }

  /* ==================== 物流运费 ==================== */

  function recalcShipping() {
    var f = state.shippingForm;
    var actual = pn(f.actual) != null ? pn(f.actual) : 0;
    var l = pn(f.l) != null ? pn(f.l) : 0;
    var w = pn(f.w) != null ? pn(f.w) : 0;
    var h = pn(f.h) != null ? pn(f.h) : 0;
    var divisor = parseInt(f.divisor, 10) || 6000;
    var vol = C.volumetricWeight(l, w, h, divisor);
    var billable = C.billableWeight(actual, vol);
    $('#s-vol').textContent = vol > 0 ? vol + ' kg' : '—';
    $('#s-billable').textContent = billable > 0 ? billable + ' kg' : '—';

    var carriers = state.carriers.map(function (c) {
      return { name: c.name, baseFee: pn(c.baseFee) != null ? pn(c.baseFee) : 0, perKg: pn(c.perKg) != null ? pn(c.perKg) : 0, handling: pn(c.handling) != null ? pn(c.handling) : 0, fuelPct: pn(c.fuelPct) != null ? pn(c.fuelPct) : 0, minCharge: pn(c.minCharge) != null ? pn(c.minCharge) : 0 };
    });

    var out = $('#s-result');
    if (billable <= 0 || carriers.length === 0) {
      out.innerHTML = '<p class="muted">填写包裹尺寸并添加承运商后自动比价。</p>';
      return;
    }
    var results = C.compareCarriers({ actualKg: actual, l: l, w: w, h: h, divisor: divisor, carriers: carriers });
    var html = '<table class="tbl"><thead><tr><th>承运商</th><th>实重(kg)</th><th>体积重(kg)</th><th>计费重(kg)</th><th>运费(¥)</th><th>燃油(¥)</th><th>总费用(¥)</th></tr></thead><tbody>';
    results.forEach(function (r, i) {
      var tag = i === 0 ? ' 🏆 最省' : '';
      html += '<tr><td>' + esc(r.carrier) + tag + (r.usingVolumetric ? ' <span class="muted">(按体积重)</span>' : '') + '</td><td class="num">' + num(r.actualKg) + '</td><td class="num">' + num(r.volumetricKg) + '</td><td class="num">' + num(r.billableKg) + '</td><td class="num">' + num(r.freight) + '</td><td class="num">' + num(r.fuelCost) + '</td><td class="num"><b>' + num(r.final) + '</b></td></tr>';
    });
    html += '</tbody></table>';
    if (vol > actual + 1e-9) {
      html += '<div class="warn-box">⚠️ 体积重（' + num(vol) + ' kg）大于实重（' + num(actual) + ' kg），本票将按体积重计费。</div>';
    }
    html += '<p class="muted">承运商费率表为参考模板，请按实际货代报价调整。</p>';
    out.innerHTML = html;
  }

  function renderCarriers() {
    var wrap = $('#s-carriers');
    if (!wrap) return;
    var html = '<div class="carrier-row" style="font-weight:600;color:var(--muted);font-size:12px;">' +
      '<span>名称</span><span>基础费¥</span><span>每kg¥</span><span>操作费¥</span><span>燃油%</span><span>最低¥</span><span></span></div>';
    state.carriers.forEach(function (c, i) {
      html += '<div class="carrier-row">' +
        '<input class="carrier-name" data-idx="' + i + '" data-key="name" value="' + esc(c.name) + '" placeholder="承运商名">' +
        '<input data-idx="' + i + '" data-key="baseFee" value="' + esc(c.baseFee) + '" placeholder="0">' +
        '<input data-idx="' + i + '" data-key="perKg" value="' + esc(c.perKg) + '" placeholder="0">' +
        '<input data-idx="' + i + '" data-key="handling" value="' + esc(c.handling) + '" placeholder="0">' +
        '<input data-idx="' + i + '" data-key="fuelPct" value="' + esc(c.fuelPct) + '" placeholder="0">' +
        '<input data-idx="' + i + '" data-key="minCharge" value="' + esc(c.minCharge) + '" placeholder="0">' +
        '<button class="linkbtn danger" data-del="' + i + '">删除</button>' +
        '</div>';
    });
    wrap.innerHTML = html;
    $$('#s-carriers input').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var idx = parseInt(inp.dataset.idx, 10);
        var key = inp.dataset.key;
        if (!state.carriers[idx]) return;
        state.carriers[idx][key] = key === 'name' ? inp.value : (inp.value === '' ? '' : parseFloat(inp.value));
        if (key !== 'name' && isNaN(state.carriers[idx][key])) state.carriers[idx][key] = inp.value;
        save();
        recalcShipping();
      });
    });
    $$('#s-carriers [data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.carriers.splice(parseInt(btn.dataset.del, 10), 1);
        save();
        renderCarriers();
        recalcShipping();
      });
    });
  }

  /* ==================== 报价单 ==================== */

  var QUOTE_ITEM_FIELDS = ['desc', 'model', 'qty', 'unit', 'price'];

  function renderQuoteItems() {
    var wrap = $('#t-items');
    if (!wrap) return;
    var html = '';
    state.quoteItems.forEach(function (it, i) {
      html += '<div class="quote-item-row">' +
        '<span>' + (i + 1) + '</span>' +
        '<input data-i="' + i + '" data-k="desc" value="' + esc(it.desc) + '" placeholder="Product Description">' +
        '<input data-i="' + i + '" data-k="model" value="' + esc(it.model) + '" placeholder="Model">' +
        '<input data-i="' + i + '" data-k="qty" value="' + esc(it.qty) + '" placeholder="Qty">' +
        '<input data-i="' + i + '" data-k="unit" value="' + esc(it.unit) + '" placeholder="PCS">' +
        '<input data-i="' + i + '" data-k="price" value="' + esc(it.price) + '" placeholder="Price">' +
        '<span class="qitem-amt" data-amt="' + i + '">—</span>' +
        (state.quoteItems.length > 1 ? '<button class="linkbtn danger" data-del="' + i + '">删</button>' : '<span></span>') +
        '</div>';
    });
    wrap.innerHTML = html;
    $$('#t-items input').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = parseInt(inp.dataset.i, 10);
        var k = inp.dataset.k;
        if (!state.quoteItems[i]) return;
        state.quoteItems[i][k] = inp.value;
        if (i === 0 && k === 'price') state.row0PriceEdited = true;
        save();
        renderQuoteTotals();
        updateItemAmounts();
      });
    });
    $$('#t-items [data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.quoteItems.splice(parseInt(btn.dataset.del, 10), 1);
        save();
        renderQuoteItems();
        renderQuoteTotals();
      });
    });
    updateItemAmounts();
    renderQuoteTotals();
  }

  function updateItemAmounts() {
    var rate = pn(state.quoteForm.rate) != null ? pn(state.quoteForm.rate) : C.DEFAULT_RATE;
    state.quoteItems.forEach(function (it, i) {
      var el = document.querySelector('[data-amt="' + i + '"]');
      if (!el) return;
      var qty = pn(it.qty) != null ? pn(it.qty) : 0;
      var price = pn(it.price) != null ? pn(it.price) : 0;
      el.textContent = C.fmtMoney(C.round2(qty * price), quoteCurrency());
    });
  }

  function renderQuoteTotals() {
    var rate = pn(state.quoteForm.rate) != null ? pn(state.quoteForm.rate) : C.DEFAULT_RATE;
    var currency = quoteCurrency();
    var q = C.buildQuote({
      currency: currency, rate: rate,
      items: state.quoteItems.map(function (it) {
        return { desc: it.desc, model: it.model, qty: it.qty, unit: it.unit, price: it.price };
      })
    });
    $('#t-total').textContent = C.fmtMoney(q.total, currency);
    $('#t-totalCNY').textContent = C.fmtMoney(q.totalCNY, 'CNY') + '（按汇率 ' + num(rate, 4) + '）';
    $('#t-quoteNo').textContent = state.quoteNo || '—';
    return q;
  }

  function genQuoteNo() {
    state.seq = (state.seq || 0) + 1;
    state.quoteNo = C.makeQuoteNo('QT', state.seq);
    saveNow();
    $('#t-quoteNo').textContent = state.quoteNo;
    toast('已生成报价单号：' + state.quoteNo);
  }

  function quotePrintHtml() {
    var currency = quoteCurrency();
    var rate = pn(state.quoteForm.rate) != null ? pn(state.quoteForm.rate) : C.DEFAULT_RATE;
    var q = C.buildQuote({
      quoteNo: state.quoteNo, issueDate: todayStr(),
      company: state.company, customer: state.customer, terms: state.terms,
      currency: currency, rate: rate,
      items: state.quoteItems.map(function (it) {
        return { desc: it.desc, model: it.model, qty: it.qty, unit: it.unit, price: it.price };
      })
    });
    var co = q.company, cu = q.customer, t = q.terms;
    var fmtC = function (v) { return C.fmtMoney(v, currency); };
    var tr = q.rows.map(function (r) {
      return '<tr><td>' + r.no + '</td><td>' + esc(r.description) + '</td><td>' + esc(r.model) + '</td>' +
        '<td class="num">' + num(r.qty) + '</td><td>' + esc(r.unit) + '</td>' +
        '<td class="num">' + fmtC(r.unitPrice) + '</td><td class="num">' + fmtC(r.amount) + '</td></tr>';
    }).join('');

    return '<div class="print-sheet">' +
      '<div class="p-head">' +
      '<div><div class="p-company">' + esc(co.name) + '</div>' +
      '<div class="p-contact">' + (co.address ? 'Address: ' + esc(co.address) + '<br>' : '') +
      (co.contact ? 'Contact: ' + esc(co.contact) + '<br>' : '') +
      (co.phone ? 'Tel: ' + esc(co.phone) + '<br>' : '') +
      (co.email ? 'Email: ' + esc(co.email) : '') + '</div></div>' +
      '<div class="p-title">QUOTATION<br><span style="font-size:12px;font-weight:400">报价单</span></div>' +
      '</div>' +
      '<div class="p-meta">' +
      '<span><b>Quote No.</b>' + esc(q.quoteNo) + '</span>' +
      '<span><b>Date</b>' + esc(q.issueDate) + '</span>' +
      '<span><b>Buyer</b>' + esc(cu.name) + '</span>' +
      '<span><b>Attn</b>' + esc(cu.contact) + '</span>' +
      '<span><b>Email</b>' + esc(cu.email) + '</span>' +
      '<span><b>Tel</b>' + esc(cu.phone) + '</span>' +
      '<span><b>Address</b>' + esc(cu.address) + '</span>' +
      '<span><b>Trade Term</b>' + esc(t.tradeTerm) + '</span>' +
      '<span><b>Payment</b>' + esc(t.payment) + '</span>' +
      '<span><b>Delivery</b>' + esc(t.delivery) + '</span>' +
      '<span><b>Validity</b>' + esc(t.validity) + '</span>' +
      '<span><b>From/To</b>' + esc(t.portFrom) + ' → ' + esc(t.portTo) + '</span>' +
      '</div>' +
      '<table><thead><tr><th>#</th><th>Description</th><th>Model</th><th>Qty</th><th>Unit</th><th>Unit Price (' + currency + ')</th><th>Amount (' + currency + ')</th></tr></thead><tbody>' +
      tr + '</tbody></table>' +
      '<div class="p-total">Total: ' + fmtC(q.total) + ' (' + currency + ') &nbsp;≈ ' + C.fmtMoney(q.totalCNY, 'CNY') + ' &nbsp;(FX ' + num(rate, 4) + ')</div>' +
      (t.remarks ? '<div class="p-terms"><b>Remarks / Terms:</b><p>' + esc(t.remarks).replace(/\n/g, '<br>') + '</p></div>' : '') +
      '<div class="p-sign">Authorized Signature: ______________________<br>Date: ______________________</div>' +
      '</div>';
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function printQuote() {
    if (!state.quoteNo) genQuoteNo();
    $('#printArea').innerHTML = quotePrintHtml();
    setTimeout(function () { window.print(); }, 60);
  }

  /* ==================== 汇率表 ==================== */

  function sortedCurrencyCodes() {
    return C.CURRENCY_CODES.slice().sort(function (a, b) {
      var ia = MAJOR.indexOf(a), ib = MAJOR.indexOf(b);
      ia = ia < 0 ? 999 : ia; ib = ib < 0 ? 999 : ib;
      return ia - ib;
    });
  }

  function renderFxTable() {
    var tbody = $('#fx-tbody');
    if (!tbody) return;
    var codes = sortedCurrencyCodes();
    var html = '';
    codes.forEach(function (code) {
      var cur = C.CURRENCIES[code];
      var eff = fxEffective(code);
      var overridden = state.fx.override[code] != null;
      html += '<tr class="' + (overridden ? 'override' : '') + '">' +
        '<td><b>' + code + '</b></td>' +
        '<td>' + cur.label + '</td>' +
        '<td><input type="number" step="0.0001" min="0" data-code="' + code + '" value="' + (eff != null ? eff : '') + '" placeholder="' + (code === 'CNY' ? '1' : '输入') + '">' +
        (overridden ? '<span class="tag">手动</span>' : '') + '</td>' +
        '<td class="muted">' + (state.fx.cnyPerUnit[code] != null ? '自动' + num(state.fx.cnyPerUnit[code], 4) : '—') + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
    $$('#fx-tbody input[data-code]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var code = inp.dataset.code;
        if (code === 'CNY') return;
        var v = pn(inp.value);
        if (v != null && v > 0) {
          state.fx.override[code] = v;
          if (code === quoteCurrency()) {
            state.quoteForm.rate = String(v);
            state.qRateEdited = true;
            $('#q-rate').value = String(v);
            recalcQuote();
          }
        } else if (v == null) {
          delete state.fx.override[code];
        }
        save();
        renderFxTable();
      });
    });
    var note = $('#fx-note');
    if (note) {
      var hasOverride = Object.keys(state.fx.override).length > 0;
      note.textContent = state.fx.fetchedAt
        ? ('上次自动更新：' + String(state.fx.fetchedAt).replace('T', ' ').slice(0, 19) + ' UTC')
        : (hasOverride ? '当前使用手动汇率' : '暂无自动汇率数据');
    }
  }

  /* ==================== 表单绑定 ==================== */

  function setFormFromState() {
    Object.keys(QUOTE_FIELDS).forEach(function (id) {
      var key = QUOTE_FIELDS[id];
      var el = $('#' + id);
      if (el) el.value = state.quoteForm[key] != null ? state.quoteForm[key] : '';
    });
    ['actual', 'l', 'w', 'h', 'divisor'].forEach(function (k) {
      var el = $('#s-' + k);
      if (el) el.value = state.shippingForm[k] != null ? state.shippingForm[k] : '';
    });
    var textMap = {
      't-company': ['company', 'name'], 't-contact': ['company', 'contact'], 't-phone': ['company', 'phone'],
      't-email': ['company', 'email'], 't-address': ['company', 'address'],
      't-buyerCompany': ['customer', 'name'], 't-buyerContact': ['customer', 'contact'],
      't-buyerEmail': ['customer', 'email'], 't-buyerPhone': ['customer', 'phone'],
      't-buyerAddress': ['customer', 'address'],
      't-tradeTerm': ['terms', 'tradeTerm'], 't-payment': ['terms', 'payment'],
      't-delivery': ['terms', 'delivery'], 't-validity': ['terms', 'validity'],
      't-portFrom': ['terms', 'portFrom'], 't-portTo': ['terms', 'portTo'], 't-remarks': ['terms', 'remarks']
    };
    Object.keys(textMap).forEach(function (id) {
      var path = textMap[id];
      var el = $('#' + id);
      if (el) el.value = state[path[0]][path[1]] != null ? state[path[0]][path[1]] : '';
    });
  }

  function bindQuoteForm() {
    Object.keys(QUOTE_FIELDS).forEach(function (id) {
      var el = $('#' + id);
      if (!el) return;
      var key = QUOTE_FIELDS[id];
      var handler = function () {
        if (key === 'rate') state.qRateEdited = true;
        state.quoteForm[key] = el.value;
        if (key === 'customsBaseMode') {
          $('#row-customsManual').style.display = el.value === 'manual' ? 'flex' : 'none';
        }
        if (key === 'currency') autoFillQuoteRate();
        save();
        recalcQuote();
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
  }

  function bindShipping() {
    ['actual', 'l', 'w', 'h', 'divisor'].forEach(function (k) {
      var el = $('#s-' + k);
      if (!el) return;
      el.addEventListener('input', function () {
        state.shippingForm[k] = el.value;
        save();
        recalcShipping();
      });
    });
    $('#s-addCarrier').addEventListener('click', function () {
      state.carriers.push({ name: '新承运商', baseFee: 0, perKg: 0, handling: 0, fuelPct: 0, minCharge: 0 });
      save();
      renderCarriers();
      recalcShipping();
    });
    $('#s-loadPreset').addEventListener('click', function () {
      state.carriers = JSON.parse(JSON.stringify(PRESET_CARRIERS));
      save();
      renderCarriers();
      recalcShipping();
      toast('已载入常用承运商模板（费率需按实际调整）');
    });
  }

  function bindQuotation() {
    var textMap = {
      't-company': ['company', 'name'], 't-contact': ['company', 'contact'], 't-phone': ['company', 'phone'],
      't-email': ['company', 'email'], 't-address': ['company', 'address'],
      't-buyerCompany': ['customer', 'name'], 't-buyerContact': ['customer', 'contact'],
      't-buyerEmail': ['customer', 'email'], 't-buyerPhone': ['customer', 'phone'],
      't-buyerAddress': ['customer', 'address'],
      't-tradeTerm': ['terms', 'tradeTerm'], 't-payment': ['terms', 'payment'],
      't-delivery': ['terms', 'delivery'], 't-validity': ['terms', 'validity'],
      't-portFrom': ['terms', 'portFrom'], 't-portTo': ['terms', 'portTo'], 't-remarks': ['terms', 'remarks']
    };
    Object.keys(textMap).forEach(function (id) {
      var el = $('#' + id);
      if (!el) return;
      var path = textMap[id];
      el.addEventListener('input', function () {
        state[path[0]][path[1]] = el.value;
        save();
      });
    });
    $('#t-genNo').addEventListener('click', genQuoteNo);
    $('#t-print').addEventListener('click', printQuote);
    $('#btnPrintQuote').addEventListener('click', printQuote);
    $('#t-addItem').addEventListener('click', function () {
      state.quoteItems.push({ desc: '', model: '', qty: '1', unit: 'PCS', price: '' });
      save();
      renderQuoteItems();
    });
  }

  /* ==================== 数据管理 ==================== */

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
  }

  function bindData() {
    $('#d-export').addEventListener('click', function () {
      download('tradecalc-backup-' + todayStr() + '.json', JSON.stringify(state, null, 2));
      toast('已导出备份');
    });
    $('#d-import').addEventListener('click', function () { $('#d-file').click(); });
    $('#d-file').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data.quoteForm) throw new Error('不是有效的备份文件');
          state = data;
          state.fx = state.fx || defaultState().fx;
          state.fx.override = state.fx.override || {};
          saveNow();
          rerenderAll();
          toast('备份已导入');
        } catch (err) {
          toast('导入失败：' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    $('#d-reset').addEventListener('click', function () {
      if (!confirm('确定清空全部本地数据？此操作不可恢复。')) return;
      state = defaultState();
      localStorage.removeItem(LS_KEY);
      rerenderAll();
      toast('已清空数据');
    });
  }

  function loadDemo() {
    state.quoteForm = {
      currency: 'USD', rate: '', targetMargin: '20', unitCost: '45', packaging: '2', domestic: '1.5',
      freight: '55', otherFixed: '0', tariffPct: '3', customsBaseMode: 'auto', customsBaseManual: '',
      commissionPct: '15', paymentPct: '2.5', adPct: '5', fxBufferPct: '1', otherVarPct: '0', price: ''
    };
    state.qRateEdited = false;
    state.row0PriceEdited = false;
    state.shippingForm = { actual: '0.3', l: '15', w: '10', h: '5', divisor: '6000' };
    state.carriers = JSON.parse(JSON.stringify(PRESET_CARRIERS));
    state.quoteItems = [{ desc: 'Smart Bracelet Model X', model: 'SB-X200', qty: '500', unit: 'PCS', price: '' }];
    state.company = {
      name: 'Shenzhen TradePilot Co., Ltd.', contact: 'Anna Wang', phone: '+86 138 0000 0000',
      email: 'sales@tradepilot.cn', address: 'Rm 1208, Bldg A, Nanshan District, Shenzhen, China'
    };
    state.customer = {
      name: 'US Global Import LLC', contact: 'Michael Smith', email: 'michael@usglobal.com',
      phone: '+1 310 555 0100', address: '1200 Harbor Blvd, Los Angeles, CA 90001, USA'
    };
    state.terms = {
      tradeTerm: 'FOB', payment: 'T/T 30% deposit, 70% balance against B/L copy',
      delivery: '15-20 days after deposit', validity: '30 days',
      portFrom: 'Shanghai', portTo: 'Los Angeles',
      remarks: '1) Warranty: 12 months since B/L date.\n2) Packing: export carton, neutral.\n3) Prices subject to exchange rate fluctuation.'
    };
    state.quoteNo = ''; state.seq = 0;
    saveNow();
    rerenderAll();
    toast('已载入示例数据');
  }

  function rerenderAll() {
    setFormFromState();
    $('#row-customsManual').style.display = state.quoteForm.customsBaseMode === 'manual' ? 'flex' : 'none';
    renderCarriers();
    renderQuoteItems();
    renderFxStatus();
    renderFxTable();
    recalcQuote();
    recalcShipping();
    autoFillQuoteRate();
  }

  /* ==================== Tabs ==================== */

  function bindTabs() {
    $$('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        $$('.tab').forEach(function (t) { t.classList.remove('active'); });
        btn.classList.add('active');
        $('#tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  /* ==================== Init ==================== */

  function populateCurrencySelect() {
    var sel = $('#q-currency');
    if (!sel) return;
    sortedCurrencyCodes().forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code + ' ' + C.CURRENCIES[code].label;
      sel.appendChild(opt);
    });
    sel.value = state.quoteForm.currency;
  }

  function init() {
    populateCurrencySelect();
    setFormFromState();
    $('#row-customsManual').style.display = state.quoteForm.customsBaseMode === 'manual' ? 'flex' : 'none';
    bindTabs();
    bindQuoteForm();
    bindShipping();
    bindQuotation();
    bindData();
    $('#btnLoadDemo').addEventListener('click', loadDemo);
    $('#q-fillFromShipping').addEventListener('click', fillFreightFromShipping);
    $('#fx-refresh').addEventListener('click', function () {
      state.fx.override = {};
      save();
      loadFx();
    });
    $('#fx-manual').addEventListener('click', function () {
      $$('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      $$('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelector('.tab-btn[data-tab="fx"]').classList.add('active');
      $('#tab-fx').classList.add('active');
      var first = $('#fx-table input[data-code]');
      if (first) first.focus();
    });
    renderCarriers();
    renderQuoteItems();
    renderFxStatus();
    renderFxTable();
    recalcQuote();
    recalcShipping();
    loadFx();
    setTimeout(function () {
      console.info('TradeCalc Workbench ready. core version loaded:', !!C);
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();