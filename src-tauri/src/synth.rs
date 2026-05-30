//! Tier 2 「深度合成」：把 seed 想法 + 它的一階已確認連結,組成一段可貼進
//! ChatGPT Plus 的深挖 prompt。
//!
//! ⛔ 紅線 #5：高階思考一律走 ChatGPT Plus 人工複製貼上,**不程式化呼叫任何 API**。
//! 本模組只做「組字串」——沒有 reqwest、沒有網路、沒有模型呼叫。生成與回填都是人工。
//! 人工貼回的結果由 lib.rs::save_artifact 存進 artifacts 表（不覆寫 thoughts,守紅線 #2）。

/// 用 seed 原文 + 一階已確認連結的鄰居原文,組出深挖 prompt。
/// 有鄰居 → 走「跨想法合成」版；無鄰居 → 退化成「單一想法深挖」版（仍可用,只是少了跨連結張力）。
pub fn build_synthesis_prompt(seed: &str, neighbors: &[String]) -> String {
    let header = "你是一位善於跨領域深度綜合的思考夥伴。請做深度合成,不要逐條摘要。\n\
                  全程用繁體中文與台灣慣用詞彙。\n";

    if neighbors.is_empty() {
        format!(
            "{header}\n\
             【想法】\n{seed}\n\n\
             請完成:\n\
             1. 指出這個想法背後沒被講出來的深層主題或張力。\n\
             2. 提出 2-3 個延伸它、單看表面看不到的新洞見。\n\
             3. 給我一個可以繼續深挖的問題。"
        )
    } else {
        let mut list = String::new();
        for (i, n) in neighbors.iter().enumerate() {
            list.push_str(&format!("{}. {}\n", i + 1, n));
        }
        format!(
            "{header}\n\
             以下是我在不同時間記下、且我已親手確認彼此相關的一組想法。\n\n\
             【核心想法】\n{seed}\n\n\
             【我確認與它相關的想法】\n{list}\n\
             請完成:\n\
             1. 指出這些想法背後共同的深層主題或張力。\n\
             2. 提出 2-3 個它們交叉後才浮現、單看任一條看不到的新洞見。\n\
             3. 給我一個可以繼續深挖的問題。"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_neighbors_lists_them_numbered() {
        let p = build_synthesis_prompt(
            "沉沒成本為何難放手",
            &["損失趨避".to_string(), "身份認同投資".to_string()],
        );
        assert!(p.contains("沉沒成本為何難放手"));
        assert!(p.contains("1. 損失趨避"));
        assert!(p.contains("2. 身份認同投資"));
        assert!(p.contains("交叉後才浮現")); // 走合成版
    }

    #[test]
    fn without_neighbors_falls_back_to_single() {
        let p = build_synthesis_prompt("一個孤立的想法", &[]);
        assert!(p.contains("一個孤立的想法"));
        assert!(!p.contains("交叉後才浮現")); // 不是合成版
        assert!(p.contains("深層主題或張力"));
    }

    #[test]
    fn always_requests_traditional_chinese() {
        let p = build_synthesis_prompt("x", &["y".to_string()]);
        assert!(p.contains("繁體中文"));
    }
}
