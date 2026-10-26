// 靜態檢查（00 第七節之 1）
const { readHTML, scriptOf, suite } = require("./harness");
const T = suite("static");
const html = readHTML();
const js = scriptOf(html);
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";

// 1. 靜態 id 不重複（排除含 ${} 的動態 id）
const ids = [...html.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
T.ok(!dup.length, "重複的 id：" + [...new Set(dup)].join(", "));

// 2. 沒有寫死色碼：token 定義行之外不可有 #hex / rgb()
const cssLines = css.split("\n").filter(l => !/^\s*--[\w-]+:/.test(l) && !/^\s*:root|^@media \(prefers-color-scheme/.test(l));
const tokenBlockFree = css.replace(/:root\{[\s\S]*?\}/g, "").replace(/@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{[\s\S]*?\}\}/g, "").replace(/:root\[data-theme="dark"\]\{[\s\S]*?\}/g, "");
const hexInCss = tokenBlockFree.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
T.ok(!hexInCss.length, "CSS 有寫死色碼：" + hexInCss.join(", "));
const rgb = (tokenBlockFree.match(/rgba?\([^)]*\)/g) || []).filter(x => x.replace(/\s/g, "") !== "rgba(0,0,0,.18)");
T.ok(!rgb.length, "CSS 有寫死 rgb()：" + rgb.join(", "));
const hexInJs = (js.match(/["'`][^"'`\n]*#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b[^"'`\n]*["'`]/g) || []).filter(s => !/&#\d+;/.test(s));
T.ok(!hexInJs.length, "JS 有寫死色碼：" + hexInJs.join(" | "));
const named = (js.match(/fillStyle\s*=\s*"[^"]+"/g) || []).filter(s => !/"white"/.test(s));
T.ok(!named.length, "canvas 用了未允許的顏色：" + named.join(", "));
T.ok(!/style="[^"]*(color|background)\s*:/i.test(html), "inline style 裡寫了顏色");

// 3. 沒有外部載入、沒有 cookie
T.ok(!/(src|href)\s*=\s*["']?https?:/i.test(html), "有 http(s) 外部載入");
T.ok(!/url\(\s*["']?https?:/i.test(css), "CSS 有外部 url()");
T.ok(!/\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(|navigator\.sendBeacon|new\s+WebSocket|<link[^>]+stylesheet/.test(html), "有網路請求或外部樣式");
T.ok(!/document\.cookie/.test(js), "用了 cookie");
T.ok(!/claude:/.test(html.match(/<head>[\s\S]*?<\/head>/)[0]), "head 有 claude: meta");

// 4. localStorage 只在 store 內，鍵名只有允許的
const sStart = js.indexOf("const store = {"), sEnd = js.indexOf("function blobToDataURL");
T.ok(sStart > 0 && sEnd > sStart, "找不到 store 區塊");
const lsUses = [...js.matchAll(/localStorage/g)].map(m => m.index);
T.ok(lsUses.length > 0 && lsUses.every(i => i > sStart && i < sEnd), "store 以外用到 localStorage");
T.ok(!/indexedDB\.open/.test(js.slice(0, sStart) + js.slice(sEnd)), "store 以外開 IndexedDB");
const keys = [...js.slice(sStart, sEnd).matchAll(/"(perfume-log[^"]*)"/g)].map(m => m[1]);
const allowed = ["perfume-log-data", "perfume-log-theme", "perfume-log-data-bad", "perfume-log"];
T.ok(keys.every(k => allowed.includes(k)), "未允許的儲存鍵：" + keys.filter(k => !allowed.includes(k)).join(", "));

// 5. 使用者文字插入 HTML 都經過 esc()
const risky = /\$\{(?![^}]*\besc\()[^}]*\b(?:it|d|x|imp|UI\.f)\.(brand|name|memo|perfumer|buyPlace|q|id)\b[^}]*\}/g;
const bad = (js.split("\n").filter(l => !/toast\(/.test(l)).join("\n").match(risky) || []).filter(m => !/\.trim\(\)/.test(m));
T.ok(!bad.length, "未跳脫的使用者文字：" + bad.join(" | "));
T.ok(!/\.innerHTML\s*=\s*(?![\s]|renderTabs\(\)|renderMain\(\)|renderList\(\)|esc\()/.test(js), "innerHTML 指派了未經 render／esc 的內容");

// 6. 版本常數格式、外層
T.ok(/const APP_VERSION = "\d+\.\d+";/.test(js) && /const UPDATED = "\d{4}-\d{2}-\d{2}";/.test(js), "APP_VERSION／UPDATED 格式");
T.ok(/^<!doctype html>/i.test(html) && /<html lang="zh-Hant">/.test(html) && /viewport-fit=cover/.test(html), "GitHub Pages 外層");
T.ok(/rel="apple-touch-icon" href="data:image\/png;base64,/.test(html), "apple-touch-icon 需為 data URI");
T.ok(/\.seg input\{[^}]*width:1px;height:1px/.test(css), ".seg input 要 1px");
T.ok(!/\(\?<[=!]/.test(js), "用了 lookbehind（iOS 舊版不支援）");

T.done();
