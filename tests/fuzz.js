// 隨機資料跑所有 render 與 store 操作：不可拋錯，不可出現 undefined／NaN／[object Object]／null，使用者文字必須跳脫
const { load, suite } = require("./harness");
const T = suite("fuzz");
const { run } = load();

let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const XSS = "<b>XSS</b>";
const STRS = ["", " ", "Le Labo", "Santal 33", "😀🌸", "a".repeat(500), XSS, `"'&<>`, "中文名稱", "\u0000ctrl\u001f", "   前後空白   "];
const VALS = () => pick([undefined, null, 0, -1, 1e20, NaN, true, {}, [], "abc", "12", 3.7, pick(STRS)]);
function randItem(){
  const o = {};
  const fields = ["id","brand","name","status","conc","families","perfumer","year","volume","level","buyDate","buyPlace","price","seasons","times","notesLayered","notes","rating","longevity","sillage","memo","hasPhoto","created","updated"];
  fields.forEach(f => { if(rnd() < 0.15) return; o[f] = VALS(); });
  if(rnd() < .8) o.brand = pick(STRS);
  if(rnd() < .8) o.name = pick(STRS);
  if(rnd() < .6) o.status = pick(["own","decant","tried","want","gone","bad"]);
  if(rnd() < .5) o.families = [pick(["woody","floral","x",XSS]), pick(["amber","citrus"]), "green"];
  if(rnd() < .5) o.notes = { top: [pick(STRS), pick(STRS)], mid: pick([null, "str", [XSS]]), base: [1, {}, pick(STRS)], all: [pick(STRS)] };
  if(rnd() < .5) o.buyDate = pick(["2026-01-01", "2026-13-40", "x", ""]);
  if(rnd() < .5) o.rating = Math.floor(rnd() * 7) - 1;
  return o;
}
const BAD = /undefined|NaN|\[object Object\]|\bnull\b/;
function check(html, where){
  if(typeof html !== "string"){ T.ok(false, where + " 沒有回傳字串"); return; }
  const m = html.match(BAD);
  T.ok(!m, `${where} 出現 ${m && m[0]}：…${m ? html.slice(Math.max(0, m.index - 60), m.index + 40) : ""}…`);
  T.ok(!html.includes(XSS), `${where} 使用者文字沒有跳脫`);
}

