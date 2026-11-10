/* 下班倒數：畫面與互動。所有計算都在 calc.js（純函式），這裡只負責「讀輸入 → 呼叫計算 → 把結果放到畫面上」。
   每次更新都用 Date.now() 重新算，不做「每秒加一」的累加，所以分頁在背景被降速、電腦睡眠醒來後數字都還是對的。 */
(function () {
  "use strict";

  var C = window.PayCalc;
  var KEY = "paycountdown-settings";  // 輸入資料；主題另外存在 paycountdown-theme（在 index.html 裡處理）
  var DEFAULTS = {
    type: "monthly", amount: "0", start: "09:00", end: "18:00",
    lunchOn: true, lunchStart: "12:00", lunchEnd: "13:00", days: "", symbol: "NT$", loss: ""  /* days 留空 = 自動用「本月實際的工作天數」 */
  };

  function $(id) { return document.getElementById(id); }

  /* 24 小時制時間選擇：把 <div class="time"> 變成「時」「分」兩個下拉選單，
     並讓這個 div 像一般欄位一樣有 .value（"HH:MM"）和 .disabled 可以讀寫 */
  function makeTime(box) {
    function sel(id, max, label) {
      var s = document.createElement("select");
      s.id = id; s.setAttribute("aria-label", label);
      for (var i = 0; i < max; i++) {
        var o = document.createElement("option");
        o.value = o.textContent = (i < 10 ? "0" : "") + i;
        s.appendChild(o);
      }
      return s;
    }
    var name = box.getAttribute("aria-label") || (document.querySelector('label[for="' + box.id + '-h"]') || {}).textContent || "";
    var h = sel(box.id + "-h", 24, name + " 時"), m = sel(box.id + "-m", 60, name + " 分");
    var colon = document.createElement("span"); colon.className = "colon"; colon.textContent = ":";
    box.appendChild(h); box.appendChild(colon); box.appendChild(m);
    Object.defineProperty(box, "value", {
      get: function () { return h.value + ":" + m.value; },
      set: function (v) {
        var p = /^(\d{1,2}):(\d{2})/.exec(String(v));
        if (p && +p[1] < 24 && +p[2] < 60) { h.value = ("0" + +p[1]).slice(-2); m.value = p[2]; }
      }
    });
    Object.defineProperty(box, "disabled", { get: function () { return h.disabled; }, set: function (v) { h.disabled = m.disabled = !!v; } });
    box.value = box.getAttribute("data-default") || "00:00";
  }
  var timeBoxes = document.querySelectorAll(".time");
  for (var tb = 0; tb < timeBoxes.length; tb++) makeTime(timeBoxes[tb]);

  var el = {
    amount: $("amount"), amountLabel: $("amount-label"), symbol: $("symbol"),
    start: $("start"), end: $("end"), days: $("days"), fieldDays: $("field-days"),
    lunchOn: $("lunch-on"), lunchStart: $("lunch-start"), lunchEnd: $("lunch-end"),
    cdLabel: $("cd-label"), cd: $("cd"), earnLabel: $("earn-label"), earn: $("earn"),
    bar: $("bar"), barFill: $("bar-fill"), barText: $("bar-text"),
    earnMonth: $("earn-month"),
    recover: $("recover"), recoverBar: $("recover-bar"), recoverFill: $("recover-fill"), recoverText: $("recover-text"),
    loss: $("loss"), lossDays: $("loss-days"), lossLabel: $("loss-label"),
    rateH: $("rate-h"), rateD: $("rate-d"), hint: $("hint")
  };
  var typeRadios = document.querySelectorAll('input[name="type"]');

  /* ---------- 存取（localStorage 一律包 try/catch；讀不到就用預設值） ---------- */
  function load() {
    var s = {};
    for (var k in DEFAULTS) s[k] = DEFAULTS[k];
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === "object") {
          for (var key in DEFAULTS) {
            if (typeof o[key] === typeof DEFAULTS[key]) s[key] = o[key];
          }
          if (s.type !== "monthly" && s.type !== "hourly") s.type = "monthly";
          if (s.days === "22") s.days = "";  // 舊版預設值 22 → 改成自動
        }
      }
    } catch (e) { /* 讀不到（私密模式、資料壞掉）→ 用預設值 */ }
    return s;
  }

  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 存不了就只有這次有效 */ }
  }

  /* ---------- 畫面上的欄位 ⇄ 設定物件 ---------- */
  function readForm() {
    var type = "monthly";
    for (var i = 0; i < typeRadios.length; i++) if (typeRadios[i].checked) type = typeRadios[i].value;
    return {
      type: type, amount: el.amount.value, start: el.start.value, end: el.end.value,
      lunchOn: el.lunchOn.checked, lunchStart: el.lunchStart.value, lunchEnd: el.lunchEnd.value,
      days: el.days.value, symbol: el.symbol.value, loss: el.loss.value
    };
  }

  function writeForm(s) {
    for (var i = 0; i < typeRadios.length; i++) typeRadios[i].checked = typeRadios[i].value === s.type;
    el.amount.value = s.amount; el.start.value = s.start; el.end.value = s.end;
    el.lunchOn.checked = s.lunchOn; el.lunchStart.value = s.lunchStart; el.lunchEnd.value = s.lunchEnd;
    el.days.value = s.days; el.loss.value = s.loss;
    el.symbol.value = s.symbol;
    if (el.symbol.value !== s.symbol) el.symbol.value = DEFAULTS.symbol;  // 舊版自己打的符號不在選單裡 → 回到新台幣
  }

  /* 把設定轉成計算用的數字；同時找出第一個要提示使用者的問題 */
  var model = null;
  function buildModel(s) {
    var m = { type: s.type, symbol: s.symbol, hint: "" };
    m.start = C.parseTime(s.start);
    m.end = C.parseTime(s.end);
    m.timeOk = isFinite(m.start) && isFinite(m.end) && m.start !== m.end;

    m.lunch = null;
    var lunchBad = false;
    if (s.lunchOn) {
      var ls = C.parseTime(s.lunchStart), le = C.parseTime(s.lunchEnd);
      if (isFinite(ls) && isFinite(le)) m.lunch = { start: ls, end: le };
      else lunchBad = true;
    }

    m.workSec = m.timeOk ? C.workSeconds(m.start, m.end, m.lunch ? m.lunch.start : NaN, m.lunch ? m.lunch.end : NaN) : 0;

    var amountRaw = String(s.amount).trim();
    m.amount = amountRaw === "" ? NaN : Number(amountRaw);
    // 每月工作天數：留空 = 自動，用「本月」實際有幾個工作日（11 月 21 天、12 月 23 天…），月份換了會自動跟著換
    var today = new Date(Date.now());
    m.autoDays = C.workdaysInMonth(today.getFullYear(), today.getMonth());
    m.monthKey = today.getFullYear() * 12 + today.getMonth();
    m.useAuto = String(s.days).trim() === "";
    m.days = m.useAuto ? m.autoDays : Number(s.days);
    m.perSec = C.perSecondPay(s.type, m.amount, m.days, m.workSec);
    var lossRaw = String(s.loss).trim();
    m.loss = lossRaw === "" ? NaN : Number(lossRaw);  // 空白或負數時，賠錢區顯示「—」

    if (!isFinite(m.start) || !isFinite(m.end)) m.hint = "請填入上班與下班時間。";
    else if (m.start === m.end) m.hint = "上班和下班時間不能一樣。";
    else if (m.workSec <= 0) m.hint = "午休時間涵蓋了整個上班時段，請調整午休。";
    else if (lunchBad) m.hint = "午休時間請填完整，或取消勾選「扣除午休」。";
    else if (amountRaw === "") m.hint = "請輸入" + (s.type === "hourly" ? "時薪" : "月薪") + "，就能看到今天賺了多少。";
    else if (!isFinite(m.amount) || m.amount < 0) m.hint = "薪水要是 0 或正數。";
    else if (s.type === "monthly" && !(m.days > 0)) m.hint = "每月工作天數要大於 0。";

    return m;
  }

  /* ---------- 畫面更新 ---------- */
  function setText(node, text) {
    if (node.textContent !== text) { node.textContent = text; return true; }
    return false;
  }

  /* 工作天數欄留空時顯示的灰字，例如「預設( 11 月有 21 個工作天)」 */
  function daysPlaceholder(m) {
    return "預設( " + (m.monthKey % 12 + 1) + " 月有 " + m.autoDays + " 個工作天)";
  }

  function render() {
    if (!model) return;
    // 工作天數是自動的、而且月份已經換了（例如跨到 12 月）→ 重新算
    var nowD = new Date(Date.now());
    if (model.useAuto && model.monthKey !== nowD.getFullYear() * 12 + nowD.getMonth()) {
      model = buildModel(readForm());
      el.days.placeholder = daysPlaceholder(model);
    }
    var m = model;
    var nowSec = C.secondsOfDay(new Date(Date.now()));  // 每次都重新讀現在時間
    var p = m.timeOk ? C.phaseAt(nowSec, m.start, m.end) : { phase: "invalid", remaining: NaN };
    var worked = m.timeOk ? C.workedSeconds(nowSec, m.start, m.end, m.lunch) : 0;
    var pct = m.workSec > 0 ? Math.min(100, Math.max(0, worked / m.workSec * 100)) : 0;
    var payOk = isFinite(m.perSec) && m.timeOk && m.workSec > 0;
    var earned = payOk ? m.perSec * worked : NaN;

    // 倒數
    var cdText = C.formatCountdown(p.remaining);            // 分頁標題用整秒
    setText(el.cd, C.formatCountdown(p.remaining, 2));      // 畫面上的倒數到 0.01 秒
    el.cd.classList.toggle("done", p.phase === "after");
    setText(el.cdLabel, p.phase === "before" ? "距離上班還有" : p.phase === "after" ? "下班了！" : "距離下班還有");

    // 今天已賺
    setText(el.earnLabel, p.phase === "after" ? "今天總共賺了" : "今天已賺");
    var earnText = payOk ? C.formatMoney(earned, m.symbol, 3) : "—";
    setText(el.earn, earnText);  // 金額不做跳動動畫（更新很頻繁，動畫會一直閃）

    // 本月總共賺了 = 本月已過的工作日 × 一個工作天的薪水 + 今天已賺
    var daily = payOk ? m.perSec * m.workSec : NaN;
    var ref = new Date(Date.now());
    if (isFinite(p.t) && p.t >= 86400) ref.setDate(ref.getDate() - 1);  // 夜班過了午夜：這段薪水算在「昨天上班」那天
    var y = ref.getFullYear(), mo = ref.getMonth(), dd = ref.getDate();
    var passed = C.workdaysPassed(y, mo, dd), isWd = C.isWorkday(y, mo, dd);
    var monthEarn = payOk ? C.monthEarned(daily, passed, earned, isWd) : NaN;
    // 有填股票賠錢時：本月總共賺了 = 賺的 − 賠的，一開始是負的，隨著工作慢慢往 0、往正數走
    var lossAmt = isFinite(m.loss) && m.loss > 0 ? m.loss : 0;
    var monthNet = payOk ? monthEarn - lossAmt : NaN;
    setText(el.earnMonth, payOk ? C.formatMoney(monthNet, m.symbol, 3) : "—");
    // 台股習慣：賺（正數）紅色，賠（負數）綠色；0 或沒有資料時用一般文字色
    el.earnMonth.classList.toggle("up", payOk && monthNet > 0);
    el.earnMonth.classList.toggle("down", payOk && monthNet < 0);
    // 股票賠錢區：用本月賺的錢去抵賠的，估算還要幾個工作天
    var rec = C.recovery(m.loss, daily, monthEarn);
    // 沒填賠的金額（空白或 0）→ 顯示「不錯喔 沒有賠錢」，不顯示天數
    var noLoss = String(el.loss.value).trim() === "" || m.loss === 0;
    el.lossLabel.hidden = noLoss;
    el.lossDays.classList.toggle("ok", noLoss);
    setText(el.lossDays, noLoss ? "不錯喔 沒有賠錢" : (isFinite(rec.days) ? C.formatNumber(rec.days, 2) + " 天" : "—"));

    // 把股票賺回來的進度條：只有填了賠的金額才出現；百分比 = 本月已賺回 ÷ 賠的金額（0～100%）
    // 本月總共賺了變成正數（已經賺回來）就不用再顯示
    var showRecover = isFinite(m.loss) && m.loss > 0 && !(payOk && monthNet > 0);
    if (el.recover.hidden === showRecover) el.recover.hidden = !showRecover;
    if (showRecover) {
      var rp = payOk ? Math.min(100, Math.max(0, rec.recovered / m.loss * 100)) : 0;
      var rpText = payOk ? C.formatNumber(rp, 3) : null;
      var rw = rp.toFixed(3) + "%";
      if (el.recoverFill.style.width !== rw) el.recoverFill.style.width = rw;
      // 文字顯示「還差多少 %」= 100 − 已賺回的 %（進度條本身仍是已賺回的長度）
      setText(el.recoverText, "距離把股票賺回來還有 " + (rpText === null ? "—" : C.formatNumber(100 - rp, 3) + "%"));
      el.recoverBar.setAttribute("aria-valuenow", rpText === null ? "0" : rpText);
    }

    // 進度條
    var pctText = (m.workSec > 0 && m.timeOk) ? C.formatNumber(pct, 3) : null;
    var w = (pctText === null ? 0 : pct).toFixed(3) + "%";
    if (el.barFill.style.width !== w) el.barFill.style.width = w;
    setText(el.barText, pctText === null ? "今天已工作 —" : "今天已工作 " + pctText + "%");
    el.bar.setAttribute("aria-valuenow", pctText === null ? "0" : pctText);

    // 每小時／每分鐘／每秒
    setText(el.rateH, payOk ? C.formatMoney(m.perSec * 3600, m.symbol, 2) : "—");
    setText(el.rateD, payOk ? C.formatMoney(m.perSec * m.workSec, m.symbol, 2) : "—");  // 每天 = 一個工作天（扣掉午休）賺的

    // 分頁標題也跟著倒數
    var title = "下班倒數";
    if (p.phase === "working") title = "⏳ " + cdText + " 下班倒數";
    else if (p.phase === "before") title = "⏳ " + cdText + " 距離上班";
    else if (p.phase === "after") title = "🎉 下班了！下班倒數";
    if (document.title !== title) document.title = title;

  }

  /* ---------- 全螢幕 ----------
     先用瀏覽器的全螢幕功能；iPhone 的 Safari 不支援「讓一般區塊全螢幕」，就改用 CSS 讓區塊蓋滿整個視窗 */
  var board = $("board"), fsBtn = $("fs-btn");
  function setFs(on) {
    board.classList.toggle("fs", on);
    fsBtn.setAttribute("aria-pressed", on ? "true" : "false");
    fsBtn.textContent = on ? "✕ 離開全螢幕" : "⛶ 全螢幕";
  }
  fsBtn.addEventListener("click", function () {
    if (board.classList.contains("fs")) {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
      setFs(false);
      return;
    }
    setFs(true);
    if (board.requestFullscreen) {
      try { var r = board.requestFullscreen(); if (r && r.catch) r.catch(function () {}); } catch (e) {}
    }
  });
  // 按 Esc 離開瀏覽器全螢幕時，把畫面也還原
  document.addEventListener("fullscreenchange", function () {
    if (!document.fullscreenElement && board.classList.contains("fs")) setFs(false);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && board.classList.contains("fs")) setFs(false); });

  /* 輸入改變：重新解析、存起來、更新欄位顯示狀態、立刻重畫 */
  function onChange() {
    var s = readForm();
    save(s);
    model = buildModel(s);

    var hourly = s.type === "hourly";
    el.amountLabel.textContent = hourly ? "時薪" : "月薪";
    el.amount.placeholder = hourly ? "例如 200" : "例如 50000";
    el.fieldDays.hidden = hourly;
    el.days.placeholder = daysPlaceholder(model);
    el.lunchStart.disabled = el.lunchEnd.disabled = !s.lunchOn;

    el.hint.hidden = !model.hint;
    el.hint.textContent = model.hint;
    var amountBad = String(s.amount).trim() !== "" && (!isFinite(model.amount) || model.amount < 0);
    el.amount.setAttribute("aria-invalid", amountBad ? "true" : "false");

    render();
  }

  /* ---------- 今日大盤指數（股票賠錢區） ----------
     資料來自自己的 Cloudflare Worker（worker/taiex-worker.js，替網頁去問證交所）。
     TAIEX_URL 留空 = 還沒設定 → 這一行整個不顯示。盤中每 30 秒更新一次，分頁在背景就暫停 */
  var TAIEX_URL = "https://taiex.kop030183.workers.dev/";
  var taiexEl = $("taiex"), taiexVal = $("taiex-val");
  var taiexAt = 0, taiexBusy = false;

  function showTaiex(d) {
    var has = typeof d.price === "number";
    setText(taiexVal, has ? C.formatIndex(d.price, d.prev) : "尚未開盤");
    // 台股習慣：漲紅、跌綠
    taiexVal.className = has && d.price > d.prev ? "up" : has && d.price < d.prev ? "down" : "";
  }

  function loadTaiex() {
    if (!TAIEX_URL || taiexBusy || document.hidden) return;
    taiexBusy = true;
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    fetch(TAIEX_URL, ctl ? { signal: ctl.signal, cache: "no-store" } : { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { if (d && typeof d.prev === "number") { taiexAt = Date.now(); showTaiex(d); } })
      .catch(function () { /* 抓失敗就保留上一筆數字，30 秒後再試 */ })
      .then(function () { clearTimeout(timer); taiexBusy = false; });
  }

  if (TAIEX_URL) {
    taiexEl.hidden = false;
    loadTaiex();
    setInterval(loadTaiex, 30000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && Date.now() - taiexAt > 30000) loadTaiex(); });
  }

  /* ---------- 啟動 ---------- */
  writeForm(load());
  document.addEventListener("input", function (e) { if (e.target.closest && e.target.closest(".form")) onChange(); });
  document.addEventListener("change", function (e) { if (e.target.closest && e.target.closest(".form")) onChange(); });
  onChange();

  // 畫面跟著螢幕的更新頻率重畫（通常每秒 60 次），倒數的 0.01 秒才會順；requestAnimationFrame 是瀏覽器「下一次要畫畫面前」叫我們的機制
  function frame() { render(); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  // 分頁在背景時瀏覽器會暫停 requestAnimationFrame，用較慢的計時器讓分頁標題繼續更新
  setInterval(render, 1000);  // （畫面本來就在更新時，這個只是多算一次，不會有差別）
  // 分頁從背景切回來、電腦睡眠醒來：立刻用現在時間重算，不等下一次 setInterval
  document.addEventListener("visibilitychange", render);
  window.addEventListener("focus", render);
  window.addEventListener("pageshow", render);
})();
