//! 儲存層：SQLite。
//! thoughts = 原文不可變層（整段顯示用）。
//! chunks   = 一個 thought 切成多句,每句一個 384 維向量（M2 多向量 + max-sim）。
//! links    = 使用者「確認/否決」過的連結 = 親手長出的菌絲。pending 不入庫,即時算。

use std::collections::HashSet;

use anyhow::Result;
use rusqlite::{params, Connection};

const SCHEMA_VERSION: i64 = 2;

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    init_schema(&conn)?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    // 舊 schema（v1，向量直接掛在 thoughts）無法 in-place 升級 → 直接重建（test data 拋棄）。
    let ver: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if ver < SCHEMA_VERSION {
        conn.execute_batch(
            "DROP TABLE IF EXISTS links;
             DROP TABLE IF EXISTS chunks;
             DROP TABLE IF EXISTS thoughts;",
        )?;
    }
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS thoughts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at INTEGER NOT NULL,
            text       TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            thought_id INTEGER NOT NULL REFERENCES thoughts(id),
            seq        INTEGER NOT NULL,
            text       TEXT NOT NULL,
            vector     BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_thought ON chunks(thought_id);
        CREATE TABLE IF NOT EXISTS links (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            src        INTEGER NOT NULL REFERENCES thoughts(id),
            dst        INTEGER NOT NULL REFERENCES thoughts(id),
            similarity REAL    NOT NULL,
            status     TEXT    NOT NULL CHECK(status IN ('confirmed','rejected')),
            created_at INTEGER NOT NULL,
            UNIQUE(src, dst)
        );
        ",
    )?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

// ── 向量 <-> BLOB ──────────────────────────────────────────────────────────
pub fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    let mut b = Vec::with_capacity(v.len() * 4);
    for x in v {
        b.extend_from_slice(&x.to_le_bytes());
    }
    b
}