for(let round = 0; round < 60; round++){
  try{
    const raw = Array.from({ length: Math.floor(rnd() * 25) }, randItem);
    run(`S = migrate(${JSON.stringify({ schema: 2, items: raw, wears: [], settings: { lastBackup: pick([0, 1, 1e12, "x"]), seasonMonths: pick([undefined, ["summer"], Array(12).fill("summer")]) } })}).data`);
    run(`UI.f = ${JSON.stringify({ status: pick(["all","own","want"]), fams: rnd() < .5 ? ["woody"] : [], seasons: rnd() < .5 ? ["winter"] : [], q: pick(["", "le", XSS, "😀"]) })}; UI.sort = ${JSON.stringify(pick(["new","rating","buy","name","bad"]))}; UI.tab="coll"; UI.view="list"; UI.open = { more: ${rnd() < .5} };`);
    check(run("renderTabs()"), "renderTabs");
    check(run("renderCollection()"), "renderCollection");
    check(run("renderList()"), "renderList");
    // 表單（新增與編輯）
    run(`UI.draft = draftFrom(S.items.length ? S.items[0] : normalizeItem({})); UI.isNew = ${rnd() < .5}; UI.formErr = ${rnd() < .5}; UI.tagIn = { top: ${JSON.stringify(pick(STRS))} }; UI.pasteText = ${JSON.stringify(pick(STRS))}; UI.pasteMsg = ${rnd() < .5 ? JSON.stringify({ t: "warn", s: XSS }) : "null"}; UI.open = { paste: true, buy: ${pick(["null","true","false"])} }; UI.view="form";`);
    check(run("renderForm()"), "renderForm");
    run(`UI.draft.notesLayered = !UI.draft.notesLayered; UI.draft._photoRemove = true;`);
    check(run("renderForm()"), "renderForm（切換分層）");
    // 貼上隨機文字
    const pasted = Array.from({ length: 8 }, () => pick(["品牌：", "名稱：", "濃度：", "前調：", "季節：", "年份：", "持香：", "xx：", ""]) + pick(STRS)).join("\n");
    run(`UI.draft = applyPatch(UI.draft, parsePaste(${JSON.stringify(pasted)}).patch)`);
    check(run("renderForm()"), "renderForm（貼上後）");
    // 日誌、今天噴什麼、日誌表單
    const wears = Array.from({ length: Math.floor(rnd() * 30) }, () => ({ id: pick([undefined, "w" + Math.floor(rnd() * 5)]), itemId: rnd() < .8 ? "ITEM" : pick(STRS), date: pick(["2026-10-26", "2025-01-01", "bad", undefined, "2026-02-29"]), occasion: pick(["work", "x", undefined]), sprays: VALS(), hours: VALS(), memo: pick(STRS) }));
    run(`S.wears = S.items.length ? ${JSON.stringify(wears)}.map(w => normalizeWear(Object.assign(w, { itemId: w.itemId === "ITEM" ? S.items[Math.floor(Math.random()*S.items.length)].id : w.itemId }))) : []; UI.view = "list"; UI.logLimit = ${pick([1, 5, 100])}; UI.pickOffset = ${Math.floor(rnd() * 10)}; UI.pickSeason = ${JSON.stringify(pick(["", "winter", "summer"]))}; UI.pickTime = ${JSON.stringify(pick(["", "day", "night"]))};`);
    run(`UI.tab = "log"; UI.logView = ${JSON.stringify(pick(["cal", "list", "x"]))}; UI.calMonth = ${JSON.stringify(pick(["", "2026-10", "2025-01", "bad", "2026-13"]))}; UI.calDay = ${JSON.stringify(pick(["", "2026-10-26", "2026-10-01", "zzz"]))}; UI.calItem = S.items.length && ${rnd() < .5} ? S.items[0].id : ${JSON.stringify(pick(["", "ghost"]))};`); check(run("renderMain()"), "renderLog");
    run(`UI.tab = "pick"`); check(run("renderMain()"), "renderPick");
    run(`UI.tab = "stats"; UI.statPeriod = ${JSON.stringify(pick(["all","year","90","bad"]))}; UI.statAll = ${rnd() < .5}`); check(run("renderMain()"), "renderStats");
    run(`UI.tab = "coll"; UI.sort = "worn"`); check(run("renderList()"), "renderList（最近穿著）");
    run(`UI.wdraft = Object.assign(normalizeWear(${JSON.stringify(pick(wears) || {})}), { sprays: ${JSON.stringify(pick(STRS))}, hours: "" }); UI.wIsNew = ${rnd() < .5}; UI.wErr = ${rnd() < .5}; UI.view = "wear";`);
    check(run("renderMain()"), "renderWearForm");
    run(`UI.view = "list"`);
    // 設定與匯入預覽
    run(`UI.tab = "settings"; UI.imp = ${pick(["null", JSON.stringify({ error: XSS }), "validateImport(JSON.stringify({ items: S.items }))"])}; UI.impConfirm = ${rnd() < .5};`);
    if(run("UI.imp && UI.imp.error === undefined && !UI.imp.items") ) run("UI.imp = null");
    check(run("renderSettings()"), "renderSettings");
    check(run("renderMain()"), "renderMain");
    // store 操作
    const json = run("JSON.stringify({ app: 'perfume-log', schema: 1, items: S.items })");
    const back = run(`validateImport(${JSON.stringify(json)})`);
    if(run("S.items.filter(x => x.brand && x.name).length")) T.ok(!back.error, "合法資料匯入不應報錯：" + back.error);
    run(`mergeItems(S.items, validateImport(${JSON.stringify(json)}).items || [])`);
  }catch(e){ T.ok(false, `第 ${round} 輪例外：${e.message}`); }
}

// 大量資料：500 筆 render、搜尋時間
run(`S = freshData(); for(let i=0;i<500;i++) S.items.push(normalizeItem({ brand: "Brand"+(i%40), name: "Perfume "+i, families: [FAMS[i%14][0]], seasons: [SEASONS[i%4][0]], notes: { top: ["佛手柑","粉紅胡椒"], mid: ["玫瑰"+i%30], base: ["麝香"] }, rating: i%6, created: i }));
UI.tab="coll"; UI.view="list"; UI.f={status:"all",fams:[],seasons:[],q:""}; UI.sort="new";`);
let t = Date.now(); run("renderCollection()"); const tRender = Date.now() - t;
t = Date.now(); for(let i = 0; i < 20; i++){ run(`UI.f.q = "玫瑰${i}"; renderList();`); } const tSearch = (Date.now() - t) / 20;
T.ok(tRender < 150, `500 筆 render 太慢：${tRender} ms`);
T.ok(tSearch < 60, `500 筆搜尋太慢：${tSearch} ms/次`);
run(`UI.draft = draftFrom(S.items[0]); UI.view="form";`);
t = Date.now(); run("renderForm()"); T.ok(Date.now() - t < 150, "500 筆時表單（含建議清單）render 太慢");

T.done();
