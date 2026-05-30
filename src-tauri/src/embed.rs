//! 編碼層：本地 embedding（fastembed-rs + multilingual-e5-small,384 維,純本地、零計費）。
//!
//! 設計決策（依 spike 實證,寫進 docs/Design.md §embedding）：
//! 採「對稱」用法——所有文字一律加 "query: " 前綴。
//! spike v2 顯示非對稱(query/passage)相對於對稱的分離度差異微乎其微(間隙皆約 0.06),
//! 而對稱讓每個想法只需存「一個」向量、檢索時直接 cosine,免重嵌、免混用模式,故選對稱。

use anyhow::Result;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};

pub const DIM: usize = 384;

pub struct Embedder {
    model: TextEmbedding,
}

impl Embedder {
    pub fn new() -> Result<Self> {
        let model = TextEmbedding::try_new(
            InitOptions::new(EmbeddingModel::MultilingualE5Small).with_show_download_progress(true),
        )?;
        Ok(Self { model })
    }

    /// 批次編碼（M2 切塊後一次嵌入多句,較有效率;對稱用法,前綴 "query: "）。
    pub fn embed_batch(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let prefixed: Vec<String> = texts.iter().map(|t| format!("query: {t}")).collect();
        let out = self.model.embed(prefixed, None)?;
        debug_assert!(out.iter().all(|v| v.len() == DIM), "e5-small 應輸出 {DIM} 維");
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::cosine;

    // 需要下載模型,預設不跑;手動驗證用：cargo test -- --ignored
    #[test]
    #[ignore]
    fn embeds_chinese_and_ranks() {
        let mut e = Embedder::new().unwrap();
        let v = e
            .embed_batch(&[
                "我想用語音輸入取代打字".to_string(),
                "講話就能記筆記,不用敲鍵盤".to_string(),
                "今天晚餐想吃牛肉麵".to_string(),
            ])
            .unwrap();
        let (related_a, related_b, unrelated) = (&v[0], &v[1], &v[2]);
        assert_eq!(related_a.len(), DIM);
        let sim_rel = cosine(related_a, related_b);
        let sim_unrel = cosine(related_a, unrelated);
        assert!(
            sim_rel > sim_unrel,
            "相關({sim_rel:.3}) 應高於 無關({sim_unrel:.3})"
        );
    }
}