pub fn blob_to_vec(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

// ── thoughts ────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, serde::Serialize)]
pub struct Thought {
    pub id: i64,
    pub created_at: i64,
    pub text: String,
}

pub fn insert_thought(conn: &Connection, text: &str, now: i64) -> Result<i64> {
    conn.execute(
        "INSERT INTO thoughts (created_at, text) VALUES (?1, ?2)",
        params![now, text],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn insert_chunk(
    conn: &Connection,
    thought_id: i64,
    seq: i64,
    text: &str,
    vector: &[f32],
) -> Result<()> {
    conn.execute(
        "INSERT INTO chunks (thought_id, seq, text, vector) VALUES (?1,?2,?3,?4)",
        params![thought_id, seq, text, vec_to_blob(vector)],
    )?;
    Ok(())
}

pub fn list_thoughts(conn: &Connection) -> Result<Vec<Thought>> {
    let mut stmt =
        conn.prepare("SELECT id, created_at, text FROM thoughts ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], |r| {
        Ok(Thought {
            id: r.get(0)?,
            created_at: r.get(1)?,
            text: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// 一個 thought 連同它的所有句子向量（檢索池的單位）。
#[derive(Debug, Clone)]
pub struct ThoughtChunks {
    pub id: i64,
    pub created_at: i64,
    pub text: String,
    pub chunks: Vec<(String, Vec<f32>)>, // (句子文字, 向量)
}

pub fn all_thought_chunks(conn: &Connection) -> Result<Vec<ThoughtChunks>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.created_at, t.text, c.text, c.vector
         FROM thoughts t JOIN chunks c ON c.thought_id = t.id
         ORDER BY t.id, c.seq",
    )?;
    let rows = stmt.query_map([], |r| {
        let blob: Vec<u8> = r.get(4)?;
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            blob_to_vec(&blob),
        ))
    })?;

    let mut out: Vec<ThoughtChunks> = Vec::new();
    for row in rows {
        let (id, created_at, ttext, ctext, vec) = row?;
        match out.last_mut() {
            Some(last) if last.id == id => last.chunks.push((ctext, vec)),
            _ => out.push(ThoughtChunks {
                id,
                created_at,
                text: ttext,
                chunks: vec![(ctext, vec)],
            }),
        }
    }
    Ok(out)
}

// ── links（確認制策展）────────────────────────────────────────────────────────
fn norm(a: i64, b: i64) -> (i64, i64) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

pub fn decide_link(
    conn: &Connection,
    src: i64,
    dst: i64,
    similarity: f32,
    status: &str,
    now: i64,
) -> Result<()> {
    let (a, b) = norm(src, dst);
    conn.execute(
        "INSERT INTO links (src, dst, similarity, status, created_at) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(src,dst) DO UPDATE SET status=excluded.status, similarity=excluded.similarity",
        params![a, b, similarity as f64, status, now],
    )?;
    Ok(())
}

pub fn decided_with(conn: &Connection, thought_id: i64) -> Result<HashSet<i64>> {
    let mut stmt = conn.prepare("SELECT src, dst FROM links WHERE src=?1 OR dst=?1")?;
    let rows = stmt.query_map(params![thought_id], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
    })?;
    let mut set = HashSet::new();
    for row in rows {
        let (s, d) = row?;
        set.insert(if s == thought_id { d } else { s });
    }
    Ok(set)
}

pub fn confirmed_links(conn: &Connection) -> Result<Vec<(i64, i64, f32)>> {
    let mut stmt =
        conn.prepare("SELECT src, dst, similarity FROM links WHERE status='confirmed'")?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, f64>(2)? as f32))
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// 刪除一個想法 + 它的句子 + 它的連結。
pub fn delete_thought(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM links WHERE src=?1 OR dst=?1", params![id])?;
    conn.execute("DELETE FROM chunks WHERE thought_id=?1", params![id])?;
    conn.execute("DELETE FROM thoughts WHERE id=?1", params![id])?;
    Ok(())
}

pub fn clear_all(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM links; DELETE FROM chunks; DELETE FROM thoughts;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    /// 測試輔助：存一個 thought + 一句 chunk。
    fn add(conn: &Connection, text: &str, vec: &[f32], now: i64) -> i64 {
        let id = insert_thought(conn, text, now).unwrap();
        insert_chunk(conn, id, 0, text, vec).unwrap();
        id
    }

    #[test]
    fn blob_roundtrip() {
        let v = vec![0.1_f32, -0.5, 1.25, 0.0];
        assert_eq!(blob_to_vec(&vec_to_blob(&v)), v);
    }

    #[test]
    fn insert_and_list() {
        let conn = mem();
        add(&conn, "想法一", &[1.0, 0.0], 100);
        add(&conn, "想法二", &[0.0, 1.0], 200);
        let list = list_thoughts(&conn).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].text, "想法二"); // created_at DESC
    }

    #[test]
    fn multi_chunk_grouping() {
        let conn = mem();
        let id = insert_thought(&conn, "整段", 1).unwrap();
        insert_chunk(&conn, id, 0, "句一", &[1.0, 0.0]).unwrap();
        insert_chunk(&conn, id, 1, "句二", &[0.0, 1.0]).unwrap();
        let pool = all_thought_chunks(&conn).unwrap();
        assert_eq!(pool.len(), 1);
        assert_eq!(pool[0].chunks.len(), 2);
        assert_eq!(pool[0].chunks[0].0, "句一");
    }

    #[test]
    fn link_decision_and_exclusion() {
        let conn = mem();
        let a = add(&conn, "a", &[1.0], 1);
        let b = add(&conn, "b", &[1.0], 2);
        let c = add(&conn, "c", &[1.0], 3);
        decide_link(&conn, b, a, 0.9, "confirmed", 10).unwrap();
        decide_link(&conn, a, c, 0.8, "rejected", 11).unwrap();
        let decided = decided_with(&conn, a).unwrap();
        assert!(decided.contains(&b) && decided.contains(&c));
        assert_eq!(decided.len(), 2);
        assert_eq!(confirmed_links(&conn).unwrap().len(), 1);
    }

    #[test]
    fn delete_removes_thought_chunks_and_links() {
        let conn = mem();
        let a = add(&conn, "a", &[1.0], 1);
        let b = add(&conn, "b", &[1.0], 2);
        decide_link(&conn, a, b, 0.9, "confirmed", 10).unwrap();
        delete_thought(&conn, a).unwrap();
        assert_eq!(list_thoughts(&conn).unwrap().len(), 1);
        assert!(decided_with(&conn, b).unwrap().is_empty());
        // a 的 chunk 也清了
        assert!(all_thought_chunks(&conn).unwrap().iter().all(|t| t.id != a));
        clear_all(&conn).unwrap();
        assert_eq!(list_thoughts(&conn).unwrap().len(), 0);
    }

    #[test]
    fn decision_upsert_overwrites() {
        let conn = mem();
        let a = add(&conn, "a", &[1.0], 1);
        let b = add(&conn, "b", &[1.0], 2);
        decide_link(&conn, a, b, 0.5, "rejected", 10).unwrap();
        decide_link(&conn, a, b, 0.7, "confirmed", 11).unwrap();
        assert_eq!(confirmed_links(&conn).unwrap().len(), 1);
    }
}
