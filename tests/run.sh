#!/usr/bin/env bash
# 跑全部測試，只印失敗摘要。用法：tests/run.sh [--full] [--shots 目錄]
cd "$(dirname "$0")/.." || exit 1
rc=0
node tests/static.js || rc=1
node tests/store.js || rc=1
node tests/fuzz.js || rc=1
python3 tests/e2e.py "$@" || rc=1
[ $rc -eq 0 ] && echo "全部通過"
exit $rc
