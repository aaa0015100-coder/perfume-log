#!/usr/bin/env python3
"""瀏覽器測試（Playwright）。只印失敗摘要。
用法：python3 tests/e2e.py [--full] [--shots 目錄]
  預設快速模式：390 淺色／深色＋1280，各分頁開啟檢查溢出；收藏分頁完整操作一次（390）。
  --full：v1.0 用，寬度 320／390／768／1280 × 深淺色。
"""
import argparse, functools, http.server, json, os, socketserver, sys, tempfile, threading

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fails = []


def ok(cond, msg):
    if not cond:
        fails.append(msg)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    h = functools.partial(Quiet, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/index.html"


CHECK_JS = """() => ({ sw: document.documentElement.scrollWidth, w: innerWidth,
  bad: (document.body.innerText.match(/undefined|NaN|\\[object Object\\]|\\bnull\\b/) || [""])[0] })"""


def check(page, where):
    r = page.evaluate(CHECK_JS)
    ok(r["sw"] <= r["w"], f"{where}：橫向溢出 scrollWidth={r['sw']} > {r['w']}")
    ok(not r["bad"], f"{where}：畫面出現 {r['bad']}")


def watch(page, errs, reqs, base):
    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    page.on("console", lambda m: errs.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("request", lambda r: reqs.append(r.url) if not (r.url.startswith(base) or r.url.startswith("data:") or r.url.startswith("blob:")) else None)


def seed_items(n):
    st = ["own", "decant", "tried", "want", "gone"]
    fams = ["woody", "floral", "amber", "citrus", "leather"]
    out = []
    for i in range(n):
        out.append({"id": f"seed-{i}", "brand": ["Maison Francis Kurkdjian", "Le Labo", "Diptyque", "Byredo"][i % 4],
                    "name": ("Baccarat Rouge 540 Extrait de Parfum 超長的名稱測試" if i % 5 == 0 else f"Perfume {i}"),
                    "status": st[i % 5], "conc": ["edp", "edt", "extrait", ""][i % 4], "families": [fams[i % 5]],
                    "volume": 50 + i, "level": "low" if i % 7 == 0 else "", "rating": i % 6, "seasons": ["winter"] if i % 2 else ["summer"],
                    "notes": {"top": ["佛手柑"], "mid": ["玫瑰"], "base": ["麝香"]}, "created": 1700000000000 + i, "updated": 1700000000000 + i})
    return out


def seed_wears(n):
    import datetime
    out = []
    today = datetime.date.today()
    for i in range(n * 3):
        d = today - datetime.timedelta(days=i * 2)
        out.append({"id": f"w-{i}", "itemId": f"seed-{(i * 7) % n}", "date": d.isoformat(), "occasion": ["work", "date", "", "home"][i % 4],
                    "sprays": (i % 5) + 1 if i % 3 else None, "hours": 6.5 if i % 2 else None, "memo": "下雨天，乾燥後段很舒服 <i>x</i>" if i % 4 == 0 else "",
                    "created": 1700000000000 + i, "updated": 1700000000000 + i})
    return out


def make_png(path):
    try:
        from PIL import Image
        Image.new("RGB", (1600, 1200), (150, 100, 60)).save(path)
    except Exception:
        import base64
        open(path, "wb").write(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))


def items_of(page):
    return page.evaluate("() => JSON.parse(localStorage.getItem('perfume-log-data') || '{\"items\":[]}').items")


def photo_count(page):
    return page.evaluate("""() => new Promise(res => { const r = indexedDB.open('perfume-log', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos');
      r.onsuccess = () => { const t = r.result.transaction('photos'); const q = t.objectStore('photos').count(); q.onsuccess = () => { res(q.result); r.result.close(); }; };
      r.onerror = () => res(-1); })""")


def overview(browser, url, base, W, scheme, shots, tag):
    ctx = browser.new_context(viewport={"width": W, "height": 860}, color_scheme=scheme)
    page = ctx.new_page()
    errs, reqs = [], []
    watch(page, errs, reqs, base)
    page.goto(url)
    page.evaluate("d => localStorage.setItem('perfume-log-data', JSON.stringify({ schema: 2, items: d.items, wears: d.wears, settings: { lastBackup: 0 } }))", {"items": seed_items(24), "wears": seed_wears(24)})
    page.reload()
    where = f"{W}px {scheme}"
    check(page, f"{where} 收藏")
    if shots:
        page.screenshot(path=os.path.join(shots, f"{tag}-list.png"), full_page=False)
    page.click("summary:has-text('更多篩選')")
    page.click("[data-act=ffam][data-v=woody]")
    check(page, f"{where} 收藏（篩選）")
    page.click("[data-act=edit] >> nth=0")
    check(page, f"{where} 表單")
    if shots and W == 390:
        page.screenshot(path=os.path.join(shots, f"{tag}-form.png"), full_page=True)
    page.click("[data-act=tab][data-tab=log]")
    check(page, f"{where} 日誌")
    if shots and W == 390:
        page.screenshot(path=os.path.join(shots, f"{tag}-log.png"))
    page.click("[data-act=wear-edit] >> nth=0")
    check(page, f"{where} 日誌表單")
    page.click("[data-act=tab][data-tab=pick]")
    check(page, f"{where} 今天噴什麼")
    if shots and W == 390:
        page.screenshot(path=os.path.join(shots, f"{tag}-pick.png"))
    page.click("[data-act=tab][data-tab=stats]")
    check(page, f"{where} 統計")
    if shots and W in (390, 1280):
        page.screenshot(path=os.path.join(shots, f"{tag}-stats.png"), full_page=True)
    page.click("[data-act=tab][data-tab=settings]")
    check(page, f"{where} 設定")
    if shots and W == 390 and scheme == "light":
        page.screenshot(path=os.path.join(shots, f"{tag}-settings.png"), full_page=True)
    ok(not errs, f"{where}：console 錯誤 {errs[:3]}")
    ok(not reqs, f"{where}：有外部網路請求 {reqs[:3]}")
    ctx.close()


def flow(browser, url, base, tmp):
    ctx = browser.new_context(viewport={"width": 390, "height": 860}, accept_downloads=True)
    page = ctx.new_page()
    errs, reqs = [], []
    watch(page, errs, reqs, base)
    page.goto(url)
    ok(page.is_visible("text=還沒有香水"), "空狀態沒有引導文字")
    check(page, "390 空狀態")

    # 新增
    page.click("[data-act=add]")
    page.click("[data-act=save]")
    ok(page.locator("#f-brand.err").count() == 1, "沒填品牌時沒有標紅")
    page.fill("#f-brand", "Le Labo")
    page.fill("#f-name", "Santal 33")
    page.click(".seg label:has-text('分裝／小樣')")
    page.click("summary:has-text('貼上自動填入')")
    page.fill("#paste", "品牌：Le Labo\n名稱：Santal 33\n濃度：EDP\n香調家族：木質、皮革\n調香師：Frank Voelkl\n年份：2011（請確認）\n前調：小荳蔻、紫羅蘭\n中調：鳶尾\n後調：檀香、雪松\n季節：秋、冬\n時段：晚上")
    page.click("[data-act=paste]")
    ok(page.input_value("#f-perfumer") == "Frank Voelkl", "貼上後調香師沒帶入")
    ok(page.input_value("#f-year") == "2011", "貼上後年份沒帶入")
    ok(page.is_visible("text=請確認：年份"), "貼上後沒有提示請確認")
    ok(page.get_attribute("[data-act=dtoggle][data-f=families][data-v=woody]", "aria-pressed") == "true", "貼上後香調家族沒選取")
    ok(page.is_checked(".seg input[data-f=status][value=decant]"), "貼上後狀態被改掉（貼上內容沒有狀態）")
    page.click("[data-act=dtoggle][data-f=families][data-v=floral]")
    ok(page.get_attribute("[data-act=dtoggle][data-f=families][data-v=floral]", "aria-pressed") == "false", "香調家族可以選超過 2 個")
    page.fill("[data-tagin=top]", "粉紅胡椒,")
    ok(page.locator(".tag:has-text('粉紅胡椒')").count() == 1, "逗號沒有加入標籤")
    page.fill("[data-tagin=base]", "麝香")
    page.press("[data-tagin=base]", "Enter")
    ok(page.locator(".tag:has-text('麝香')").count() == 1, "Enter 沒有加入標籤")
    page.fill("[data-tagin=mid]", "玫瑰")  # 沒按加入，儲存時要自動加入
    page.click("[data-act=star][data-v='4']")
    png = os.path.join(tmp, "p.png"); make_png(png)
    page.set_input_files("[data-file=photo]", png)
    page.wait_for_selector(".pv img[src^='blob:']", timeout=5000)
    page.click("summary:has-text('容量與購買')")
    page.fill("#f-volume", "50")
    page.fill("#f-price", "6,800")
    page.fill("#f-buyDate", "2026-01-31")
    page.click(".seg label:has-text('七成')")
    check(page, "390 表單（填好）")
    page.click("[data-act=save]")
    page.wait_for_selector(".pcard")
    ok(page.locator(".pcard").count() == 1, "新增後清單沒有 1 筆")

    page.reload()
    page.wait_for_selector(".pcard img[src^='blob:']", timeout=5000)
    it = items_of(page)[0]
    exp = {"brand": "Le Labo", "status": "decant", "conc": "edp", "families": ["woody", "leather"], "year": 2011, "volume": 50, "price": 6800,
           "buyDate": "2026-01-31", "level": "70", "rating": 4, "seasons": ["autumn", "winter"], "times": ["night"], "hasPhoto": True}
    for k, v in exp.items():
        ok(it.get(k) == v, f"重新整理後 {k}={it.get(k)!r}，預期 {v!r}")
    ok(it["notes"]["top"] == ["小荳蔻", "紫羅蘭", "粉紅胡椒"] and it["notes"]["mid"] == ["鳶尾", "玫瑰"] and it["notes"]["base"] == ["檀香", "雪松", "麝香"], f"notes 不對：{it['notes']}")
    ok(photo_count(page) == 1, "照片沒存進 IndexedDB")

    # 搜尋
    page.fill("#q", "粉紅胡椒")
    ok(page.locator(".pcard").count() == 1, "搜尋 notes 找不到")
    page.fill("#q", "zzz")
    ok(page.is_visible("text=沒有符合的香水"), "搜尋不到時沒有提示")
    page.click("text=清除搜尋與篩選 >> nth=0")
    ok(page.locator(".pcard").count() == 1, "清除篩選後沒恢復")

    # 編輯
    page.click(".pmain")
    page.fill("#f-name", "Santal 33 <b>")
    page.click("[data-act=save]")
    page.reload()
    ok(items_of(page)[0]["name"] == "Santal 33 <b>", "編輯後名稱沒存")
    ok(page.locator(".pname b").count() == 0, "名稱沒有跳脫")
    ok(page.is_visible("text=Santal 33 <b>"), "名稱沒顯示")

    # 匯出
    page.click("[data-act=tab][data-tab=settings]")
    with page.expect_download() as dl:
        page.click("[data-act=export]")
    bk = os.path.join(tmp, "backup.json"); dl.value.save_as(bk)
    data = json.load(open(bk, encoding="utf-8"))
    ok(dl.value.suggested_filename.startswith("perfume-log-backup-"), "備份檔名不對")
    ok(len(data["items"]) == 1 and len(data.get("photos", {})) == 1, "備份檔內容不對")
    ok(page.is_visible("text=上次備份：今天"), "匯出後沒更新上次備份")
    before = items_of(page)

    # 匯入壞檔：現有資料不動
    bad = os.path.join(tmp, "bad.json"); open(bad, "w").write("{not json")
    page.set_input_files("[data-file=import]", bad)
    page.wait_for_selector("text=現有資料沒有變動", timeout=5000)
    ok(page.is_visible("text=現有資料沒有變動"), "壞檔沒有報錯")
    ok(items_of(page) == before, "匯入壞檔改到資料")

    # 清空 → 匯入（合併）→ 相同
    page.evaluate("() => new Promise(r => { localStorage.removeItem('perfume-log-data'); const q = indexedDB.deleteDatabase('perfume-log'); q.onsuccess = q.onerror = q.onblocked = () => r(); })")
    page.reload()
    ok(page.is_visible("text=還沒有香水"), "清空後不是空狀態")
    page.click("[data-act=tab][data-tab=settings]")
    page.set_input_files("[data-file=import]", bk)
    page.wait_for_selector(".note:has-text('檔案內有')", timeout=5000)
    pv = page.locator(".note:has-text('檔案內有')").inner_text()
    ok("檔案內有 1 款（含 1 張照片）" in pv, f"匯入預覽不對：{pv[:80]}")
    page.click("[data-act=imp-merge]")
    page.wait_for_selector("text=已合併")
    after = items_of(page)
    ok(after == before, "匯出 → 清空 → 匯入後資料不同")
    page.click("[data-act=tab][data-tab=coll]")
    page.wait_for_selector(".pcard img[src^='blob:']", timeout=5000)

    # 取代（要確認）
    page.click("[data-act=tab][data-tab=settings]")
    page.set_input_files("[data-file=import]", bk)
    page.wait_for_selector("[data-act=imp-replace]", timeout=5000)
    page.click("[data-act=imp-replace]")
    ok(page.is_visible("text=取代會刪除目前的 1 款"), "取代前沒有確認")
    page.click("[data-act=imp-replace-ok]")
    page.wait_for_selector("text=已取代")
    ok(items_of(page) == before, "取代後資料不同")

    # 主題
    page.click(".seg label:has-text('深色')")
    ok(page.get_attribute("html", "data-theme") == "dark", "主題沒切到深色")
    page.reload()
    ok(page.get_attribute("html", "data-theme") == "dark", "主題重新整理後沒保留")
    page.click("[data-act=tab][data-tab=settings]")
    page.click(".seg label:has-text('自動')")
    ok(page.get_attribute("html", "data-theme") is None, "主題沒切回自動")

    # 刪除 → 復原 → 再刪除 → 照片也清掉
    page.click("[data-act=tab][data-tab=coll]")
    page.click(".pmain")
    page.click("[data-act=del]")
    ok(page.locator(".pcard").count() == 0, "刪除後還在")
    page.click("#toast [data-act=undo]")
    ok(page.locator(".pcard").count() == 1, "復原失敗")
    page.reload()
    ok(len(items_of(page)) == 1, "復原後重新整理不見")
    page.click(".pmain")
    page.click("[data-act=del]")
    page.wait_for_timeout(6200)
    page.reload()
    ok(len(items_of(page)) == 0 and page.is_visible("text=還沒有香水"), "刪除沒有生效")
    ok(photo_count(page) == 0, "刪除後照片沒清掉")

    # 大量資料
    page.evaluate("d => localStorage.setItem('perfume-log-data', JSON.stringify({ schema: 2, items: d.items, wears: d.wears, settings: { lastBackup: 0 } }))", {"items": seed_items(500), "wears": seed_wears(500)})
    page.reload()
    t = page.evaluate("() => { const t0 = performance.now(); const q = document.getElementById('q'); q.value = '玫瑰'; q.dispatchEvent(new Event('input', { bubbles: true })); return performance.now() - t0; }")
    ok(t < 300, f"500 筆搜尋太慢：{t:.0f} ms")
    ok(page.is_visible("text=還沒有備份過"), "沒備份時沒有提醒")
    check(page, "390 500 筆")
    page.click("[data-act=tab][data-tab=log]")
    ok(page.locator(".wcard").count() == 100, "日誌沒有分頁顯示 100 筆")
    page.click("[data-act=log-more]")
    ok(page.locator(".wcard").count() == 300, "顯示更早的紀錄沒作用")
    page.click("[data-act=tab][data-tab=pick]")
    page.click("[data-act=pick-season][data-v=winter]")
    ok(page.locator(".pcard").count() == 3, "500 筆時今天噴什麼不是 3 個候選")
    first = page.locator(".pname").first.inner_text()
    page.click("[data-act=pick-more]")
    ok(page.locator(".pname").first.inner_text() != first, "換一批沒換")

    ok(not errs, f"操作流程：console 錯誤 {errs[:3]}")
    ok(not reqs, f"操作流程：有外部網路請求 {reqs[:3]}")
    ctx.close()


def flow_log(browser, url, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 860})
    page = ctx.new_page()
    errs, reqs = [], []
    watch(page, errs, reqs, base)
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    page.goto(url)
    # 舊版（schema 1）資料要能升級
    v1 = {"schema": 1, "items": [{"id": "a", "brand": "Le Labo", "name": "Santal 33", "status": "own", "seasons": ["autumn", "winter", "spring", "summer"], "created": 3, "updated": 3},
                                 {"id": "b", "brand": "Byredo", "name": "Gypsy Water", "status": "decant", "created": 2, "updated": 2},
                                 {"id": "c", "brand": "Chanel", "name": "No.5", "status": "want", "created": 1, "updated": 1}], "settings": {"lastBackup": 1}}
    page.evaluate("d => localStorage.setItem('perfume-log-data', JSON.stringify(d))", v1)
    page.reload()
    ok(page.locator(".pcard").count() == 3, "v1 資料升級後清單不對")
    ok(page.locator("[data-act=wear]").count() == 2, "「今天噴」只該出現在擁有／分裝")
    ok(page.is_visible("text=上次噴：還沒噴過"), "沒顯示還沒噴過")
    # 一鍵今天噴 → 復原 → 再噴 → 補充細節
    page.click("[data-act=wear][data-id=a]")
    ok(page.is_visible("#toast >> text=已記錄：今天噴 Santal 33"), "今天噴沒有提示")
    ok(page.is_visible("[data-act=wear][data-id=a]:has-text('✓ 今天')"), "今天噴後按鈕沒變")
    page.click("#toast [data-act=undo]")
    d = items_and_wears(page)
    ok(len(d["wears"]) == 0, "今天噴復原失敗")
    page.click("[data-act=wear][data-id=a]")
    page.click("#toast [data-act=wear-edit]")
    ok(page.is_visible("text=編輯穿香紀錄"), "補充細節沒打開日誌表單")
    page.click(".seg label:has-text('約會')")
    page.fill("#w-sprays", "3")
    page.fill("#w-hours", "6.5")
    page.fill("#w-memo", "雨天 <b>很好</b>")
    page.click("[data-act=wear-save]")
    ok(page.locator(".wcard").count() == 1, "日誌清單沒有 1 筆")
    ok(page.is_visible(".wcard >> text=約會") and page.is_visible(".wcard >> text=3 下") and page.is_visible(".wcard >> text=持香 6.5 小時"), "日誌卡片內容不對")
    ok(page.locator(".wcard b").count() == 0, "心得沒有跳脫")
    w = items_and_wears(page)["wears"][0]
    ok(w["occasion"] == "date" and w["sprays"] == 3 and w["hours"] == 6.5, f"日誌存檔不對 {w}")
    # 再按一次今天噴：不重複
    page.click("[data-act=tab][data-tab=coll]")
    page.click("[data-act=wear][data-id=a]")
    ok(len(items_and_wears(page)["wears"]) == 1, "同一天重複記錄")
    # 補記一筆過去的
    page.click("[data-act=tab][data-tab=log]")
    page.click("[data-act=wear-new]")
    page.select_option("#w-item", "b")
    page.fill("#w-date", "2026-07-15")
    ok(page.is_visible("text=夏（依日期自動判斷）"), "日期改了季節沒更新")
    page.click("[data-act=wear-save]")
    ok(page.locator(".wcard").count() == 2 and page.is_visible("text=2026 年 7 月"), "補記沒出現在對應月份")
    # 離開未儲存的表單要確認
    page.click(".wcard >> nth=0")
    page.fill("#w-memo", "改了沒存")
    page.click("[data-act=tab][data-tab=coll]")
    ok(len(dialogs) == 1 and page.is_visible("text=編輯穿香紀錄"), "未儲存離開沒有確認（或取消後仍離開）")
    page.click("[data-act=cancel] >> nth=0")
    ok(len(dialogs) == 2, "按返回沒有確認")
    # 刪除日誌 → 復原
    page.evaluate("() => { window.confirm = () => true; }")
    page.click("[data-act=cancel] >> nth=0")
    page.click(".wcard >> nth=0")
    page.click("[data-act=wear-del]")
    ok(page.locator(".wcard").count() == 1, "刪除日誌後數量不對")
    page.click("#toast [data-act=undo]")
    ok(page.locator(".wcard").count() == 2, "刪除日誌復原失敗")
    # 刪除香水 → 日誌一起刪 → 復原一起回來
    page.click("[data-act=tab][data-tab=coll]")
    page.click(".pmain >> nth=0")
    page.click("[data-act=del]")
    ok(page.is_visible("#toast >> text=含 1 筆日誌"), "刪除香水沒提示日誌")
    ok(len(items_and_wears(page)["wears"]) == 1, "刪除香水沒刪掉它的日誌")
    page.click("#toast [data-act=undo]")
    ok(len(items_and_wears(page)["wears"]) == 2, "復原香水沒帶回日誌")
    # 最近穿著排序
    page.select_option("#sort", "worn")
    names = page.locator(".pname").all_inner_texts()
    ok(names[:2] == ["Santal 33", "Gypsy Water"], f"最近穿著排序不對 {names}")
    # 今天噴什麼
    page.click("[data-act=tab][data-tab=pick]")
    ok(page.locator(".pcard").count() == 2, "今天噴什麼候選數不對")
    ok(page.locator(".pname").first.inner_text() == "Gypsy Water", "今天噴過的沒排到後面")
    page.click("[data-act=pick-season][data-v=summer]")
    ok(page.get_attribute("[data-act=pick-season][data-v=summer]", "aria-pressed") == "true", "季節切換沒作用")
    page.click("[data-act=wear][data-id=b]")
    ok(page.is_visible("[data-act=wear][data-id=b]:has-text('✓ 今天')"), "就噴這瓶沒記錄")
    # 季節月份設定
    page.click("[data-act=tab][data-tab=settings]")
    page.select_option("#m-8", "summer")
    ok(items_and_wears(page)["settings"]["seasonMonths"][8] == "summer", "季節月份沒存")
    page.click("[data-act=months-reset]")
    ok(items_and_wears(page)["settings"]["seasonMonths"][8] == "autumn", "季節月份恢復預設失敗")
    check(page, "390 設定（季節）")
    # 統計
    page.click("[data-act=tab][data-tab=stats]")
    ok(page.is_visible(".rsum >> text=正裝 1・分裝 1・想買 1"), "統計擁有數不對")
    ok(page.locator("tbody tr").count() == 2, "穿最多次表格列數不對")
    page.click("[data-act=stat-period][data-v='90']")
    ok(page.get_attribute("[data-act=stat-period][data-v='90']", "aria-pressed") == "true", "統計期間切換沒作用")
    check(page, "390 統計")
    # 願望清單欄位：改成想買才出現
    page.click("[data-act=tab][data-tab=coll]")
    page.click(".pmain:has-text('No.5')")
    ok(page.is_visible("text=願望清單"), "想買的香水沒有願望清單區塊")
    page.fill("#f-targetPrice", "4,200")
    page.fill("#f-triedAt", "新光三越")
    page.click(".seg label:has-text('擁有')")
    ok(page.is_visible("text=願望清單"), "已填目標價格時切換狀態不該隱藏")
    page.click(".seg label:has-text('想買')")
    page.click("[data-act=save]")
    ok(page.is_visible(".pcard:has-text('No.5') >> text=目標 NT$ 4,200"), "卡片沒有顯示目標價格")
    c = [x for x in items_and_wears(page)["items"] if x["id"] == "c"][0]
    ok(c["targetPrice"] == 4200 and c["triedAt"] == "新光三越", f"願望清單欄位沒存 {c}")
    ok(not errs, f"日誌流程：console 錯誤 {errs[:3]}")
    ok(not reqs, f"日誌流程：有外部網路請求 {reqs[:3]}")
    ctx.close()


