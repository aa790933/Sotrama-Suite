//! One process, two jobs: migrate a database or serve IPC to the Electron main process.
//! Credentials are read from SOTRAMA_* environment variables so they stay out of argv.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use clap::Parser;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

mod database;
mod error;
mod ipc;
mod schemas;
mod types;

use crate::database::Db;
use crate::types::MariaDBConfig;

// No `Debug`: the password must never reach a log line through `{:?}`.
#[derive(Parser)]
#[command(
    name = "sotrama-backend",
    version,
    about = "Sotrama Suite data backend"
)]
struct Args {
    /// Serve the JSON-RPC protocol on stdin/stdout.
    #[arg(long)]
    serve: bool,

    /// Connect, migrate, print the report, exit. Safe to run repeatedly.
    #[arg(long)]
    migrate: bool,

    /// Restore a verified Rust backup into a brand-new database (never overwrite).
    #[arg(long, value_name = "SQL_FILE")]
    restore_backup: Option<PathBuf>,

    /// New database name for --restore-backup. Existing databases are refused.
    #[arg(long, value_name = "DATABASE")]
    restore_to: Option<String>,

    #[arg(long, env = "SOTRAMA_DB_HOST", default_value = "localhost")]
    host: String,

    #[arg(long, env = "SOTRAMA_DB_PORT", default_value_t = 3306)]
    port: u16,

    #[arg(long, env = "SOTRAMA_DB_USER", default_value = "sotrama_app")]
    user: String,

    #[arg(long, env = "SOTRAMA_DB_PASSWORD", hide_env_values = true)]
    password: String,

    #[arg(long, env = "SOTRAMA_DB_NAME", default_value = "sotrama")]
    database: String,

    #[arg(long, env = "SOTRAMA_COUNTRY_CODE", default_value = "-")]
    country_code: String,

    /// Create the named database if it does not exist (used only for explicit create).
    #[arg(long, env = "SOTRAMA_CREATE_DATABASE", default_value_t = false)]
    create_database: bool,

    /// Skip migration on connect.
    #[arg(long)]
    no_migrate: bool,

    #[arg(long, default_value = "info")]
    log_level: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("sotrama_backend={0}", args.log_level)));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .init();

    let config = MariaDBConfig {
        host: args.host,
        port: args.port,
        user: args.user,
        password: args.password,
        database: args.database,
    };

    match (&args.restore_backup, &args.restore_to) {
        (Some(backup), Some(target)) if !args.serve && !args.migrate => {
            database::backup::restore_to_new_database(&config, backup, target).await?;
            info!(
                target_database = target,
                "backup restore completed; verify and select the new database in the app"
            );
            return Ok(());
        }
        (Some(_), None) | (None, Some(_)) => {
            anyhow::bail!("--restore-backup and --restore-to must be supplied together");
        }
        (Some(_), Some(_)) => {
            anyhow::bail!("restore cannot be combined with --serve or --migrate");
        }
        (None, None) => {}
    }

    if args.migrate {
        return migrate_once(&config, &args.country_code).await;
    }

    if !args.serve {
        error!("nothing to do: pass --serve or --migrate");
        std::process::exit(2);
    }

    let db = Arc::new(
        Db::connect(
            &config,
            if args.country_code == "-" {
                ""
            } else {
                &args.country_code
            },
            args.create_database,
        )
        .await
        .with_context(|| format!("cannot reach MariaDB at {}:{}", config.host, config.port))?,
    );

    if !args.no_migrate {
        match db.migrate().await {
            Ok(report) => {
                if !report.errors.is_empty() {
                    let error_count = report.errors.len();
                    error!("migration reported {error_count} errors: {report:?}");
                    db.close().await;
                    anyhow::bail!("migration reported {error_count} errors; refusing to serve");
                }
                if report.changed() {
                    info!("migration applied: {report:?}");
                }
            }
            Err(e) => {
                // A failed migration must not leave the app running against a
                // half-built schema.
                error!("migration failed: {e}");
                std::process::exit(1);
            }
        }
    }

    info!("serving on stdio");
    ipc::IpcServer::new(db).serve().await?;
    Ok(())
}

async fn migrate_once(config: &MariaDBConfig, country_code: &str) -> Result<()> {
    let db = Db::connect(config, country_code, false).await?;
    let report = db.migrate().await?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    if report.errors.is_empty() {
        db.close().await;
        return Ok(());
    }
    db.close().await;
    anyhow::bail!("{} migration errors", report.errors.len())
}
