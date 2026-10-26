// 存取往返、schema 升級、匯出→匯入、壞檔、合併規則、貼上解析
const { load, fakeStorage, suite } = require("./harness");
const T = suite("store");

(async () => {
  // --- 存取往返 ---
  {
    const { run, ls } = load();
    T.eq(run("store.load()"), { data: { schema: 1, items: [], settings: { lastBackup: 0 } } }, "空的 localStorage 回傳預設資料");
    run(`S = { schema: 1, items: [normalizeItem({ brand: "Le Labo", name: "Santal 33", status: "own", conc: "edp", families: ["woody","leather"], notes: { top: ["小荳蔻"], mid: ["鳶尾"], base: ["檀香"] }, buyDate: "2026-01-31", price: "6,800", volume: "50" })], settings: { lastBackup: 0 } }`);
    T.ok(run("store.save(S)") === true, "save 成功");
    const back = run("store.load()").data;
    T.eq(back, run("S"), "save → load 相同");
    T.eq(back.items[0].buyDate, "2026-01-31", "只記日期的欄位不跑掉");
    T.eq(back.items[0].price, 6800, "價格去千分位轉數字");
    T.ok(ls.getItem("perfume-log-data").length > 10, "只寫入 perfume-log-data");
    T.eq([...ls._m.keys()], ["perfume-log-data"], "沒有其他鍵");
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
    const json = await run(`store.exportAll(S, false).then(r => JSON.stringify(r.out))`);
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