def items_and_wears(page):
    return page.evaluate("() => JSON.parse(localStorage.getItem('perfume-log-data'))")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--shots", default="")
    a = ap.parse_args()
    if a.shots:
        os.makedirs(a.shots, exist_ok=True)
    httpd, url = serve()
    base = url.rsplit("/", 1)[0]
    widths = [320, 390, 768, 1280] if a.full else None
    with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
        b = p.chromium.launch()
        try:
            if widths:
                for W in widths:
                    for sc in ["light", "dark"]:
                        overview(b, url, base, W, sc, a.shots, f"{W}-{sc}")
            else:
                overview(b, url, base, 390, "light", a.shots, "390-light")
                overview(b, url, base, 390, "dark", a.shots, "390-dark")
                overview(b, url, base, 1280, "light", a.shots, "1280-light")
            flow(b, url, base, tmp)
            flow_log(b, url, base)
        except Exception as e:
            fails.append(f"例外：{type(e).__name__}: {str(e)[:400]}")
        finally:
            b.close()
            httpd.shutdown()
    if fails:
        print(f"✗ e2e：{len(fails)} 項失敗")
        for f in fails[:40]:
            print("  - " + f)
        sys.exit(1)
    if os.environ.get("VERBOSE"):
        print("✓ e2e 通過")


if __name__ == "__main__":
    main()
