//! Tier 1.5 「靈感火花」：對單一概念呼叫本地 Ollama 生成「延伸方向 + 隨想」。
//!
//! 角色 ≠ 被砍的 Tier 1（連結過濾器）。火花是發散式激發靈感,純建議、拋棄式——
//! 輸出不入庫,人工挑/改後才由前端走 add_thought 升格成新 thought（守紅線 #2）。
//!
//! spike 實證（workspace/sandbox/qwen3-spark-spike）：qwen3 家族守繁中、守格式、會發散;
//! qwen2.5 守不住格式。預設 qwen3.5:4b（6GB 裝得下）,8GB+ 可選 qwen3:8b。

use std::time::Duration;

const OLLAMA: &str = "http://localhost:11434";

/// 火花結果：三條延伸方向 + 一段隨想。
#[derive(Debug, serde::Serialize)]
pub struct SparkResult {
    pub directions: Vec<String>,
    pub musing: String,
}

/// Ollama 健康狀態,供前端優雅降級。
#[derive(Debug, serde::Serialize)]
pub struct SparkHealth {
    pub ollama_up: bool,
    pub model_ready: bool,
}

#[derive(serde::Serialize)]
struct GenReq<'a> {
    model: &'a str,
    prompt: String,
    stream: bool,
    // qwen3 thinking mode 預設開,會吐 <think> 污染輸出 → 必關。
    think: bool,
    options: GenOpts,
}

#[derive(serde::Serialize)]
struct GenOpts {
    temperature: f32,
}

#[derive(serde::Deserialize)]
struct GenResp {
    response: String,
}

#[derive(serde::Deserialize)]
struct TagsResp {
    models: Vec<TagModel>,
}

#[derive(serde::Deserialize)]
struct TagModel {
    name: String,
}

/// spike 定案模板：去 `<>` 佔位 + 要求台灣慣用詞彙（壓制 4b 偶帶的陸式詞彙）。
pub fn build_prompt(thought: &str) -> String {
    format!(
        "你是發想助手。針對下面這個想法,給我激發靈感的延伸,不要完整方案,要發散、可以歪。\n\
         務必用繁體中文與台灣慣用詞彙。嚴格照以下格式輸出,不要加任何其他文字:\n\n\
         方向:\n\
         - 關鍵詞或切角一\n\
         - 關鍵詞或切角二\n\
         - 關鍵詞或切角三\n\
         隨想:\n\
         (50 字以內,一段聯想短文)\n\n\
         想法:「{thought}」"
    )
}

/// 對單一概念生成火花。
pub async fn generate(model: &str, thought: &str, temperature: f32) -> Result<SparkResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let req = GenReq {
        model,
        prompt: build_prompt(thought),
        stream: false,
        think: false,
        options: GenOpts { temperature },
    };
    let resp = client
        .post(format!("{OLLAMA}/api/generate"))
        .json(&req)
        .send()
        .await
        .map_err(|e| friendly_err(&e))?;
    if !resp.status().is_success() {
        return Err(format!("Ollama 回應 {}", resp.status()));
    }
    let body: GenResp = resp.json().await.map_err(|e| e.to_string())?;
    Ok(parse_spark(&body.response))
}

/// 探活 + 確認目標模型已拉,供前端決定火花入口要不要亮。
pub async fn health(model: &str) -> SparkHealth {
    let down = SparkHealth {
        ollama_up: false,
        model_ready: false,
    };
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return down,
    };
    match client.get(format!("{OLLAMA}/api/tags")).send().await {
        Ok(r) if r.status().is_success() => match r.json::<TagsResp>().await {
            Ok(tags) => SparkHealth {
                ollama_up: true,
                model_ready: tags.models.iter().any(|m| m.name == model),
            },
            Err(_) => SparkHealth {
                ollama_up: true,
                model_ready: false,
            },
        },
        _ => down,
    }
}

fn friendly_err(e: &reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "連不上 Ollama（是否未啟動？）".into()
    } else {
        e.to_string()
    }
}

// ── 解析（純函式,可單測）────────────────────────────────────────────────────

