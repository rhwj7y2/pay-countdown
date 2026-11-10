/* 下班倒數：所有計算都寫成「純函式」
   （同樣輸入一定得到同樣輸出；不碰畫面、不自己讀現在時間，現在時間一律用參數傳進來）。
   時間一律用「當天從 00:00 起算的秒數」表示：09:00 = 32400。 */
(function (root) {
  "use strict";

  var DAY = 86400;

  /* "09:30" 或 "09:30:15" → 秒數；格式不對回傳 NaN */
  function parseTime(str) {
    var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(str == null ? "" : str).trim());
    if (!m) return NaN;
    var h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0;
    if (h > 23 || mi > 59 || s > 59) return NaN;
    return h * 3600 + mi * 60 + s;
  }

  /* Date → 當天從 00:00 起算的秒數（含毫秒，所以是小數）。傳進來的 Date 由呼叫端決定，這個函式本身不讀時鐘 */
  function secondsOfDay(date) {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000;
  }

  /* 班次視窗：下班 <= 上班 視為「下班在隔天」（夜班）；上下班一樣回傳 null（不合法） */
  function shiftWindow(startSec, endSec) {
    if (!isFinite(startSec) || !isFinite(endSec) || startSec === endSec) return null;
    return { S: startSec, E: endSec > startSec ? endSec : endSec + DAY };
  }

  /* 兩段區間 [a1,a2] 與 [b1,b2] 重疊多少秒 */
  function overlap(a1, a2, b1, b2) {
    return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  }

  /* 把午休放到班次的時間軸上（夜班的午休可能落在隔天）；沒有午休回傳 null */
  function placeLunch(S, lunch) {
    if (!lunch || !isFinite(lunch.start) || !isFinite(lunch.end)) return null;
    var d = (((lunch.end - lunch.start) % DAY) + DAY) % DAY;  // 午休長度；0 = 沒有午休
    if (d === 0) return null;
    var ls = lunch.start < S ? lunch.start + DAY : lunch.start;
    return { start: ls, end: ls + d };
  }

  /* 當天有薪工作秒數 = 下班 − 上班 − 午休。午休若超出上下班範圍，只扣重疊的部分。不合法（上下班相同）回傳 0 */
  function workSeconds(startSec, endSec, lunchStartSec, lunchEndSec) {
    var w = shiftWindow(startSec, endSec);
    if (!w) return 0;
    var total = w.E - w.S;
    var l = placeLunch(w.S, { start: lunchStartSec, end: lunchEndSec });
    var cut = l ? overlap(w.S, w.E, l.start, l.end) : 0;
    return Math.max(0, total - cut);
  }

  /* 每秒薪水。
     月薪：日薪 = 月薪 ÷ 每月工作天數；每秒 = 日薪 ÷ workSec。時薪：每秒 = 時薪 ÷ 3600。
     輸入不合法（空白、負數、工作天數 <= 0、月薪但 workSec <= 0）回傳 NaN，畫面要顯示「—」。薪水 0 合法，回傳 0 */
  function perSecondPay(type, amount, workDays, workSec) {
    if (typeof amount !== "number" || !isFinite(amount) || amount < 0) return NaN;
    if (type === "hourly") return amount / 3600;
    if (type === "monthly") {
      if (!isFinite(workDays) || workDays <= 0 || !isFinite(workSec) || workSec <= 0) return NaN;
      return amount / workDays / workSec;
    }
    return NaN;
  }

  /* 現在處於哪個階段，以及距離下一個事件（上班或下班）還有幾秒。
     回傳 { phase: "before" | "working" | "after" | "invalid", remaining, S, E, t }
       before  = 還沒上班（remaining = 距離上班）
       working = 上班中（remaining = 距離下班）
       after   = 已下班（remaining = 0）
     t 是「現在」放到班次時間軸上的位置，S/E 是上下班在同一條時間軸上的位置。
     日班：現在 < 上班 → before；>= 下班 → after（只看「今天」）。
     夜班（下班在隔天）：凌晨還在昨晚那班的後半段 → working；
       下班到下一次上班之間的空檔，前半段算 after（剛下班要看到「下班了！」），後半段算 before（準備上班）。 */
  function phaseAt(nowSec, startSec, endSec) {
    var w = shiftWindow(startSec, endSec);
    if (!w || !isFinite(nowSec)) return { phase: "invalid", remaining: NaN, S: NaN, E: NaN, t: NaN };
    var S = w.S, E = w.E, t = nowSec;
    var overnight = E > DAY;
    if (overnight) {
      var tail = E - DAY;  // 昨晚那班在今天的下班時間
      if (t < tail) {
        t += DAY;
      } else if (t < S) {
        var mid = (tail + S) / 2;
        if (t < mid) return { phase: "after", remaining: 0, S: S, E: E, t: E };
        return { phase: "before", remaining: S - t, S: S, E: E, t: t };
      }
    }
    if (t < S) return { phase: "before", remaining: S - t, S: S, E: E, t: t };
    if (t < E) return { phase: "working", remaining: E - t, S: S, E: E, t: t };
    return { phase: "after", remaining: 0, S: S, E: E, t: t };
  }

  /* 已工作秒數 = 現在 − 上班，再扣掉「已經過去的午休」，限制在 0 ~ workSec。
     lunch 是 { start, end }（秒數）或 null */
  function workedSeconds(nowSec, startSec, endSec, lunch) {
    var p = phaseAt(nowSec, startSec, endSec);
    if (p.phase === "invalid") return 0;
    var total = workSeconds(startSec, endSec, lunch ? lunch.start : NaN, lunch ? lunch.end : NaN);
    if (p.phase === "before") return 0;
    if (p.phase === "after") return total;
    var l = placeLunch(p.S, lunch);
    var lunchDone = l ? overlap(p.S, p.t, l.start, l.end) : 0;
    return Math.min(total, Math.max(0, p.t - p.S - lunchDone));
  }

  /* 秒數 → "hh:mm:ss"。小數秒無條件進位（還剩 0.4 秒仍顯示 00:00:01，到 0 才顯示 00:00:00）；負數當 0；NaN 顯示 "—"；
     超過 99 小時就多一位數（不截斷） */
  function formatCountdown(seconds, decimals) {
    if (typeof seconds !== "number" || isNaN(seconds)) return "—";
    var d = decimals || 0;               // 秒後面要顯示幾位小數（0 = 只到整秒；1 = 到 0.1 秒）
    var pow = Math.pow(10, d);
    var t = Math.max(0, Math.ceil(seconds * pow - 1e-6));  // 以「最小單位」計的整數（小數位 1 位時就是 0.1 秒的個數）
    var s = Math.floor(t / pow), frac = t - s * pow;
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (sec < 10 ? "0" : "") + sec +
      (d > 0 ? "." + String(frac).padStart(d, "0") : "");
  }

  /* 數字 → 千分位 + 固定小數位數。
     四捨五入規則：離 0 較遠的方向進位（half away from zero），0.05 → 0.1、0.15 → 0.2、-0.05 → -0.1；
     另外加一點點容許誤差，避免 JS 浮點數表示法讓 1.005 之類的數字少進一位。
     四捨五入後等於 0 就不顯示負號（不會出現 "-0.0"）。NaN / 無限大顯示 "—" */
  function formatNumber(value, decimals) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    var d = decimals == null ? 1 : decimals;
    var pow = Math.pow(10, d);
    var scaled = Math.round(Math.abs(value) * pow + 1e-9);
    var intPart = Math.floor(scaled / pow);
    var frac = scaled - intPart * pow;
    var intStr = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var out = d > 0 ? intStr + "." + String(frac).padStart(d, "0") : intStr;
    return (value < 0 && scaled > 0 ? "-" : "") + out;
  }

  /* 金額 → "NT$ 1,234.5"（符號和數字中間一個空格；符號空白就只顯示數字；小數位數預設 1 位） */
  function formatMoney(value, symbol, decimals) {
    var n = formatNumber(value, decimals == null ? 1 : decimals);
    if (n === "—") return n;
    var sym = symbol == null ? "" : String(symbol).trim();
    return sym ? sym + " " + n : n;
  }

  var api = {
    parseTime: parseTime,
    secondsOfDay: secondsOfDay,
    workSeconds: workSeconds,
    perSecondPay: perSecondPay,
    phaseAt: phaseAt,
    workedSeconds: workedSeconds,
    formatCountdown: formatCountdown,
    formatNumber: formatNumber,
    formatMoney: formatMoney
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;  // Node 測試用
  else root.PayCalc = api;                                                     // 瀏覽器用
})(typeof window !== "undefined" ? window : this);
