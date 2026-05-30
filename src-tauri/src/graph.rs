//! 檢索層：對一個「種子想法」,從所有舊想法中撈出最相關的候選。
//!
//! M2：多向量 max-sim。種子與候選各有多句向量,兩段相關度 = 句子兩兩 cosine 取最大,
//! 並記住「對到哪一句」(matched_text),讓 UI 顯示是哪個 idea 連上的。
//!
//! 命門鐵律（spike 實證）：e5 的 cosine 擠在高窄帶,不可用絕對門檻,
//! 一律用相對排序 top-K。跨時間加權留待 M2 之後。

use std::collections::HashSet;

use crate::db::ThoughtChunks;

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na * nb)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Candidate {
    pub id: i64,
    pub text: String,
    pub created_at: i64,
    pub similarity: f32,
    pub matched_text: String, // 候選那邊對到的句子
}

/// 從 pool 撈與 seed 最相關的 top-K（排除自己 + 已決定過的）。
/// 相關度 = seed 各句 × 候選各句 的 cosine 最大值。
pub fn find_candidates(
    seed_chunks: &[Vec<f32>],
    seed_id: i64,
    pool: &[ThoughtChunks],
    exclude: &HashSet<i64>,
    top_k: usize,
) -> Vec<Candidate> {
    let mut scored: Vec<Candidate> = Vec::new();

    for cand in pool {
        if cand.id == seed_id || exclude.contains(&cand.id) {
            continue;
        }
        let mut best_sim = f32::MIN;
        let mut best_text = String::new();
        for sv in seed_chunks {
            for (ctext, cv) in &cand.chunks {
                let s = cosine(sv, cv);
                if s > best_sim {
                    best_sim = s;
                    best_text = ctext.clone();
                }
            }
        }
        if best_sim == f32::MIN {
            continue; // 候選沒有任何句子（理論上不會發生）
        }
        scored.push(Candidate {
            id: cand.id,
            text: cand.text.clone(),
            created_at: cand.created_at,
            similarity: best_sim,
            matched_text: best_text,
        });
    }

    scored.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap());
    scored.truncate(top_k);
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tc(id: i64, text: &str, chunks: Vec<(&str, Vec<f32>)>) -> ThoughtChunks {
        ThoughtChunks {
            id,
            created_at: id * 10,
            text: text.into(),
            chunks: chunks.into_iter().map(|(t, v)| (t.to_string(), v)).collect(),
        }
    }

    #[test]
    fn cosine_basics() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 1.0]), 0.0);
    }

    #[test]
    fn max_sim_picks_best_matching_chunk() {
        // seed 只有一句,方向 [1,0]
        let seed = vec![vec![1.0, 0.0]];
        let pool = vec![
            // 候選2：兩句,第二句 [0.99,0.1] 對得很準 → 應排第一,matched=「準的那句」
            tc(2, "候選二整段", vec![("無關句", vec![0.0, 1.0]), ("準的那句", vec![0.99, 0.1])]),
            // 候選3：一句,中等
            tc(3, "候選三", vec![("中等", vec![0.6, 0.6])]),
            // 候選4：完全無關
            tc(4, "候選四", vec![("無關", vec![0.0, 1.0])]),
        ];
        let got = find_candidates(&seed, 1, &pool, &HashSet::new(), 3);
        assert_eq!(got[0].id, 2);
        assert_eq!(got[0].matched_text, "準的那句"); // max-sim 選對句子
        assert_eq!(got[1].id, 3);
        assert_eq!(got[2].id, 4);
    }

    #[test]
    fn excludes_self_and_decided() {
        let seed = vec![vec![1.0, 0.0]];
        let pool = vec![
            tc(1, "self", vec![("self", vec![1.0, 0.0])]),
            tc(2, "near", vec![("near", vec![0.95, 0.0])]),
            tc(5, "decided", vec![("decided", vec![0.99, 0.0])]),
        ];
        let got = find_candidates(&seed, 1, &pool, &HashSet::from([5]), 5);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, 2);
    }
}
