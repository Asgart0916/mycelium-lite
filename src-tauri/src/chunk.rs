//! 切塊：把一段話切成「句子」級的單位,讓多想法的段落能在 idea 層被比對。
//! 純規則、無模型。策略：先按句末強標點切;過長的再按逗號切;過短的併回前句。
//! 這是 heuristic,日後可調（見 docs/Design.md TODO）。

const MIN_CHARS: usize = 4; // 短於此的碎片併回前句
const MAX_CHARS: usize = 60; // 長於此的句子再按逗號細切

const STRONG: &[char] = &['。', '！', '？', '!', '?', '；', ';', '\n'];
const SOFT: &[char] = &['，', '、', ','];

pub fn chunk_text(text: &str) -> Vec<String> {
    // 1) 按強標點切
    let mut pieces: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in text.chars() {
        if STRONG.contains(&ch) {
            push_trimmed(&mut pieces, &cur);
            cur.clear();
        } else {
            cur.push(ch);
        }
    }
    push_trimmed(&mut pieces, &cur);

    // 2) 過長的句子按逗號再切
    let mut fine: Vec<String> = Vec::new();
    for p in pieces {
        if p.chars().count() <= MAX_CHARS {
            fine.push(p);
            continue;
        }
        let mut c = String::new();
        for ch in p.chars() {
            c.push(ch);
            if SOFT.contains(&ch) && c.chars().count() >= MAX_CHARS / 2 {
                push_soft(&mut fine, &c);
                c.clear();
            }
        }
        push_soft(&mut fine, &c);
    }

    // 3) 過短碎片：有前句則併回前句,否則往後帶到下一句（處理開頭的「好。」這種）
    let mut out: Vec<String> = Vec::new();
    let mut carry = String::new();
    for p in fine {
        let p = if carry.is_empty() {
            p
        } else {
            let merged = format!("{carry}{p}");
            carry.clear();
            merged
        };
        if p.chars().count() < MIN_CHARS {
            match out.last_mut() {
                Some(last) => last.push_str(&p),
                None => carry = p,
            }
        } else {
            out.push(p);
        }
    }
    if !carry.is_empty() {
        match out.last_mut() {
            Some(last) => last.push_str(&carry),
            None => out.push(carry),
        }
    }

    // 4) 完全沒切出東西 → 整段當一塊
    if out.is_empty() {
        let whole = text.trim().to_string();
        if !whole.is_empty() {
            out.push(whole);
        }
    }
    out
}

fn push_trimmed(v: &mut Vec<String>, s: &str) {
    let t = s.trim();
    if !t.is_empty() {
        v.push(t.to_string());
    }
}

fn push_soft(v: &mut Vec<String>, s: &str) {
    let t = s.trim().trim_end_matches(SOFT).trim();
    if !t.is_empty() {
        v.push(t.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_sentence_one_chunk() {
        let c = chunk_text("我想做一個隨身硬體");
        assert_eq!(c.len(), 1);
    }

    #[test]
    fn splits_on_strong_punct() {
        let c = chunk_text("它能投影極光。也能擋掉視覺噪音！你需要換心情？");
        assert_eq!(c.len(), 3);
        assert_eq!(c[0], "它能投影極光");
    }

    #[test]
    fn merges_tiny_fragment() {
        // "好" 是碎片,應併回後面那句而非獨立成塊
        let c = chunk_text("好。我想做一個會投影的隨身硬體");
        assert_eq!(c.len(), 1);
        assert!(c[0].starts_with("好"));
    }

    #[test]
    fn empty_input() {
        assert!(chunk_text("   ").is_empty());
    }

    #[test]
    fn long_run_on_splits_on_comma() {
        let long = "這是一個非常非常冗長的句子，裡面一口氣塞了很多不同的想法跟枝節細節，多到一個句子根本裝不下，所以照理說應該要被逗號切開來，變成好幾個獨立的小塊才對";
        let c = chunk_text(long);
        assert!(c.len() >= 2, "過長句應被逗號細切,得到 {}", c.len());
    }
}
