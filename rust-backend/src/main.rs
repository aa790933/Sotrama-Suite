//! One process, two jobs: migrate a database or serve IPC to the Electron main process.
//! Credentials are read from SOTRAMA_* environment variables so they stay out of argv.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use clap::Parser;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

mod api;
mod database;
mod error;
mod ipc;
mod schemas;
mod templates;
mod translations;
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

    /// Serve bounded HTTPS integration requests over stdin/stdout without a database.
    #[arg(long)]
    serve_api: bool,

    /// Connect, migrate, print the report, exit. Safe to run repeatedly.
    #[arg(long)]
    migrate: bool,

    /// Restore a verified Rust backup into a brand-new database (never overwrite).
    #[arg(long, value_name = "SQL_FILE")]
    restore_backup: Option<PathBuf>,

    /// New database name for --restore-backup. Existing databases are refused.
    #[arg(long, value_name = "DATABASE")]
    restore_to: Option<String>,

    /// Load a bundled language map as JSON without opening a database.
    #[arg(long, value_name = "CODE")]
    language_map: Option<String>,

    /// Directory containing translation CSV files for --language-map.
    #[arg(long, value_name = "DIR")]
    translations_dir: Option<PathBuf>,

    /// Load print templates as JSON without opening a database.
    #[arg(long)]
    print_templates: bool,

    /// Directory containing print template files for --print-templates.
    #[arg(long, value_name = "DIR")]
    templates_dir: Option<PathBuf>,

    /// POS template width in points for --print-templates.
    #[arg(long, value_name = "WIDTH")]
    pos_template_width: Option<f64>,

    #[arg(long, env = "SOTRAMA_DB_HOST", default_value = "localhost")]
    host: String,

    #[arg(long, env = "SOTRAMA_DB_PORT", default_value_t = 3306)]
    port: u16,

    #[arg(long, env = "SOTRAMA_DB_USER", default_value = "sotrama_app")]
    user: String,

    #[arg(long, env = "SOTRAMA_DB_PASSWORD", hide_env_values = true)]
    password: Option<String>,

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

    if let Some(code) = args.language_map.as_deref() {
        if args.serve
            || args.serve_api
            || args.migrate
            || args.restore_backup.is_some()
            || args.restore_to.is_some()
            || args.print_templates
            || args.templates_dir.is_some()
            || args.pos_template_width.is_some()
        {
            anyhow::bail!("--language-map cannot be combined with another operation");
        }
        let directory = args
            .translations_dir
            .as_deref()
            .context("--translations-dir is required with --language-map")?;
        let language_map = translations::load_language_map(directory, code)?;
        println!("{}", serde_json::to_string(&language_map)?);
        return Ok(());
    }

    if args.print_templates {
        if args.serve
            || args.serve_api
            || args.migrate
            || args.restore_backup.is_some()
            || args.restore_to.is_some()
            || args.translations_dir.is_some()
        {
            anyhow::bail!("--print-templates cannot be combined with another operation");
        }
        if args
            .pos_template_width
            .is_some_and(|width| !width.is_finite())
        {
            anyhow::bail!("--pos-template-width must be finite");
        }
        let directory = args
            .templates_dir
            .as_deref()
            .context("--templates-dir is required with --print-templates")?;
        let templates = templates::load_templates(directory, args.pos_template_width)?;
        println!("{}", serde_json::to_string(&templates)?);
        return Ok(());
    }

    if args.serve_api {
        if args.serve
            || args.migrate
            || args.restore_backup.is_some()
            || args.restore_to.is_some()
            || args.language_map.is_some()
            || args.print_templates
            || args.translations_dir.is_some()
            || args.templates_dir.is_some()
            || args.pos_template_width.is_some()
        {
            anyhow::bail!("--serve-api cannot be combined with another operation");
        }
        return api::serve().await.map_err(Into::into);
    }

    if args.translations_dir.is_some()
        || args.templates_dir.is_some()
        || args.pos_template_width.is_some()
    {
        anyhow::bail!("resource options require --language-map or --print-templates");
    }

    let config = MariaDBConfig {
        host: args.host,
        port: args.port,
        user: args.user,
        password: args
            .password
            .context("SOTRAMA_DB_PASSWORD is required for database operations")?,
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

    info!("serving on stdio; Ctrl-C requests graceful shutdown");
    tokio::select! {
        result = ipc::IpcServer::new(db.clone()).serve() => result?,
        signal = tokio::signal::ctrl_c() => {
            match signal {
                Ok(()) => info!("shutdown signal received; closing database pool"),
                Err(error) => {
                    db.close().await;
                    return Err(error.into());
                }
            }
            db.close().await;
        }
    }
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
