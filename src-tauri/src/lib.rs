//! mycelium-lite 後端入口。
//! 資料流：add_thought（嵌入+存）→ find_connections（即時 top-K）→ confirm/reject（落地菌絲）。

mod chunk;
mod db;
mod embed;
mod graph;
mod spark;
mod synth;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use tauri::{Manager, State};

use embed::Embedder;

struct AppState {
    db: Mutex<Connection>,
    embedder: Mutex<Embedder>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// 倒進一個想法：切塊 → 各句嵌入 → 存進不可變的 thoughts + chunks。回傳新 id。
#[tauri::command]
fn add_thought(state: State<AppState>, text: String) -> Result<i64, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("想法不能是空的".into());
    }
    let pieces = chunk::chunk_text(&text);
    let vectors = {
        let mut emb = state.embedder.lock().unwrap();
        emb.embed_batch(&pieces).map_err(|e| e.to_string())?
    };
    let conn = state.db.lock().unwrap();
    let id = db::insert_thought(&conn, &text, now_ms()).map_err(|e| e.to_string())?;
    for (seq, (ptext, vec)) in pieces.iter().zip(vectors).enumerate() {
        db::insert_chunk(&conn, id, seq as i64, ptext, &vec).map_err(|e| e.to_string())?;
    }
    Ok(id)
}

/// 為某想法即時撈出最相關的 top-K 候選（max-sim,排除已決定過的）。
#[tauri::command]
fn find_connections(
    state: State<AppState>,
    thought_id: i64,
    top_k: usize,
) -> Result<Vec<graph::Candidate>, String> {
    let conn = state.db.lock().unwrap();
    let pool = db::all_thought_chunks(&conn).map_err(|e| e.to_string())?;
    let seed = pool
        .iter()
        .find(|t| t.id == thought_id)
        .ok_or_else(|| format!("找不到想法 {thought_id}"))?;
    let seed_vecs: Vec<Vec<f32>> = seed.chunks.iter().map(|(_, v)| v.clone()).collect();
    let exclude = db::decided_with(&conn, thought_id).map_err(|e| e.to_string())?;
    Ok(graph::find_candidates(
        &seed_vecs, thought_id, &pool, &exclude, top_k,
    ))
}

/// 確認一條連結 → 菌絲落地。
#[tauri::command]
fn confirm_link(state: State<AppState>, src: i64, dst: i64, similarity: f32) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::decide_link(&conn, src, dst, similarity, "confirmed", now_ms()).map_err(|e| e.to_string())
}

/// 否決一條連結 → 不再浮現。
#[tauri::command]
fn reject_link(state: State<AppState>, src: i64, dst: i64, similarity: f32) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::decide_link(&conn, src, dst, similarity, "rejected", now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_thoughts(state: State<AppState>) -> Result<Vec<db::Thought>, String> {
    let conn = state.db.lock().unwrap();
    db::list_thoughts(&conn).map_err(|e| e.to_string())
}

/// 刪除一個想法（含其連結）。
#[tauri::command]
fn delete_thought(state: State<AppState>, thought_id: i64) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::delete_thought(&conn, thought_id).map_err(|e| e.to_string())
}

/// 清空全部（測試重置）。
#[tauri::command]
fn clear_all(state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::clear_all(&conn).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct GraphEdge {
    src: i64,
    dst: i64,
    similarity: f32,
}

/// 已確認的連結 = 整面菌絲牆（M1 前端拿來呈現）。
#[tauri::command]
fn get_graph(state: State<AppState>) -> Result<Vec<GraphEdge>, String> {
    let conn = state.db.lock().unwrap();
    let links = db::confirmed_links(&conn).map_err(|e| e.to_string())?;
    Ok(links
        .into_iter()
        .map(|(src, dst, similarity)| GraphEdge { src, dst, similarity })
        .collect())
}

/// Tier 1.5 火花：對單一概念生成「延伸方向 + 隨想」激發靈感。
/// async 命令——先在小作用域取出原文並釋放 DB 鎖,再 await HTTP（MutexGuard 不跨 await）。
/// 輸出拋棄式,不入庫;人工保留才由前端走 add_thought 升格（守紅線 #2）。
#[tauri::command]
async fn spark(
    state: State<'_, AppState>,
    thought_id: i64,
    model: String,
    temperature: f32,
) -> Result<spark::SparkResult, String> {
    let text = {
        let conn = state.db.lock().unwrap();
        db::get_thought_text(&conn, thought_id).map_err(|e| e.to_string())?
    }
    .ok_or_else(|| format!("找不到想法 {thought_id}"))?;
    spark::generate(&model, &text, temperature).await
}

/// Ollama 探活 + 目標模型是否已拉,供前端優雅降級。
#[tauri::command]
async fn spark_health(model: String) -> Result<spark::SparkHealth, String> {
    Ok(spark::health(&model).await)
}

/// Tier 2 深挖：組出「seed + 一階已確認連結」的 prompt 給前端複製,人工貼進 ChatGPT Plus。
/// ⛔ 紅線 #5：只組字串,不呼叫任何 API。
#[tauri::command]
fn synthesis_prompt(state: State<AppState>, thought_id: i64) -> Result<String, String> {
    let conn = state.db.lock().unwrap();
    let seed = db::get_thought_text(&conn, thought_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("找不到想法 {thought_id}"))?;
    let neighbors: Vec<String> = db::confirmed_neighbors(&conn, thought_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(_, text)| text)
        .collect();
    Ok(synth::build_synthesis_prompt(&seed, &neighbors))
}

/// 存一份人工貼回的深度合成結果（關聯到 seed 想法;不覆寫 thoughts,守紅線 #2）。
#[tauri::command]
fn save_artifact(
    state: State<AppState>,
    thought_id: i64,
    prompt: String,
    response: String,
) -> Result<i64, String> {
    let response = response.trim().to_string();
    if response.is_empty() {
        return Err("貼回的內容不能是空的".into());
    }
    let conn = state.db.lock().unwrap();
    db::insert_artifact(&conn, thought_id, &prompt, &response, now_ms()).map_err(|e| e.to_string())
}

/// 列出某想法已存的深度合成 artifact。
#[tauri::command]
fn list_artifacts(state: State<AppState>, thought_id: i64) -> Result<Vec<db::Artifact>, String> {
    let conn = state.db.lock().unwrap();
    db::list_artifacts(&conn, thought_id).map_err(|e| e.to_string())
}

/// 刪一份 artifact（可逆操作）。
#[tauri::command]
fn delete_artifact(state: State<AppState>, artifact_id: i64) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::delete_artifact(&conn, artifact_id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("無法取得 app data 目錄");
            std::fs::create_dir_all(&dir).ok();
            let db_path = dir.join("mycelium.db");
            let conn = db::open(db_path.to_str().expect("路徑非 UTF-8")).expect("開啟資料庫失敗");
            // 首次啟動會下載 e5-small 模型（~100MB）並載入,故 setup 會阻塞數秒。
            let embedder = Embedder::new().expect("初始化 embedder 失敗");
            app.manage(AppState {
                db: Mutex::new(conn),
                embedder: Mutex::new(embedder),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_thought,
            find_connections,
            confirm_link,
            reject_link,
            list_thoughts,
            delete_thought,
            clear_all,
            get_graph,
            spark,
            spark_health,
            synthesis_prompt,
            save_artifact,
            list_artifacts,
            delete_artifact
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
