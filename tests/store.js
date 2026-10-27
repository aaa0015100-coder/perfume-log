// 存取往返、schema 升級、匯出→匯入、壞檔、合併規則、貼上解析
const { load, fakeStorage, suite } = require("./harness");
const T = suite("store");

(async () => {
  // --- 存取往返 ---
  {
    const { run, ls } = load();
    T.eq(run("store.load()"), { data: run("freshData()") }, "空的 localStorage 回傳預設資料");
    T.eq(run("freshData().schema"), 3, "schema 3");
    run(`S = { schema: 3, items: [normalizeItem({ brand: "Le Labo", name: "Santal 33", status: "own", conc: "edp", families: ["woody","leather"], notes: { top: ["小荳蔻"], mid: ["鳶尾"], base: ["檀香"] }, buyDate: "2026-01-31", price: "6,800", volume: "50" })], wears: [], settings: normalizeSettings({}) }; S.wears = [normalizeWear({ itemId: S.items[0].id, date: "2026-10-01", occasion: "work", sprays: "3", hours: "6.5", memo: "第一天" })];`);
    T.ok(run("store.save(S)") === true, "save 成功");
    const back = run("store.load()").data;
    T.eq(back, run("S"), "save → load 相同");
    T.eq(back.items[0].buyDate, "2026-01-31", "只記日期的欄位不跑掉");
    T.eq(back.items[0].price, 6800, "價格去千分位轉數字");
    T.ok(ls.getItem("perfume-log-data").length > 10, "只寫入 perfume-log-data");
    T.eq([...ls._m.keys()], ["perfume-log-data"], "沒有其他鍵");
  }
  // --- schema 1 → 2 升級 ---
  {
    const v1 = { schema: 1, items: [{ id: "a", brand: "A", name: "B" }], settings: { lastBackup: 123 } };
    const { run } = load({ localStorage: fakeStorage({ "perfume-log-data": JSON.stringify(v1) }) });
    const d = run("store.load()").data;
    T.eq([d.schema, d.items.length, d.wears, d.settings.lastBackup, d.settings.seasonMonths.length], [3, 1, [], 123, 12], "v1 資料升級到 v3 不掉資料");
    const v2 = { schema: 2, items: [{ id: "a", brand: "A", name: "B" }], wears: [{ id: "w1", itemId: "a", date: "2026-02-30x" }, { id: "w2", itemId: "ghost", date: "2026-01-01" }, null], settings: { seasonMonths: ["x"] } };
    const { run: r2 } = load({ localStorage: fakeStorage({ "perfume-log-data": JSON.stringify(v2) }) });
    const d2 = r2("store.load()").data;
    T.eq([d2.wears.length, d2.wears[0].id, /^\d{4}-\d{2}-\d{2}$/.test(d2.wears[0].date), d2.settings.seasonMonths[6]], [1, "w1", true, "summer"], "日誌正規化：孤兒略過、壞日期修正、壞月份表用預設");
  }
  // --- 日誌、季節、推薦 ---
  {
    const { run } = load();
    T.eq(["2026-01-15", "2026-03-01", "2026-06-30", "2026-09-01", "2026-12-31"].map(d => run(`seasonOf("${d}")`)), ["winter", "spring", "summer", "autumn", "winter"], "預設季節");
    T.eq(run(`seasonOf("2026-09-15", ["winter","winter","spring","spring","summer","summer","summer","summer","summer","autumn","autumn","winter"])`), "summer", "自訂季節月份");
    T.eq(run(`(() => { const m = wearIndex([{itemId:"a",date:"2026-01-02"},{itemId:"a",date:"2026-03-01"},{itemId:"b",date:"2025-12-31"}]); return [m.get("a"), m.get("b").count]; })()`), [{ count: 2, last: "2026-03-01" }, 1], "穿著次數與上次日期");
    T.eq([run(`agoText("", "2026-10-26")`), run(`agoText("2026-10-26", "2026-10-26")`), run(`agoText("2026-10-25", "2026-10-26")`), run(`agoText("2026-09-26", "2026-10-26")`)], ["還沒噴過", "今天", "昨天", "30 天前"], "上次噴文字");
    const pickIds = run(`(() => {
      const it = (id, o) => normalizeItem(Object.assign({ id, brand: "B", name: id, status: "own" }, o));
      const items = [it("summerOnly", { seasons: ["summer"] }), it("old", { seasons: ["autumn"] }), it("never", { seasons: ["autumn"] }), it("today", { seasons: ["autumn"] }),
        it("noSeason", {}), it("nightOnly", { seasons: ["autumn"], times: ["night"] }), it("want", { status: "want", seasons: ["autumn"] }), it("dec", { status: "decant", seasons: ["autumn"] })];
      const wi = wearIndex([{ itemId: "old", date: "2026-01-01" }, { itemId: "today", date: "2026-10-26" }, { itemId: "dec", date: "2026-10-20" }]);
      return pickCandidates(items, wi, "autumn", "day", "2026-10-26").map(x => x.id);
    })()`);
    T.eq(pickIds, ["never", "old", "dec", "nightOnly", "noSeason", "today"], "今天噴什麼排序：今天噴過放最後→季節符合→時段→最久沒噴");
    const mw = run(`(() => { const r = mergeWears([{id:"1",itemId:"a",updated:5},{id:"2",itemId:"x",updated:1}], [{id:"1",itemId:"a",updated:9,memo:"new"},{id:"3",itemId:"a",updated:1},{id:"4",itemId:"zz",updated:1}], new Set(["a"])); return [r.wears.map(w=>w.id), r.wears[0].memo, r.added]; })()`);
    T.eq(mw, [["1", "3"], "new", 1], "日誌合併：較新優先、孤兒略過");
    const vi = run(`validateImport(JSON.stringify({ app:"perfume-log", schema:2, items:[{id:"a",brand:"A",name:"B"}], wears:[{id:"w",itemId:"a",date:"2026-01-01"},{id:"w",itemId:"a",date:"2026-01-02"},{id:"q",itemId:"nope"}], settings:{ seasonMonths: DEFAULT_MONTHS } }))`);
    T.eq([vi.wears.length, vi.settings.seasonMonths.length], [1, 12], "匯入日誌：重複 id 與孤兒略過");
    const oldFile = run(`validateImport(JSON.stringify({ app:"perfume-log", schema:1, items:[{id:"a",brand:"A",name:"B"}] }))`);
    T.eq([oldFile.items.length, oldFile.wears.length], [1, 0], "v0.1 的備份檔可以匯入");
  }
  // --- 統計與願望清單 ---
  {
    const { run } = load();
    T.eq([run("money(0)"), run("money(6800)"), run("money(1234567.4)")], ["NT$ 0", "NT$ 6,800", "NT$ 1,234,567"], "金額格式");
    const st = run(`(() => {
      const it = (id, o) => normalizeItem(Object.assign({ id, brand: "B", name: id }, o));
      const items = [it("a", { status: "own", price: 6000, buyDate: "2026-03-01", families: ["woody","leather"], notes: { top: ["檀香"], base: ["檀香","皮革"] } }),
        it("b", { status: "decant", price: 900, buyDate: "2025-12-01", families: ["floral"] }),
        it("c", { status: "want", price: 5000, targetPrice: "4,200", triedAt: "專櫃" }), it("d", { status: "gone", price: 1000 })];
      const W = (itemId, date) => normalizeWear({ itemId, date });
      const wears = [W("a","2026-10-20"), W("a","2026-10-01"), W("a","2025-05-01"), W("b","2026-09-30"), W("ghost","2026-10-01")];
      const all = computeStats(items, wears, "all", "2026-10-26"), yr = computeStats(items, wears, "year", "2026-10-26"), d90 = computeStats(items, wears, "90", "2026-10-26");
      return { own: all.own, decant: all.decant, want: all.want, wc: [all.wearCount, yr.wearCount, d90.wearCount], top: all.top.map(x => [x.it.id, x.count, x.cpw]), yrTop: yr.top.map(x => [x.it.id, x.count, x.cpw]),
        fams: all.fams, notes: all.notes, years: all.years.map(y => [y.year, y.n, y.sum]), thisYear: all.thisYear, total: all.totalSpend, tp: items[2].targetPrice, ta: items[2].triedAt };
    })()`);
    T.eq(st, { own: 1, decant: 1, want: 1, wc: [5, 4, 4], top: [["a", 3, 2000], ["b", 1, 900]], yrTop: [["a", 2, 2000], ["b", 1, 900]],
      fams: [{ k: "woody", n: 3 }, { k: "leather", n: 3 }, { k: "floral", n: 1 }], notes: [{ t: "皮革", n: 3 }, { t: "檀香", n: 3 }],
      years: [["2026", 1, 6000], ["2025", 1, 900], ["", 1, 1000]], thisYear: 6000, total: 7900, tp: 4200, ta: "專櫃" }, "統計計算（期間、每次成本、家族、香材、每年花費、想買不計）");
  }
  // --- 月曆與全年圖 ---
  {
    const { run } = load();
    T.eq(run(`[groupOf(normalizeItem({families:["leather","floral"]}))[0], groupOf(normalizeItem({families:["musky"]}))[0], groupOf(normalizeItem({}))[0], groupOf(undefined)[0]]`), ["g2", "g6", "g0", "g0"], "香調家族分組（取第一個家族）");
    T.eq(run(`FAM_GROUPS.flatMap(g => g[3]).sort()`), run(`keysOf(FAMS).slice().sort()`), "14 類都有分組且不重複");
    T.eq([run(`shiftMonth("2026-01", -1)`), run(`shiftMonth("2026-12", 1)`), run(`shiftMonth("2026-10", 0)`)], ["2025-12", "2027-01", "2026-10"], "月份加減跨年");
    const h = run(`(() => { const W = d => normalizeWear({ itemId: "a", date: d }); const h = heatData([W("2026-10-26"), W("2026-10-26"), W("2026-10-25"), W("2026-10-24"), W("2026-10-20"), W("2025-01-01")], "2026-10-26", 53); return { len: h.cells.length, first: h.start, firstDow: new Date(h.start + "T00:00:00").getDay(), last: h.cells[h.cells.length - 1], days: h.days, total: h.total, best: h.best, current: h.current }; })()`);
    T.eq(h, { len: 52 * 7 + 2, first: "2025-10-26", firstDow: 0, last: { date: "2026-10-26", n: 2 }, days: 4, total: 5, best: 3, current: 3 }, "全年圖：從週日開始、到今天、連續天數");
  }
  // --- v1.2：剩餘量、閒置、場合、感受、設定 ---
  {
    const { run } = load();
    const st = run(`normalizeSettings({})`);
    T.eq([st.mlPerSpray, st.defaultSprays, st.idleDays], [0.1, 3, 60], "設定預設值");
    T.eq(run(`(() => { const s = normalizeSettings({ mlPerSpray: "0.15", defaultSprays: "abc", idleDays: 2 }); return [s.mlPerSpray, s.defaultSprays, s.idleDays]; })()`), [0.15, 3, 60], "設定值檢查範圍");
    const r = run(`(() => {
      const st = normalizeSettings({});
      const W = (itemId, date, sprays) => normalizeWear({ itemId, date, sprays });
      const wears = [W("a","2026-10-01",5), W("a","2026-10-02"), W("a","2026-10-10",10), W("b","2026-10-03")];
      const a = normalizeItem({ id: "a", brand: "x", name: "a", status: "own", volume: 10 });
      const a2 = normalizeItem({ id: "a", brand: "x", name: "a", status: "own", volume: 10, level: "50", levelDate: "2026-10-05" });
      const tiny = normalizeItem({ id: "b", brand: "x", name: "b", status: "decant", volume: 2 });
      const want = normalizeItem({ id: "a", brand: "x", name: "w", status: "want", volume: 50 });
      const nov = normalizeItem({ id: "a", brand: "x", name: "n", status: "own" });
      return [remainInfo(a, wears, st), remainInfo(a2, wears, st), remainInfo(tiny, wears, st).low, remainInfo(want, wears, st), remainInfo(nov, wears, st)];
    })()`);
    T.eq(r, [{ remain: 8.2, pct: 0.82, times: 27, low: false }, { remain: 4, pct: 0.4, times: 13, low: false }, false, null, null], "剩餘量估算（手動校正後只扣之後的）");
    T.eq(run(`remainInfo(normalizeItem({ id:"c", brand:"x", name:"c", status:"own", volume: 3 }), [normalizeWear({ itemId:"c", date:"2026-01-01", sprays: 30 })], normalizeSettings({})).low`), true, "估算剩不到 10% 標快用完");
    const up = run(`(() => { const d = migrate({ schema: 2, items: [{ id:"a", brand:"x", name:"y", level:"50", updated: Date.parse("2026-03-04T10:00:00") , created: 1 }], wears: [] }).data; return d.items[0].levelDate; })()`);
    T.eq(up, "2026-03-04", "v2 → v3：舊剩餘量用最後修改日當起算日");
    const idle = run(`(() => { const wi = wearIndex([{ itemId: "a", date: "2026-08-01" }]); const it = (id, o) => normalizeItem(Object.assign({ id, brand: "x", name: id, status: "own", created: Date.parse("2026-01-01T09:00:00") }, o));
      return [idleDaysOf(it("a"), wi, "2026-10-27"), idleDaysOf(it("b", { buyDate: "2026-10-01" }), wi, "2026-10-27"), idleDaysOf(it("c"), wi, "2026-10-27"), idleDaysOf(it("d", { status: "want" }), wi, "2026-10-27")]; })()`);
    T.eq(idle, [87, 26, 299, null], "閒置天數：上次噴 → 購買日 → 新增日");
    const occ = run(`(() => {
      const it = id => normalizeItem({ id, brand: "B", name: id, status: "own" });
      const items = [it("x"), it("y"), it("z")];
      const W = (itemId, date, occasion, feel) => normalizeWear({ itemId, date, occasion, feel });
      const wears = [W("x", "2026-01-01"), W("y", "2026-10-20", "date", "ok"), W("z", "2026-10-25", "date", "good")];
      const wi = wearIndex(wears);
      return [pickCandidates(items, wi, "autumn", "day", "2026-10-27", "", wears).map(x => x.id), pickCandidates(items, wi, "autumn", "day", "2026-10-27", "date", wears).map(x => x.id)];
    })()`);
    T.eq(occ, [["x", "y", "z"], ["z", "y", "x"]], "今天噴什麼：場合 👍 優先 → 場合噴過 → 其他");
    T.eq(run(`normalizeWear({ itemId: "a", feel: "good", layerId: "L1" }).feel + normalizeWear({ itemId: "a", feel: "bad" }).feel + normalizeWear({ itemId: "a", feel: "zz" }).feel`), "goodbad", "感受正規化");
    const st2 = run(`(() => { const items = [normalizeItem({ id: "a", brand: "x", name: "y", status: "own" })]; const W = f => normalizeWear({ itemId: "a", date: "2026-10-01", feel: f }); return computeStats(items, [W("good"), W("good"), W("bad"), W("")], "all", "2026-10-27").top.map(x => [x.good, x.rated]); })()`);
    T.eq(st2, [[2, 3]], "喜歡率計算");
  }
  // --- 寫入失敗 ---
  {
    const ls = fakeStorage(); ls.failWrites = true;
    const { run } = load({ localStorage: ls });
    T.ok(run("store.save(freshData())") === false, "寫入失敗回傳 false 不拋錯");
  }
  // --- 壞資料不被覆蓋 ---
  {
    const ls = fakeStorage({ "perfume-log-data": "{壞掉的json" });
    const { run } = load({ localStorage: ls });
    const r = run("store.load()");
    T.eq(r.error, "corrupt", "壞 JSON 回報 corrupt");
    T.eq(ls.getItem("perfume-log-data-bad"), "{壞掉的json", "壞資料另存一份");
    T.eq(ls.getItem("perfume-log-data"), "{壞掉的json", "原資料沒被改");
  }
  // --- 較新 schema ---
  {
    const ls = fakeStorage({ "perfume-log-data": JSON.stringify({ schema: 99, items: [{ brand: "a", name: "b" }] }) });
    const { run } = load({ localStorage: ls });
    T.eq(run("store.load()").error, "newer", "較新 schema 回報 newer");
  }
  // --- 舊格式（沒有 schema、欄位缺漏或型別錯）升級 ---
  {
    const old = { items: [{ id: "x1", brand: " Dior ", name: "Sauvage", families: ["woody", "nope", "woody", "spicy", "citrus"], rating: 9, year: "abc", seasons: "summer", notes: null }, null, "str"] };
    const ls = fakeStorage({ "perfume-log-data": JSON.stringify(old) });
    const { run } = load({ localStorage: ls });
    const r = run("store.load()");
    T.ok(!r.error, "舊資料可以讀");
    const it = r.data.items[0];
    T.eq(r.data.items.length, 1, "非物件項目略過");
    T.eq([it.id, it.brand, it.families, it.rating, it.year, it.seasons, it.notes.top], ["x1", "Dior", ["woody", "spicy"], 0, null, [], []], "欄位正規化");
  }
  // --- 匯入驗證 ---
  {
    const { run } = load();
    const v = s => run(`validateImport(${JSON.stringify(s)})`);
    T.ok(/JSON/.test(v("not json").error), "壞 JSON 報錯");
    T.ok(/不是香水紀錄/.test(v(JSON.stringify({ app: "other", items: [] })).error), "其他 app 的檔案報錯");
    T.ok(/較新版本/.test(v(JSON.stringify({ app: "perfume-log", schema: 5, items: [] })).error), "較新 schema 報錯");
    T.ok(/找不到/.test(v(JSON.stringify({ foo: 1 })).error), "沒有 items 報錯");
    T.ok(/缺少品牌或名稱/.test(v(JSON.stringify([{ brand: "x" }])).error), "全部缺欄位報錯");
    const ok = v(JSON.stringify([{ brand: "A", name: "B" }, { name: "only" }, 5]));
    T.eq([ok.items.length, ok.skipped, ok.items[0]._new], [1, 2, true], "陣列格式可匯入，壞筆略過");
    const ph = v(JSON.stringify({ app: "perfume-log", schema: 1, items: [{ id: "p1", brand: "A", name: "B", hasPhoto: true }, { id: "p2", brand: "C", name: "D" }], photos: { p1: "data:image/jpeg;base64,AAAA", p2: "javascript:alert(1)" } }));
    T.eq([ph.photoCount, Object.keys(ph.photos)], [1, ["p1"]], "照片只收 data:image");
    T.ok(v("﻿" + JSON.stringify([{ brand: "A", name: "B" }])).items.length === 1, "有 BOM 也能讀");
    const dupId = v(JSON.stringify([{ id: "same", brand: "A", name: "B" }, { id: "same", brand: "C", name: "D" }]));
    T.ok(dupId.items[0].id !== dupId.items[1].id, "檔案內重複 id 會重新編號");
  }
  // --- 匯出 → 匯入往返（不含照片） ---
  {
    const { run } = load();
    run(`S = freshData(); for(let i=0;i<40;i++) S.items.push(normalizeItem({ brand: "B"+i, name: "N<&>\\"'"+i, status: STATUS[i%5][0], families: [FAMS[i%14][0]], notesLayered: i%2===0, notes: { all: ["麝香"], top: ["佛手柑"] }, memo: "第"+i+"行\\n第二行", rating: i%6, created: 1000+i, updated: 2000+i }));`);
    run(`S.items.forEach((it, i) => { if(i % 3 === 0) S.wears.push(normalizeWear({ itemId: it.id, date: "2026-0" + (1 + i % 9) + "-1" + (i % 10), memo: "<i>心得</i>", created: 10 + i, updated: 20 + i })); })`);
    const json = await run(`store.exportAll(S, false).then(r => JSON.stringify(r.out))`);
    T.eq(run(`(() => { const imp = validateImport(${JSON.stringify(json)}); return mergeWears([], imp.wears, new Set(imp.items.map(x=>x.id))).wears; })()`), run("S.wears"), "日誌匯出 → 匯入相同");
    const imp = run(`validateImport(${JSON.stringify(json)})`);
    T.eq(imp.items.length, 40, "匯入筆數相同");
    const merged = run(`(() => { const imp = validateImport(${JSON.stringify(json)}); return mergeItems([], imp.items).items; })()`);
    T.eq(merged, run("S.items"), "匯出 → 合併進空資料 = 原資料");
    const replaced = run(`validateImport(${JSON.stringify(json)}).items.map(cloneItem)`);
    T.eq(replaced, run("S.items"), "匯出 → 取代 = 原資料");
    const again = run(`(() => { const r = mergeItems(S.items, validateImport(${JSON.stringify(json)}).items); return [r.added, r.updated, r.same, r.items.length]; })()`);
    T.eq(again, [0, 0, 40, 40], "同一份檔案再合併不會重複");
  }
  // --- 合併規則 ---
  {
    const { run } = load();
    const r = run(`(() => {
      const cur = [normalizeItem({ id: "a", brand: "X", name: "Old", updated: 100, created: 50 }), normalizeItem({ id: "b", brand: "Y", name: "Keep", updated: 300, created: 50 }), normalizeItem({ id: "c", brand: "Dior", name: "Sauvage", created: 1, updated: 1 })];
      const inc = [normalizeItem({ id: "a", brand: "X", name: "New", updated: 200, created: 50 }), normalizeItem({ id: "b", brand: "Y", name: "Older", updated: 100, created: 50 }), Object.assign(normalizeItem({ brand: " dior", name: "SAUVAGE " }), { _new: true }), Object.assign(normalizeItem({ brand: "Chanel", name: "No.5" }), { _new: true })];
      const m = mergeItems(cur, inc);
      return { names: m.items.map(x => x.name), added: m.added, updated: m.updated, same: m.same, dup: m.dup, curName: cur[0].name, hasNewFlag: m.items.some(x => "_new" in x) };
    })()`);
    T.eq(r, { names: ["New", "Keep", "Sauvage", "No.5"], added: 1, updated: 1, same: 1, dup: 1, curName: "Old", hasNewFlag: false }, "較新的優先、舊的略過、無 id 同名略過、不改到原陣列");
  }
  // --- 貼上解析 ---
  {
    const { run } = load();
    const text = `以下是查到的資料：
**品牌**：Le Labo
- 名稱：Santal 33
濃度：Eau de Parfum
香調家族：木質、皮革、辛香
調香師：Frank Voelkl
年份：2011（請確認）
前調：小荳蔻、紫羅蘭
中調：鳶尾, 紫羅蘭
後調：檀香；雪松；皮革
季節：秋、冬
時段：皆可
持香：強
容量：請確認
Fragrantica 評分：4.1`;
    const r = run(`parsePaste(${JSON.stringify(text)})`);
    T.eq(r.patch, { brand: "Le Labo", name: "Santal 33", conc: "edp", families: ["woody", "leather"], perfumer: "Frank Voelkl", year: 2011, top: ["小荳蔻", "紫羅蘭"], mid: ["鳶尾", "紫羅蘭"], base: ["檀香", "雪松", "皮革"], seasons: ["autumn", "winter"], times: ["day", "night"], longevity: "strong" }, "Claude 格式解析");
    T.eq(r.flagged, ["香調家族", "年份", "容量"], "請確認與超過 2 個家族標出");
    T.eq(r.unknown.length, 2, "無法辨識的行計數");
    const conc = s => run(`parseConc(norm(${JSON.stringify(s)}))`);
    T.eq(["淡香精", "淡香水", "Parfum", "Extrait de Parfum", "EDT", "Eau de Cologne", "Elixir", "Body mist"].map(conc), ["edp", "edt", "extrait", "extrait", "edt", "edc", "extrait", "other"], "濃度對應");
    T.eq(run(`parseFams("Woody Floral")`), ["woody", "floral"], "英文家族依出現順序");
    T.eq(run(`parsePaste("香調：麝香、白花\\n季節：四季").patch`), { all: ["麝香", "白花"], seasons: ["spring", "summer", "autumn", "winter"] }, "不分層與四季");
    T.eq(run(`parsePaste("隨便的文字\\n\\n").applied.length`), 0, "沒有欄位時 applied 為空");
    T.eq(run(`parsePaste("濃度：（Extrait／Parfum、EDP、EDT、EDC、其他）").applied.length`), 0, "沒填的範本行不帶入");
    // applyPatch 不弄丟照片、不改原 draft
    const ap = run(`(() => { const d = draftFrom(normalizeItem({ brand: "A", name: "B" })); d._photoBlob = "BLOB"; const o = applyPatch(d, parsePaste("前調：佛手柑\\n容量：100 mL").patch); return [o._photoBlob, o.notes.top, o.volume, d.notes.top.length, o.notesLayered]; })()`);
    T.eq(ap, ["BLOB", ["佛手柑"], "100", 0, true], "applyPatch 保留照片、不改原物件");
    const ap2 = run(`(() => { const d = draftFrom(normalizeItem({ brand: "A", name: "B" })); return applyPatch(d, parsePaste("香調：麝香").patch).notesLayered; })()`);
    T.eq(ap2, false, "只貼「香調」切成不分層");
  }
  // --- 篩選排序 ---
  {
    const { run } = load();
    run(`S.items = [normalizeItem({ id:"1", brand:"Byredo", name:"Gypsy Water", status:"own", families:["woody"], seasons:["summer"], rating:3, created:3, buyDate:"2025-05-01", notes:{ top:["佛手柑"] } }),
      normalizeItem({ id:"2", brand:"Aesop", name:"Hwyl", status:"decant", families:["green"], seasons:["winter"], rating:5, created:2 }),
      normalizeItem({ id:"3", brand:"Chanel", name:"Bleu", status:"want", rating:0, created:1, buyDate:"2026-02-01" })]`);
    const ids = code => run(`(${code}).map(x=>x.id)`);
    T.eq(ids(`sortItems(S.items,"new")`), ["1", "2", "3"], "最近新增");
    T.eq(ids(`sortItems(S.items,"rating")`), ["2", "1", "3"], "評分");
    T.eq(ids(`sortItems(S.items,"buy")`), ["3", "1", "2"], "購買日期（空的最後）");
    T.eq(ids(`sortItems(S.items,"name")`), ["2", "1", "3"], "名稱");
    T.eq(ids(`filterItems(S.items,{status:"all",fams:[],seasons:[],q:"佛手柑"})`), ["1"], "搜尋 notes");
    T.eq(ids(`filterItems(S.items,{status:"all",fams:[],seasons:[],q:"GYPSY  water"})`), ["1"], "搜尋不分大小寫、多字");
    T.eq(ids(`filterItems(S.items,{status:"decant",fams:[],seasons:[],q:""})`), ["2"], "狀態篩選");
    T.eq(ids(`filterItems(S.items,{status:"all",fams:["woody","green"],seasons:["winter"],q:""})`), ["2"], "家族＋季節篩選");
  }
  T.done();
})().catch(e => { console.log("✗ store：例外 " + e.stack); process.exitCode = 1; });
