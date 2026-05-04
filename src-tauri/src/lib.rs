use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha384};
use sqlx::migrate::Migrator;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{FromRow, SqlitePool, Transaction};
use std::path::PathBuf;
use tauri::{Manager, State};
use uuid::Uuid;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

struct AppState {
    pool: SqlitePool,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    parent_id: Option<String>,
    title: String,
    description: String,
    status: String,
    priority: String,
    due_date: Option<String>,
    completed_at: Option<String>,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct Plan {
    id: String,
    r#type: String,
    title: String,
    period_start: String,
    period_end: String,
    summary_text: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanStats {
    total: i64,
    completed: i64,
    open: i64,
    overdue: i64,
    completion_rate: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanDetail {
    plan: Plan,
    tasks: Vec<Task>,
    stats: PlanStats,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskInput {
    parent_id: Option<String>,
    title: String,
    description: Option<String>,
    priority: Option<String>,
    due_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTaskInput {
    id: String,
    parent_id: Option<String>,
    title: String,
    description: String,
    priority: String,
    due_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnsurePlanInput {
    r#type: String,
    title: String,
    period_start: String,
    period_end: String,
}

#[tauri::command]
async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<Task>, String> {
    sqlx::query_as::<_, Task>(
        r#"
        SELECT id, parent_id, title, description, status, priority, due_date,
               completed_at, sort_order, created_at, updated_at
        FROM tasks
        ORDER BY COALESCE(parent_id, ''), sort_order, created_at
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(to_error)
}

#[tauri::command]
async fn create_task(state: State<'_, AppState>, input: CreateTaskInput) -> Result<Task, String> {
    validate_title(&input.title)?;
    validate_priority(input.priority.as_deref().unwrap_or("medium"))?;
    ensure_parent_exists(&state.pool, input.parent_id.as_deref()).await?;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let sort_order = next_sort_order(&state.pool, input.parent_id.as_deref()).await?;

    sqlx::query(
        r#"
        INSERT INTO tasks (
            id, parent_id, title, description, status, priority, due_date,
            completed_at, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(input.parent_id)
    .bind(input.title.trim())
    .bind(input.description.unwrap_or_default())
    .bind(input.priority.unwrap_or_else(|| "medium".to_string()))
    .bind(input.due_date)
    .bind(sort_order)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(to_error)?;

    get_task(&state.pool, &id).await
}

#[tauri::command]
async fn update_task(state: State<'_, AppState>, input: UpdateTaskInput) -> Result<Task, String> {
    validate_title(&input.title)?;
    validate_priority(&input.priority)?;
    ensure_task_exists(&state.pool, &input.id).await?;
    ensure_parent_exists(&state.pool, input.parent_id.as_deref()).await?;

    if would_create_cycle(&state.pool, &input.id, input.parent_id.as_deref()).await? {
        return Err("Cannot move a task under itself or one of its descendants".to_string());
    }

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        UPDATE tasks
        SET parent_id = ?, title = ?, description = ?, priority = ?, due_date = ?, updated_at = ?
        WHERE id = ?
        "#,
    )
    .bind(input.parent_id)
    .bind(input.title.trim())
    .bind(input.description)
    .bind(input.priority)
    .bind(input.due_date)
    .bind(&now)
    .bind(&input.id)
    .execute(&state.pool)
    .await
    .map_err(to_error)?;

    get_task(&state.pool, &input.id).await
}

#[tauri::command]
async fn delete_task(state: State<'_, AppState>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(to_error)?;

    Ok(())
}

#[tauri::command]
async fn toggle_task_status(state: State<'_, AppState>, id: String, completed: bool) -> Result<Vec<Task>, String> {
    ensure_task_exists(&state.pool, &id).await?;
    let now = Utc::now().to_rfc3339();
    let mut tx = state.pool.begin().await.map_err(to_error)?;

    if completed {
        sqlx::query(
            r#"
            WITH RECURSIVE descendants(id) AS (
                SELECT id FROM tasks WHERE id = ?
                UNION ALL
                SELECT tasks.id FROM tasks
                JOIN descendants ON tasks.parent_id = descendants.id
            )
            UPDATE tasks
            SET status = 'completed',
                completed_at = COALESCE(completed_at, ?),
                updated_at = ?
            WHERE id IN (SELECT id FROM descendants)
            "#,
        )
        .bind(&id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(to_error)?;

        sync_ancestors(&mut tx, &id, &now).await?;
    } else {
        sqlx::query(
            r#"
            WITH RECURSIVE affected(id) AS (
                SELECT id FROM tasks WHERE id = ?
                UNION ALL
                SELECT tasks.parent_id FROM tasks
                JOIN affected ON tasks.id = affected.id
                WHERE tasks.parent_id IS NOT NULL
            )
            UPDATE tasks
            SET status = 'open',
                completed_at = NULL,
                updated_at = ?
            WHERE id IN (SELECT id FROM affected)
            "#,
        )
        .bind(&id)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(to_error)?;
    }

    tx.commit().await.map_err(to_error)?;
    list_tasks(state).await
}

#[tauri::command]
async fn list_plans(state: State<'_, AppState>) -> Result<Vec<Plan>, String> {
    sqlx::query_as::<_, Plan>(
        r#"
        SELECT id, type, title, period_start, period_end, summary_text, created_at, updated_at
        FROM plans
        ORDER BY period_start DESC, type
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(to_error)
}

#[tauri::command]
async fn ensure_plan_period(state: State<'_, AppState>, input: EnsurePlanInput) -> Result<Plan, String> {
    validate_plan_type(&input.r#type)?;
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO plans (id, type, title, period_start, period_end, summary_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', ?, ?)
        ON CONFLICT(type, period_start) DO UPDATE SET
            title = excluded.title,
            period_end = excluded.period_end,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&input.r#type)
    .bind(&input.title)
    .bind(&input.period_start)
    .bind(&input.period_end)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(to_error)?;

    get_plan_by_period(&state.pool, &input.r#type, &input.period_start).await
}

#[tauri::command]
async fn add_task_to_plan(state: State<'_, AppState>, plan_id: String, task_id: String) -> Result<(), String> {
    ensure_task_exists(&state.pool, &task_id).await?;
    ensure_plan_exists(&state.pool, &plan_id).await?;
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT OR IGNORE INTO plan_tasks (plan_id, task_id, created_at)
        VALUES (?, ?, ?)
        "#,
    )
    .bind(plan_id)
    .bind(task_id)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(to_error)?;

    Ok(())
}

#[tauri::command]
async fn remove_task_from_plan(state: State<'_, AppState>, plan_id: String, task_id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM plan_tasks WHERE plan_id = ? AND task_id = ?")
        .bind(plan_id)
        .bind(task_id)
        .execute(&state.pool)
        .await
        .map_err(to_error)?;

    Ok(())
}

#[tauri::command]
async fn get_plan_detail(state: State<'_, AppState>, plan_id: String) -> Result<PlanDetail, String> {
    let plan = get_plan(&state.pool, &plan_id).await?;
    let tasks = sqlx::query_as::<_, Task>(
        r#"
        SELECT tasks.id, tasks.parent_id, tasks.title, tasks.description, tasks.status,
               tasks.priority, tasks.due_date, tasks.completed_at, tasks.sort_order,
               tasks.created_at, tasks.updated_at
        FROM tasks
        JOIN plan_tasks ON plan_tasks.task_id = tasks.id
        WHERE plan_tasks.plan_id = ?
        ORDER BY tasks.sort_order, tasks.created_at
        "#,
    )
    .bind(&plan_id)
    .fetch_all(&state.pool)
    .await
    .map_err(to_error)?;

    let stats = calculate_stats(&tasks);
    Ok(PlanDetail { plan, tasks, stats })
}

#[tauri::command]
async fn update_plan_summary_text(
    state: State<'_, AppState>,
    plan_id: String,
    summary_text: String,
) -> Result<Plan, String> {
    let now = Utc::now().to_rfc3339();

    sqlx::query("UPDATE plans SET summary_text = ?, updated_at = ? WHERE id = ?")
        .bind(summary_text)
        .bind(now)
        .bind(&plan_id)
        .execute(&state.pool)
        .await
        .map_err(to_error)?;

    get_plan(&state.pool, &plan_id).await
}

async fn get_task(pool: &SqlitePool, id: &str) -> Result<Task, String> {
    sqlx::query_as::<_, Task>(
        r#"
        SELECT id, parent_id, title, description, status, priority, due_date,
               completed_at, sort_order, created_at, updated_at
        FROM tasks
        WHERE id = ?
        "#,
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(to_error)
}

async fn get_plan(pool: &SqlitePool, id: &str) -> Result<Plan, String> {
    sqlx::query_as::<_, Plan>(
        r#"
        SELECT id, type, title, period_start, period_end, summary_text, created_at, updated_at
        FROM plans
        WHERE id = ?
        "#,
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(to_error)
}

async fn get_plan_by_period(pool: &SqlitePool, plan_type: &str, period_start: &str) -> Result<Plan, String> {
    sqlx::query_as::<_, Plan>(
        r#"
        SELECT id, type, title, period_start, period_end, summary_text, created_at, updated_at
        FROM plans
        WHERE type = ? AND period_start = ?
        "#,
    )
    .bind(plan_type)
    .bind(period_start)
    .fetch_one(pool)
    .await
    .map_err(to_error)
}

async fn ensure_task_exists(pool: &SqlitePool, id: &str) -> Result<(), String> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(to_error)?;

    if count == 0 {
        Err("Task not found".to_string())
    } else {
        Ok(())
    }
}

async fn ensure_parent_exists(pool: &SqlitePool, parent_id: Option<&str>) -> Result<(), String> {
    if let Some(parent_id) = parent_id {
        ensure_task_exists(pool, parent_id).await?;
    }
    Ok(())
}

async fn ensure_plan_exists(pool: &SqlitePool, id: &str) -> Result<(), String> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plans WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(to_error)?;

    if count == 0 {
        Err("Plan not found".to_string())
    } else {
        Ok(())
    }
}

async fn next_sort_order(pool: &SqlitePool, parent_id: Option<&str>) -> Result<i64, String> {
    let next: i64 = match parent_id {
        Some(parent_id) => {
            sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks WHERE parent_id = ?")
                .bind(parent_id)
                .fetch_one(pool)
                .await
                .map_err(to_error)?
        }
        None => {
            sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks WHERE parent_id IS NULL")
                .fetch_one(pool)
                .await
                .map_err(to_error)?
        }
    };

    Ok(next)
}

async fn would_create_cycle(pool: &SqlitePool, task_id: &str, parent_id: Option<&str>) -> Result<bool, String> {
    let mut current = parent_id.map(str::to_string);

    while let Some(current_id) = current {
        if current_id == task_id {
            return Ok(true);
        }

        current = sqlx::query_scalar::<_, Option<String>>("SELECT parent_id FROM tasks WHERE id = ?")
            .bind(current_id)
            .fetch_one(pool)
            .await
            .map_err(to_error)?;
    }

    Ok(false)
}

async fn sync_ancestors(tx: &mut Transaction<'_, sqlx::Sqlite>, task_id: &str, now: &str) -> Result<(), String> {
    let ancestor_ids: Vec<(String,)> = sqlx::query_as(
        r#"
        WITH RECURSIVE ancestors(id, depth) AS (
            SELECT parent_id, 1 FROM tasks WHERE id = ? AND parent_id IS NOT NULL
            UNION ALL
            SELECT tasks.parent_id, ancestors.depth + 1
            FROM tasks
            JOIN ancestors ON tasks.id = ancestors.id
            WHERE tasks.parent_id IS NOT NULL
        )
        SELECT id FROM ancestors ORDER BY depth ASC
        "#,
    )
    .bind(task_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(to_error)?;

    for (ancestor_id,) in ancestor_ids {
        let (total, completed): (i64, i64) = sqlx::query_as(
            r#"
            SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)
            FROM tasks
            WHERE parent_id = ?
            "#,
        )
        .bind(&ancestor_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(to_error)?;

        let all_children_complete = total > 0 && total == completed;
        sqlx::query(
            r#"
            UPDATE tasks
            SET status = ?,
                completed_at = CASE WHEN ? THEN COALESCE(completed_at, ?) ELSE NULL END,
                updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(if all_children_complete { "completed" } else { "open" })
        .bind(all_children_complete)
        .bind(now)
        .bind(now)
        .bind(&ancestor_id)
        .execute(&mut **tx)
        .await
        .map_err(to_error)?;
    }

    Ok(())
}

fn calculate_stats(tasks: &[Task]) -> PlanStats {
    let total = tasks.len() as i64;
    let completed = tasks.iter().filter(|task| task.status == "completed").count() as i64;
    let open = total - completed;
    let today = Utc::now().date_naive().to_string();
    let overdue = tasks
        .iter()
        .filter(|task| task.status != "completed")
        .filter(|task| task.due_date.as_deref().is_some_and(|due_date| due_date < today.as_str()))
        .count() as i64;
    let completion_rate = if total == 0 {
        0
    } else {
        ((completed as f64 / total as f64) * 100.0).round() as i64
    };

    PlanStats {
        total,
        completed,
        open,
        overdue,
        completion_rate,
    }
}

fn validate_title(title: &str) -> Result<(), String> {
    if title.trim().is_empty() {
        Err("Task title cannot be empty".to_string())
    } else {
        Ok(())
    }
}

fn validate_priority(priority: &str) -> Result<(), String> {
    match priority {
        "low" | "medium" | "high" => Ok(()),
        _ => Err("Priority must be low, medium, or high".to_string()),
    }
}

fn validate_plan_type(plan_type: &str) -> Result<(), String> {
    match plan_type {
        "week" | "month" => Ok(()),
        _ => Err("Plan type must be week or month".to_string()),
    }
}

fn to_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            if has_updater_config(app.config()) {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            let app_handle = app.handle().clone();

            tauri::async_runtime::block_on(async move {
                let data_dir = modern_todo_data_dir(&app_handle)?;
                std::fs::create_dir_all(&data_dir)?;
                let db_path = data_dir.join("todo.sqlite");
                migrate_legacy_database(&app_handle, &db_path)?;
                let options = SqliteConnectOptions::new()
                    .filename(&db_path)
                    .create_if_missing(true)
                    .foreign_keys(true);
                let pool = SqlitePoolOptions::new()
                    .max_connections(5)
                    .connect_with(options)
                    .await?;

                repair_migration_line_ending_checksums(&pool, &MIGRATOR).await?;
                MIGRATOR.run(&pool).await?;
                app_handle.manage(AppState { pool });
                Ok::<(), Box<dyn std::error::Error>>(())
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tasks,
            create_task,
            update_task,
            delete_task,
            toggle_task_status,
            list_plans,
            ensure_plan_period,
            add_task_to_plan,
            remove_task_from_plan,
            get_plan_detail,
            update_plan_summary_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn has_updater_config(config: &tauri::Config) -> bool {
    config
        .plugins
        .0
        .get("updater")
        .is_some_and(|updater_config| !updater_config.is_null())
}

async fn repair_migration_line_ending_checksums(pool: &SqlitePool, migrator: &Migrator) -> Result<(), sqlx::Error> {
    let has_migrations_table: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'")
            .fetch_optional(pool)
            .await?;

    if has_migrations_table.is_none() {
        return Ok(());
    }

    for migration in migrator.iter() {
        let applied_checksum: Option<Vec<u8>> =
            sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = ? AND success = 1")
                .bind(migration.version)
                .fetch_optional(pool)
                .await?;

        let Some(applied_checksum) = applied_checksum else {
            continue;
        };

        if applied_checksum == migration.checksum.as_ref() {
            continue;
        }

        if line_ending_checksum_matches(&migration.sql, &applied_checksum) {
            sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
                .bind(migration.checksum.as_ref())
                .bind(migration.version)
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}

fn line_ending_checksum_matches(sql: &str, checksum: &[u8]) -> bool {
    line_ending_checksum_variants(sql)
        .iter()
        .any(|variant_checksum| variant_checksum.as_slice() == checksum)
}

fn line_ending_checksum_variants(sql: &str) -> [Vec<u8>; 2] {
    let lf_sql = sql.replace("\r\n", "\n");
    let crlf_sql = lf_sql.replace('\n', "\r\n");

    [sha384(&lf_sql), sha384(&crlf_sql)]
}

fn sha384(value: &str) -> Vec<u8> {
    Sha384::digest(value.as_bytes()).to_vec()
}

fn modern_todo_data_dir<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app_handle.path().home_dir()?.join(".modern-todo"))
}

fn migrate_legacy_database<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    db_path: &std::path::Path,
) -> tauri::Result<()> {
    if db_path.exists() {
        return Ok(());
    }

    let legacy_db_path = app_handle.path().app_data_dir()?.join("todo.sqlite");
    if legacy_db_path.exists() {
        std::fs::copy(legacy_db_path, db_path)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::{has_updater_config, line_ending_checksum_matches};
    use serde_json::json;
    use tauri::utils::config::{Config, PluginConfig};

    #[test]
    fn updater_is_disabled_when_config_is_missing() {
        let config = Config {
            plugins: PluginConfig::default(),
            ..Default::default()
        };

        assert!(!has_updater_config(&config));
    }

    #[test]
    fn updater_is_disabled_when_config_is_null() {
        let config = Config {
            plugins: PluginConfig([("updater".to_string(), json!(null))].into()),
            ..Default::default()
        };

        assert!(!has_updater_config(&config));
    }

    #[test]
    fn updater_is_enabled_when_config_is_an_object() {
        let config = Config {
            plugins: PluginConfig([("updater".to_string(), json!({ "pubkey": "key", "endpoints": [] }))].into()),
            ..Default::default()
        };

        assert!(has_updater_config(&config));
    }

    #[test]
    fn line_ending_checksum_match_accepts_crlf_checksum_for_lf_sql() {
        let lf_sql = "CREATE TABLE items (id INTEGER PRIMARY KEY);\n";
        let crlf_checksum =
            hex_bytes("cace7e15a9dfaeecece4bea29803cc1bc8f3fbf7cf87a95f6ab97f0937a8706fbcda77c08f08d01e35ef6babcf331f53");

        assert!(line_ending_checksum_matches(lf_sql, &crlf_checksum));
    }

    fn hex_bytes(hex: &str) -> Vec<u8> {
        hex.as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let value = std::str::from_utf8(pair).expect("hex pair");
                u8::from_str_radix(value, 16).expect("valid hex")
            })
            .collect()
    }
}
