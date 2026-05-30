"""C3 spike parser：驗 ChatGPT 結構化輸出的 (1) 健壯解析 (2) schema (3) source_quote 可追溯性。"""
import sys, io, json, re, unicodedata
from pathlib import Path
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).parent
SID = sys.argv[1] if len(sys.argv) > 1 else "01"   # output 樣本編號
ISID = sys.argv[2] if len(sys.argv) > 2 else SID   # input 樣本編號（v2 複用 01/02 逐字稿時指定）
RAW = (HERE / "samples" / f"{SID}-output.json").read_text(encoding="utf-8")
INPUT = (HERE / "samples" / f"{ISID}-input.txt").read_text(encoding="utf-8")


def robust_extract(s: str) -> str:
    """容錯前處理：剝掉 markdown code fence、抓第一個 { 到最後一個 }。"""
    s = s.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", s, re.DOTALL)
    if fence:
        s = fence.group(1)
    i, j = s.find("{"), s.rfind("}")
    if i != -1 and j != -1:
        s = s[i : j + 1]
    return s.strip()


def normalize(t: str) -> str:
    """寬鬆比對：NFKC + 去標點空白，避免全半形/標點差異誤判改寫。"""
    t = unicodedata.normalize("NFKC", t)
    return re.sub(r"[\s，。、？！「」『』（）()…·,.\-:：]", "", t)


# ── (1) robust_extract 髒變體測試 ───────────────────────────────────────────
dirty = [
    ("乾淨", RAW),
    ("```json 包裹", "```json\n" + RAW + "\n```"),
    ("前後贅字", "好的，這是結果：\n" + RAW + "\n希望有幫助！"),
    ("``` 無語言標記", "```\n" + RAW + "\n```"),
]
print("=== (1) robust_extract 健壯性 ===")
for name, d in dirty:
    try:
        parsed = json.loads(robust_extract(d))
        print(f"  [OK]   {name}: 解析成功, nodes={len(parsed.get('nodes', []))}")
    except Exception as e:
        print(f"  [FAIL] {name}: {e}")

# ── (2)(3) schema + 可追溯 ──────────────────────────────────────────────────
data = json.loads(robust_extract(RAW))
concepts = {c["id"] for c in data["core_concepts"]}
labels = {c["id"]: c["label"] for c in data["core_concepts"]}
nodes = data["nodes"]
norm_input = normalize(INPUT)

errs, warns = [], []
used = set()
traceable = 0
for n in nodes:
    for k in ("id", "idea", "source_quote", "core_concept_ids"):
        if k not in n:
            errs.append(f"node {n.get('id','?')} 缺欄位 {k}")
    for cid in n.get("core_concept_ids", []):
        used.add(cid)
        if cid not in concepts:
            errs.append(f"node {n['id']} 指向不存在概念 {cid}")
    sq = normalize(n.get("source_quote", ""))
    if sq and sq in norm_input:
        traceable += 1
    else:
        warns.append(f"node {n['id']} source_quote 無法在原文比對到（疑改寫）")

orphan = concepts - used
print("\n=== (2) schema + (3) 可追溯（乾淨樣本）===")
print(f"  core_concepts: {len(concepts)}   nodes: {len(nodes)}")
print(f"  概念使用率: {len(used)}/{len(concepts)}   孤兒概念: {orphan or '無'}")
print(f"  source_quote 可追溯: {traceable}/{len(nodes)}")
print(f"  schema 錯誤: {len(errs)}")
for e in errs:
    print("    ✗", e)
print(f"  追溯警告: {len(warns)}")
for w in warns:
    print("    ⚠", w)

cnt = Counter(cid for n in nodes for cid in n["core_concept_ids"])
print("\n  每核心概念掛載節點數:")
for cid, c in cnt.most_common():
    print(f"    {cid} {labels[cid]}: {c}")

# ── (4) lenses（prompt v2 一次往返）─────────────────────────────────────────
if "lenses" in data:
    lens = data["lenses"]
    keys = ["fastest", "reverse", "crossdomain", "upstream"]
    names = {"fastest": "最快", "reverse": "反向", "crossdomain": "跨域", "upstream": "上游"}
    print("\n=== (4) lenses（四透鏡）===")
    lerr, empty = [], []
    for k in keys:
        if k not in lens:
            lerr.append(f"缺透鏡 {k}")
            continue
        arr = lens[k]
        for d in arr:
            if "id" not in d or "direction" not in d:
                lerr.append(f"{k} 方向缺 id/direction: {d}")
        flag = "   ← 空透鏡（盲點訊號）" if len(arr) == 0 else ""
        print(f"  {names[k]} {k}: {len(arr)}{flag}")
        if len(arr) == 0:
            empty.append(names[k])
    print(f"  透鏡 schema 錯誤: {len(lerr)}")
    for e in lerr:
        print("    ✗", e)
    print(f"  空透鏡（=盲點）: {empty or '無'}")
else:
    print("\n（此樣本無 lenses，v1 格式）")