/// 把 Ollama 原始輸出解析成 SparkResult。
/// 容忍小模型變異：全形/半形冒號、不同 bullet 記號、4b 偶爾殘留的 `<>` 佔位、
/// 以及保險再 strip 一次 `<think>`（雖然已設 think:false）。
pub fn parse_spark(raw: &str) -> SparkResult {
    let cleaned = strip_think(raw);
    let mut directions = Vec::new();
    let mut musing_lines: Vec<String> = Vec::new();
    let mut in_musing = false;

    for line in cleaned.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        // 「隨想」標頭（兼容簡體「随想」）→ 切到隨想模式,同行冒號後的文字也收。
        if t.starts_with("隨想") || t.starts_with("随想") {
            in_musing = true;
            if let Some(rest) = after_colon(t) {
                if !rest.is_empty() {
                    musing_lines.push(rest.to_string());
                }
            }
            continue;
        }
        if in_musing {
            musing_lines.push(t.to_string());
        } else if let Some(d) = clean_direction(t) {
            // 只收 bullet 行 → 「方向:」標頭、空白自動被忽略。
            directions.push(d);
        }
    }

    SparkResult {
        directions,
        musing: musing_lines.join(""),
    }
}

/// 手動 strip `<think>...</think>`（避免引入 regex crate）。未閉合則丟到結尾。
fn strip_think(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find("<think>") {
        out.push_str(&rest[..start]);
        match rest[start..].find("</think>") {
            Some(end) => rest = &rest[start + end + "</think>".len()..],
            None => return out, // 未閉合,丟棄其後
        }
    }
    out.push_str(rest);
    out
}

fn after_colon(t: &str) -> Option<&str> {
    t.split_once([':', '：']).map(|(_, b)| b.trim())
}

/// bullet 行 → 去掉記號、去掉殘留的 `<>` 佔位,回傳乾淨方向；非 bullet 回 None。
fn clean_direction(t: &str) -> Option<String> {
    let body = ["- ", "-", "•", "*", "・", "‧"]
        .iter()
        .find_map(|p| t.strip_prefix(p))?;
    let s = body.trim().trim_matches(['<', '>', ' ']).trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_output() {
        let raw = "方向:\n- 水流與靈感\n- 記憶斷裂\n- 溫度與創意\n隨想:\n洗澡時點子像泡沫,一出水就消失。";
        let r = parse_spark(raw);
        assert_eq!(r.directions, vec!["水流與靈感", "記憶斷裂", "溫度與創意"]);
        assert_eq!(r.musing, "洗澡時點子像泡沫,一出水就消失。");
    }

    #[test]
    fn tolerates_fullwidth_colon_and_spaces() {
        // qwen3 實測會吐全形冒號 + 行尾空白
        let raw = "方向：  \n- 甲  \n- 乙\n- 丙  \n隨想：  \n一段聯想。";
        let r = parse_spark(raw);
        assert_eq!(r.directions, vec!["甲", "乙", "丙"]);
        assert_eq!(r.musing, "一段聯想。");
    }

    #[test]
    fn strips_angle_bracket_placeholders() {
        // 4b 在高 temperature 偶爾把方向包成 <...>
        let raw = "方向:\n- <規則vs本能>\n- <身體記憶>\n- <語言變異>\n隨想:\n語言是肌肉記憶。";
        let r = parse_spark(raw);
        assert_eq!(r.directions, vec!["規則vs本能", "身體記憶", "語言變異"]);
    }

    #[test]
    fn strips_think_block() {
        let raw = "<think>讓我想想…</think>方向:\n- 甲\n隨想:\n短想。";
        let r = parse_spark(raw);
        assert_eq!(r.directions, vec!["甲"]);
        assert_eq!(r.musing, "短想。");
    }

    #[test]
    fn handles_inline_musing_after_colon() {
        let raw = "方向:\n- 甲\n- 乙\n- 丙\n隨想:這是同一行的隨想";
        let r = parse_spark(raw);
        assert_eq!(r.musing, "這是同一行的隨想");
    }

    #[test]
    fn ignores_header_and_blank_lines() {
        let raw = "方向:\n\n- 甲\n\n隨想:\n\n想。";
        let r = parse_spark(raw);
        assert_eq!(r.directions, vec!["甲"]);
        assert_eq!(r.musing, "想。");
    }

    /// 端到端：真連本機 Ollama 走完整 Rust 路徑（reqwest→生成→解析）。
    /// 預設略過,手動跑：`cargo test live_generate -- --ignored --nocapture`
    #[test]
    #[ignore = "需本機 Ollama + qwen3.5:4b"]
    fn live_generate_against_ollama() {
        let r = tauri::async_runtime::block_on(generate(
            "qwen3.5:4b",
            "為什麼人會對沉沒成本如此執著",
            0.7,
        ))
        .expect("generate 應成功");
        eprintln!("directions={:?}\nmusing={}", r.directions, r.musing);
        assert!(!r.directions.is_empty(), "方向不該為空");
        assert!(!r.musing.trim().is_empty(), "隨想不該為空");
    }
}
