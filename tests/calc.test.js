const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../calc.js");

const H = 3600;
const hms = (h, m = 0, s = 0) => h * 3600 + m * 60 + s;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} 應該接近 ${b}（容許誤差 ${tol}）`);

// 一般班 09:00～18:00，午休 12:00～13:00 → 有薪 8 小時
const S = hms(9), E = hms(18);
const LUNCH = { start: hms(12), end: hms(13) };
const WORK = C.workSeconds(S, E, LUNCH.start, LUNCH.end);

test("parseTime：合法與不合法格式", () => {
  assert.equal(C.parseTime("09:00"), 32400);
  assert.equal(C.parseTime("9:05"), 9 * 3600 + 300);
  assert.equal(C.parseTime("23:59:59"), 86399);
  assert.ok(Number.isNaN(C.parseTime("")));
  assert.ok(Number.isNaN(C.parseTime("24:00")));
  assert.ok(Number.isNaN(C.parseTime("12:60")));
  assert.ok(Number.isNaN(C.parseTime("abc")));
  assert.ok(Number.isNaN(C.parseTime(null)));
});

test("secondsOfDay：用傳進來的 Date，含毫秒", () => {
  assert.equal(C.secondsOfDay(new Date(2026, 0, 1, 9, 30, 15, 500)), 9 * 3600 + 30 * 60 + 15.5);
});

test("workSeconds：一般班扣午休", () => {
  assert.equal(WORK, 8 * H);
  assert.equal(C.workSeconds(S, E, NaN, NaN), 9 * H, "沒有午休就不扣");
  assert.equal(C.workSeconds(S, E, hms(12), hms(12)), 9 * H, "午休起訖相同 = 沒有午休");
});

test("workSeconds：午休超出上下班範圍只扣重疊的部分", () => {
  assert.equal(C.workSeconds(S, E, hms(17, 30), hms(18, 30)), 9 * H - 1800);
  assert.equal(C.workSeconds(S, E, hms(7), hms(8)), 9 * H, "午休完全在上班前 → 不扣");
});

test("workSeconds：夜班跨午夜 22:00～06:00", () => {
  assert.equal(C.workSeconds(hms(22), hms(6), NaN, NaN), 8 * H);
  assert.equal(C.workSeconds(hms(22), hms(6), hms(2), hms(3)), 7 * H, "午休在凌晨");
  assert.equal(C.workSeconds(hms(22), hms(6), hms(23), hms(23, 30)), 8 * H - 1800, "午休在午夜前");
});

test("workSeconds：上下班時間相同 = 0", () => {
  assert.equal(C.workSeconds(S, S, NaN, NaN), 0);
});

test("一般班：上班前", () => {
  const p = C.phaseAt(hms(8), S, E);
  assert.equal(p.phase, "before");
  assert.equal(p.remaining, H);
  assert.equal(C.workedSeconds(hms(8), S, E, LUNCH), 0);
});

test("一般班：剛上班（09:00:00 與 09:00:01）", () => {
  assert.equal(C.phaseAt(hms(9), S, E).phase, "working");
  assert.equal(C.phaseAt(hms(9), S, E).remaining, 9 * H);
  assert.equal(C.workedSeconds(hms(9), S, E, LUNCH), 0);
  assert.equal(C.workedSeconds(hms(9, 0, 1), S, E, LUNCH), 1);
});

test("一般班：午休中，已工作秒數停住不動", () => {
  const before = C.workedSeconds(hms(12), S, E, LUNCH);
  assert.equal(before, 3 * H);
  assert.equal(C.workedSeconds(hms(12, 30), S, E, LUNCH), 3 * H);
  assert.equal(C.workedSeconds(hms(13), S, E, LUNCH), 3 * H);
  assert.equal(C.workedSeconds(hms(13, 0, 1), S, E, LUNCH), 3 * H + 1);
  // 倒數照常走
  assert.equal(C.phaseAt(hms(12, 30), S, E).remaining, hms(18) - hms(12, 30));
});

test("午休中薪水不增加：午休前後兩個時間點金額相同", () => {
  const pay = C.perSecondPay("monthly", 50000, 22, WORK);
  const a = pay * C.workedSeconds(hms(12), S, E, LUNCH);
  const b = pay * C.workedSeconds(hms(13), S, E, LUNCH);
  assert.equal(a, b);
  const c = pay * C.workedSeconds(hms(13, 0, 10), S, E, LUNCH);
  assert.ok(c > b);
});

test("一般班：下班前一秒、剛好下班、下班後", () => {
  const p1 = C.phaseAt(hms(17, 59, 59), S, E);
  assert.equal(p1.phase, "working");
  assert.equal(p1.remaining, 1);
  assert.equal(C.workedSeconds(hms(17, 59, 59), S, E, LUNCH), WORK - 1);

  const p2 = C.phaseAt(hms(18), S, E);
  assert.equal(p2.phase, "after");
  assert.equal(p2.remaining, 0);
  assert.equal(C.workedSeconds(hms(18), S, E, LUNCH), WORK);

  assert.equal(C.phaseAt(hms(20), S, E).phase, "after");
  assert.equal(C.workedSeconds(hms(20), S, E, LUNCH), WORK, "下班後停在整天");
});

test("已工作秒數不會超過 workSec、也不會小於 0", () => {
  for (let sec = 0; sec < 86400; sec += 97) {
    const w = C.workedSeconds(sec, S, E, LUNCH);
    assert.ok(w >= 0 && w <= WORK, `sec=${sec} w=${w}`);
  }
});

test("月薪 50,000、22 天：整天工作完 = 日薪（容許浮點誤差）", () => {
  const pay = C.perSecondPay("monthly", 50000, 22, WORK);
  near(pay * WORK, 50000 / 22, 1e-9);
  near(pay * C.workedSeconds(hms(18), S, E, LUNCH), 2272.7272727, 1e-6);
  near(pay * C.workedSeconds(hms(18, 5), S, E, LUNCH), 2272.7272727, 1e-6, "下班後金額不再增加");
});

test("時薪：每秒 = 時薪 ÷ 3600", () => {
  near(C.perSecondPay("hourly", 3600, 22, WORK), 1, 1e-12);
  near(C.perSecondPay("hourly", 200, 22, WORK) * 3600, 200, 1e-9);
  near(C.perSecondPay("hourly", 200, NaN, 0) * 3600, 200, 1e-9, "時薪不需要工作天數與 workSec");
});

test("薪水 0 合法；空白、負數、工作天數 0 不合法 → NaN", () => {
  assert.equal(C.perSecondPay("monthly", 0, 22, WORK), 0);
  assert.equal(C.perSecondPay("hourly", 0, 22, WORK), 0);
  assert.ok(Number.isNaN(C.perSecondPay("monthly", NaN, 22, WORK)));
  assert.ok(Number.isNaN(C.perSecondPay("monthly", -1, 22, WORK)));
  assert.ok(Number.isNaN(C.perSecondPay("hourly", -1, 22, WORK)));
  assert.ok(Number.isNaN(C.perSecondPay("monthly", 50000, 0, WORK)));
  assert.ok(Number.isNaN(C.perSecondPay("monthly", 50000, 22, 0)), "workSec = 0 不能除");
  assert.ok(Number.isNaN(C.perSecondPay("weekly", 50000, 22, WORK)));
});

test("上下班時間相同 → invalid，不產生負數或 NaN 以外的怪值", () => {
  const p = C.phaseAt(hms(10), S, S);
  assert.equal(p.phase, "invalid");
  assert.equal(C.workedSeconds(hms(10), S, S, null), 0);
});

test("夜班 22:00～06:00：班前、班中（含午夜後）、下班", () => {
  const s = hms(22), e = hms(6);
  const WS = C.workSeconds(s, e, NaN, NaN);
  assert.equal(WS, 8 * H);

  const a = C.phaseAt(hms(21), s, e);
  assert.equal(a.phase, "before");
  assert.equal(a.remaining, H);
  assert.equal(C.workedSeconds(hms(21), s, e, null), 0);

  const b = C.phaseAt(hms(23), s, e);
  assert.equal(b.phase, "working");
  assert.equal(b.remaining, 7 * H);
  assert.equal(C.workedSeconds(hms(23), s, e, null), H);

  const c = C.phaseAt(hms(0), s, e);  // 午夜整點
  assert.equal(c.phase, "working");
  assert.equal(c.remaining, 6 * H);
  assert.equal(C.workedSeconds(hms(0), s, e, null), 2 * H);

  const d = C.phaseAt(hms(3), s, e);
  assert.equal(d.phase, "working");
  assert.equal(d.remaining, 3 * H);
  assert.equal(C.workedSeconds(hms(3), s, e, null), 5 * H);

  const f = C.phaseAt(hms(5, 59, 59), s, e);
  assert.equal(f.phase, "working");
  assert.equal(f.remaining, 1);

  const g = C.phaseAt(hms(6), s, e);
  assert.equal(g.phase, "after");
  assert.equal(g.remaining, 0);
  assert.equal(C.workedSeconds(hms(6), s, e, null), WS);
});

test("夜班：下班到下次上班的空檔，前半段算已下班、後半段算還沒上班", () => {
  const s = hms(22), e = hms(6);  // 空檔 06:00～22:00，中點 14:00
  assert.equal(C.phaseAt(hms(12), s, e).phase, "after");
  assert.equal(C.phaseAt(hms(13, 59, 59), s, e).phase, "after");
  const p = C.phaseAt(hms(14), s, e);
  assert.equal(p.phase, "before");
  assert.equal(p.remaining, 8 * H);
});

test("夜班有午休（02:00～03:00）：午休後已工作秒數少一小時", () => {
  const s = hms(22), e = hms(6), l = { start: hms(2), end: hms(3) };
  assert.equal(C.workSeconds(s, e, l.start, l.end), 7 * H);
  assert.equal(C.workedSeconds(hms(2), s, e, l), 4 * H);
  assert.equal(C.workedSeconds(hms(2, 30), s, e, l), 4 * H, "午休中不增加");
  assert.equal(C.workedSeconds(hms(3), s, e, l), 4 * H);
  assert.equal(C.workedSeconds(hms(4), s, e, l), 5 * H);
  assert.equal(C.workedSeconds(hms(6), s, e, l), 7 * H);
  // 全程不會出現負數
  for (let sec = 0; sec < 86400; sec += 61) assert.ok(C.workedSeconds(sec, s, e, l) >= 0);
});

test("formatCountdown", () => {
  assert.equal(C.formatCountdown(0), "00:00:00");
  assert.equal(C.formatCountdown(1), "00:00:01");
  assert.equal(C.formatCountdown(3661), "01:01:01");
  assert.equal(C.formatCountdown(9 * H), "09:00:00");
  assert.equal(C.formatCountdown(59.2), "00:01:00", "小數秒進位");
  assert.equal(C.formatCountdown(0.4), "00:00:01");
  assert.equal(C.formatCountdown(-5), "00:00:00", "負數當 0");
  assert.equal(C.formatCountdown(100 * H), "100:00:00");
  assert.equal(C.formatCountdown(NaN), "—");
});

test("isWorkday：2026-11 月（11/1 是週日）", () => {
  assert.equal(C.isWorkday(2026, 10, 1), false);  // 週日
  assert.equal(C.isWorkday(2026, 10, 2), true);   // 週一
  assert.equal(C.isWorkday(2026, 10, 6), true);   // 週五
  assert.equal(C.isWorkday(2026, 10, 7), false);  // 週六
  assert.equal(C.isWorkday(2026, 10, 10), true);  // 週二
});

test("workdaysPassed：不含當天，只算週一到週五", () => {
  assert.equal(C.workdaysPassed(2026, 10, 1), 0, "1 號之前沒有任何天");
  assert.equal(C.workdaysPassed(2026, 10, 2), 0, "1 號是週日");
  assert.equal(C.workdaysPassed(2026, 10, 3), 1, "到 11/3 之前只過了 11/2 一個工作日");
  assert.equal(C.workdaysPassed(2026, 10, 11), 7, "11/2-6 五天 + 11/9、11/10 = 7");
  assert.equal(C.workdaysPassed(2026, 10, 30), 20, "30 號之前共 20 個工作日（整月共 21 個）");
  assert.equal(C.workdaysPassed(2026, 10, 99), 21, "超過月底不會多算");
});

test("workdaysInMonth：該月有幾個週一到週五", () => {
  assert.equal(C.workdaysInMonth(2026, 10), 21, "2026 年 11 月 = 21");
  assert.equal(C.workdaysInMonth(2026, 11), 23, "2026 年 12 月 = 23");
  assert.equal(C.workdaysInMonth(2026, 1), 20, "2026 年 2 月 = 20（28 天）");
  assert.equal(C.workdaysInMonth(2024, 1), 21, "2024 年 2 月（閏年 29 天）= 21");
});

test("月薪依該月工作天數算日薪：同樣 50,000，11 月（21 天）比 12 月（23 天）日薪高", () => {
  const nov = C.perSecondPay("monthly", 50000, C.workdaysInMonth(2026, 10), WORK) * WORK;
  const dec = C.perSecondPay("monthly", 50000, C.workdaysInMonth(2026, 11), WORK) * WORK;
  near(nov, 50000 / 21, 1e-9);
  near(dec, 50000 / 23, 1e-9);
  assert.ok(nov > dec);
  near(nov * C.workdaysInMonth(2026, 10), 50000, 1e-6, "整個月做滿 = 月薪");
});

test("monthEarned：已過工作日 × 日薪 + 今天", () => {
  assert.equal(C.monthEarned(2000, 7, 500, true), 14500);
  assert.equal(C.monthEarned(2000, 7, 500, false), 14000, "今天不是工作日 → 不算今天");
  assert.equal(C.monthEarned(2000, 0, 0, true), 0);
  assert.ok(Number.isNaN(C.monthEarned(NaN, 7, 0, true)));
  assert.ok(Number.isNaN(C.monthEarned(-1, 7, 0, true)));
});

test("本月賺的拿去抵賠的：賠 2 萬、日薪 2000、本月已過 7 天 + 今天 500 → 還差 5500", () => {
  const month = C.monthEarned(2000, 7, 500, true);
  const r = C.recovery(20000, 2000, month);
  assert.equal(r.recovered, 14500);
  assert.equal(r.remaining, 5500);
  near(r.days, 2.75, 1e-9);
});

test("recovery：賠 10 萬、日薪 2000 → 還要 50 天", () => {
  const r = C.recovery(100000, 2000, 0);
  assert.equal(r.days, 50);
  assert.equal(r.remaining, 100000);
  assert.equal(r.recovered, 0);
});

test("recovery：今天已賺的會先扣掉", () => {
  const r = C.recovery(100000, 2000, 500);
  assert.equal(r.recovered, 500);
  assert.equal(r.remaining, 99500);
  near(r.days, 49.75, 1e-9);
});

test("recovery：用月薪 50,000／22 天／8 小時算整天，賠 1 萬 ≈ 4.4 天", () => {
  const pay = C.perSecondPay("monthly", 50000, 22, WORK);
  const daily = pay * WORK;
  near(C.recovery(10000, daily, 0).days, 10000 / (50000 / 22), 1e-9);
  near(C.recovery(10000, daily, 0).days, 4.4, 1e-9);
});

test("recovery：今天已賺比賠的多 → 已賺回，0 天，recovered 不超過 loss", () => {
  const r = C.recovery(1000, 2000, 1500);
  assert.equal(r.recovered, 1000);
  assert.equal(r.remaining, 0);
  assert.equal(r.days, 0);
});

test("recovery：賠 0 → 全 0；空白、負數、不是數字 → NaN；日薪 0 → days NaN", () => {
  assert.deepEqual(C.recovery(0, 2000, 0), { recovered: 0, remaining: 0, days: 0 });
  assert.ok(Number.isNaN(C.recovery(NaN, 2000, 0).days));
  assert.ok(Number.isNaN(C.recovery(-5, 2000, 0).days));
  const z = C.recovery(1000, 0, 0);
  assert.equal(z.remaining, 1000);
  assert.ok(Number.isNaN(z.days));
  assert.ok(Number.isNaN(C.recovery(1000, NaN, 0).days));
});

test("formatCountdown：秒後面帶 0.1 秒（小數位 1 位）", () => {
  assert.equal(C.formatCountdown(0, 1), "00:00:00.0");
  assert.equal(C.formatCountdown(3661.25, 1), "01:01:01.3", "0.25 秒進位成 0.3");
  assert.equal(C.formatCountdown(59.95, 1), "00:01:00.0", "進位到整秒");
  assert.equal(C.formatCountdown(0.04, 1), "00:00:00.1");
  assert.equal(C.formatCountdown(10.5, 1), "00:00:10.5");
  assert.equal(C.formatCountdown(-1, 1), "00:00:00.0");
  assert.equal(C.formatCountdown(NaN, 1), "—");
});

test("formatCountdown：秒後面帶 0.01 秒（小數位 2 位）", () => {
  assert.equal(C.formatCountdown(5402.6, 2), "01:30:02.60");
  assert.equal(C.formatCountdown(0.001, 2), "00:00:00.01");
  assert.equal(C.formatCountdown(59.999, 2), "00:01:00.00");
  assert.equal(C.formatCountdown(0, 2), "00:00:00.00");
});

test("formatMoney：三位小數（今天已賺用）", () => {
  assert.equal(C.formatMoney(584.7912, "NT$", 3), "NT$ 584.791");
  assert.equal(C.formatMoney(0, "NT$", 3), "NT$ 0.000");
  assert.equal(C.formatMoney(1234.0005, "NT$", 3), "NT$ 1,234.001");
});

test("formatMoney：兩位小數", () => {
  assert.equal(C.formatMoney(1234.5, "NT$", 2), "NT$ 1,234.50");
  assert.equal(C.formatMoney(0, "NT$", 2), "NT$ 0.00");
  assert.equal(C.formatMoney(0.005, "NT$", 2), "NT$ 0.01");
  assert.equal(C.formatMoney(1136.3636, "NT$", 2), "NT$ 1,136.36");
});

test("formatMoney：千分位、固定小數點後一位", () => {
  assert.equal(C.formatMoney(1234.5, "NT$"), "NT$ 1,234.5");
  assert.equal(C.formatMoney(1234, "NT$"), "NT$ 1,234.0");
  assert.equal(C.formatMoney(0, "NT$"), "NT$ 0.0");
  assert.equal(C.formatMoney(1234567.89, "NT$"), "NT$ 1,234,567.9");
  assert.equal(C.formatMoney(999, "NT$"), "NT$ 999.0");
  assert.equal(C.formatMoney(1000, "$"), "$ 1,000.0");
});

test("formatMoney 四捨五入規則：離 0 較遠的方向進位（0.05 → 0.1）", () => {
  assert.equal(C.formatMoney(0.05, "NT$"), "NT$ 0.1");
  assert.equal(C.formatMoney(0.04, "NT$"), "NT$ 0.0");
  assert.equal(C.formatMoney(0.049999, "NT$"), "NT$ 0.0");
  assert.equal(C.formatMoney(0.15, "NT$"), "NT$ 0.2");
  assert.equal(C.formatMoney(0.25, "NT$"), "NT$ 0.3");
  assert.equal(C.formatMoney(1.05, "NT$"), "NT$ 1.1");
  assert.equal(C.formatMoney(999.95, "NT$"), "NT$ 1,000.0", "進位到整數時千分位也要對");
  assert.equal(C.formatMoney(-0.04, "NT$"), "NT$ 0.0", "不出現 -0.0");
  assert.equal(C.formatMoney(-5.25, "NT$"), "NT$ -5.3");
});

test("formatMoney：符號空白、不合法數字", () => {
  assert.equal(C.formatMoney(1234.5, ""), "1,234.5");
  assert.equal(C.formatMoney(1234.5, "  "), "1,234.5");
  assert.equal(C.formatMoney(1234.5, "¥"), "¥ 1,234.5");
  assert.equal(C.formatMoney(NaN, "NT$"), "—");
  assert.equal(C.formatMoney(Infinity, "NT$"), "—");
});

test("formatNumber：兩位小數（給每小時／每分鐘／每秒用）", () => {
  assert.equal(C.formatNumber(0.0701, 2), "0.07");
  assert.equal(C.formatNumber(284.09090909, 2), "284.09");
  assert.equal(C.formatNumber(1234.005, 2), "1,234.01");
  assert.equal(C.formatNumber(5, 0), "5");
});

test("formatIndex：大盤指數 + 漲跌幅", () => {
  assert.equal(C.formatIndex(42711.92, 41661.70), "42711.9(+2.5%)");   // 漲 2.52%
  assert.equal(C.formatIndex(40000, 41661.70), "40000.0(-4.0%)");      // 跌 3.99%
  assert.equal(C.formatIndex(41661.70, 41661.70), "41661.7(0.0%)");    // 平盤：沒有 + 也沒有 -
  assert.equal(C.formatIndex(41662, 41661.70), "41662.0(0.0%)");       // 漲不到 0.05% → 四捨五入是 0.0，不帶 +
  assert.equal(C.formatIndex(100000, 50000), "100000.0(+100.0%)");     // 不加千分位
  assert.equal(C.formatIndex(NaN, 100), "—");
  assert.equal(C.formatIndex(100, 0), "—");                            // 前日收盤 0 不能當分母
  assert.equal(C.formatIndex(null, 100), "—");
});
