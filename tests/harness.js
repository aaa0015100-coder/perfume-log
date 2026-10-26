// 用 node vm 載入 index.html 的 script（不執行 init），提供假的 localStorage
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML_PATH = path.join(__dirname, "..", "index.html");

function readHTML(){ return fs.readFileSync(HTML_PATH, "utf8"); }
function scriptOf(html){
  const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(!m.length) throw new Error("找不到 <script>");
  return m[m.length - 1][1];
}
function fakeStorage(init){
  const m = new Map(Object.entries(init || {}));
  return {
    _m: m, failWrites: false,
    getItem(k){ return m.has(k) ? m.get(k) : null; },
    setItem(k, v){ if(this.failWrites) throw new Error("QuotaExceededError"); m.set(k, String(v)); },
    removeItem(k){ m.delete(k); },
    clear(){ m.clear(); }
  };
}
function load(opts){
  opts = opts || {};
  const ls = opts.localStorage || fakeStorage();
  const ctx = { localStorage: ls, console, setTimeout, clearTimeout, crypto: require("crypto").webcrypto, Blob, atob, btoa };
  vm.createContext(ctx);
  vm.runInContext(scriptOf(readHTML()), ctx, { filename: "index.html" });
  const run = code => vm.runInContext(code, ctx);
  return { ctx, run, ls };
}

// 失敗收集：只印失敗
function suite(name){
  const fails = [];
  let n = 0;
  return {
    ok(cond, msg){ n++; if(!cond) fails.push(msg); },
    eq(a, b, msg){ n++; const A = JSON.stringify(a), B = JSON.stringify(b); if(A !== B) fails.push(`${msg}\n    得到 ${A.slice(0, 300)}\n    預期 ${B.slice(0, 300)}`); },
    done(){
      if(fails.length){ console.log(`✗ ${name}：${fails.length}/${n} 失敗`); fails.slice(0, 30).forEach(f => console.log("  - " + f)); process.exitCode = 1; }
      else if(process.env.VERBOSE) console.log(`✓ ${name}：${n} 項通過`);
      return fails.length;
    }
  };
}
module.exports = { load, readHTML, scriptOf, fakeStorage, suite };
