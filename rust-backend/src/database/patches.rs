//! Port of the ordered `backend/patches` registry. Patch names, target versions,
//! pre/post-migration placement, and priority intentionally mirror patches/index.ts.

use sqlx::{MySqlConnection, Row};
use tracing::warn;

use crate::database::crud;
use crate::database::MigrationReport;
use crate::error::{BackendError, DbError};

#[derive(Clone, Copy)]
struct Patch {
    name: &'static str,
    version: &'static str,
    before_migrate: bool,
    priority: i32,
}

const PATCHES: [Patch; 9] = [
    Patch {
        name: "testPatch",
        version: "0.5.0-beta.0",
        before_migrate: true,
        priority: 0,
    },
    Patch {
        name: "updateSchemas",
        version: "0.5.0-beta.0",
        before_migrate: true,
        priority: 100,
    },
    Patch {
        name: "addUOMs",
        version: "0.6.0-beta.0",
        before_migrate: false,
        priority: 0,
    },
    Patch {
        name: "fixRoundOffAccount",
        version: "0.6.3-beta.0",
        before_migrate: true,
        priority: 0,
    },
    Patch {
        name: "createInventoryNumberSeries",
        version: "0.6.6-beta.0",
        before_migrate: true,
        priority: 0,
    },
    Patch {
        name: "setPaymentReferenceType",
        version: "0.20.1",
        before_migrate: true,
        priority: 0,
    },
    Patch {
        name: "fixLedgerDateTime",
        version: "0.21.2",
        before_migrate: true,
        priority: 0,
    },
    Patch {
        name: "fixItemHSNField",
        version: "0.24.0",
        before_migrate: true,
        priority: 0,
    },
    Patch {
        name: "createPaymentMethods",
        version: "0.25.1",
        before_migrate: false,
        priority: 0,
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    BeforeMigrate,
    AfterMigrate,
}

/// Whether this app version has patch work pending, used to decide whether a
/// populated database needs a backup before any schema or patch writes.
pub async fn has_pending(
    conn: &mut MySqlConnection,
    app_version: &str,
) -> Result<bool, BackendError> {
    if !crud::table_exists(conn, "PatchRun").await? {
        return Ok(PATCHES
            .iter()
            .any(|patch| version_lte(app_version, patch.version)));
    }
    let rows = sqlx::query("SELECT `name`, `failed` FROM `patchrun`")
        .fetch_all(&mut *conn)
        .await
        .map_err(crud::db_err)?;
    let mut previous = std::collections::HashMap::new();
    for row in rows {
        let name: String = row.try_get("name").map_err(decode_err)?;
        let failed: bool = row.try_get("failed").map_err(decode_err)?;
        previous.insert(name, failed);
    }
    Ok(PATCHES.iter().any(|patch| match previous.get(patch.name) {
        Some(failed) => *failed,
        None => version_lte(app_version, patch.version),
    }))
}

/// Run due patches in the exact priority/order contract of the TypeScript registry.
/// A failed patch is recorded and stops the migration; continuing could expose a
/// half-upgraded database to other LAN clients.
pub async fn run_phase(
    conn: &mut MySqlConnection,
    app_version: &str,
    phase: Phase,
    report: &mut MigrationReport,
) -> Result<(), BackendError> {
    if !crud::table_exists(conn, "PatchRun").await? {
        return Ok(());
    }

    let rows = sqlx::query("SELECT `name`, `version`, `failed` FROM `patchrun`")
        .fetch_all(&mut *conn)
        .await
        .map_err(crud::db_err)?;
    let mut previous = std::collections::HashMap::new();
    for row in rows {
        let name: String = row.try_get("name").map_err(decode_err)?;
        let version: Option<String> = row.try_get("version").map_err(decode_err)?;
        let failed: bool = row.try_get("failed").map_err(decode_err)?;
        previous.insert(name, (version.unwrap_or_default(), failed));
    }

    let mut due: Vec<Patch> = PATCHES
        .iter()
        .copied()
        .filter(|patch| patch.before_migrate == (phase == Phase::BeforeMigrate))
        .filter(|patch| match previous.get(patch.name) {
            None => version_lte(app_version, patch.version),
            // Retry recorded failures on the next startup. Mutating patches are
            // guarded so an interrupted run does not duplicate seeded records.
            Some((_, failed)) => *failed,
        })
        .collect();
    // Stable sort preserves patches/index.ts order when priorities are equal.
    due.sort_by(|a, b| b.priority.cmp(&a.priority));

    for patch in due {
        let result = execute(patch.name, conn).await;
        record_result(conn, patch, app_version, result.is_err()).await?;
        match result {
            Ok(()) => report.patches_run.push(patch.name.to_string()),
            Err(error) => {
                warn!(patch = patch.name, %error, "database patch failed; refusing to continue migration");
                return Err(BackendError::Db(DbError::new(format!(
                    "Patch Failed: {}: {}. The patch failure was recorded; do not use this database until the migration is repaired.",
                    patch.name, error
                ))));
            }
        }
    }
    Ok(())
}

async fn execute(name: &str, conn: &mut MySqlConnection) -> Result<(), BackendError> {
    match name {
        "testPatch" => Ok(()),
        "updateSchemas" => update_schemas(conn).await,
        "addUOMs" => add_uoms(conn).await,
        "fixRoundOffAccount" => fix_round_off_account(conn).await,
        "createInventoryNumberSeries" => create_inventory_number_series(conn).await,
        "setPaymentReferenceType" => set_payment_reference_type(conn).await,
        "fixLedgerDateTime" => fix_ledger_datetime(conn).await,
        "fixItemHSNField" => fix_item_hsn_field(conn).await,
        "createPaymentMethods" => create_payment_methods(conn).await,
        _ => Err(BackendError::InvalidArgument(format!(
            "unknown migration patch: {name}"
        ))),
    }
}

async fn record_result(
    conn: &mut MySqlConnection,
    patch: Patch,
    app_version: &str,
    failed: bool,
) -> Result<(), BackendError> {
    sqlx::query(
        "INSERT INTO `patchrun` (`name`, `failed`, `version`, `createdBy`, `modifiedBy`, `created`, `modified`) \
         VALUES (?, ?, ?, '__SYSTEM__', '__SYSTEM__', NOW(6), NOW(6)) \
         ON DUPLICATE KEY UPDATE `failed` = VALUES(`failed`), `version` = VALUES(`version`), `modified` = NOW(6), `modifiedBy` = '__SYSTEM__'",
    )
    .bind(patch.name)
    .bind(failed)
    .bind(app_version)
    .execute(&mut *conn)
    .await
    .map_err(crud::db_err)?;
    Ok(())
}

async fn update_schemas(conn: &mut MySqlConnection) -> Result<(), BackendError> {
    let current = sqlx::query_scalar::<_, String>(
        "SELECT `value` FROM `singlevalue` WHERE `fieldname` = 'version' AND `parent` = 'SystemSettings' LIMIT 1",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(|error| {
        let db_error = DbError::from(error);
        BackendError::from(db_error)
    })?;
    if current
        .as_deref()
        .is_some_and(|v| !version_lte(v, "0.4.3-beta.0"))
    {
        return Ok(());
    }

    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM `singlevalue` WHERE `fieldname` = 'version' AND `parent` = 'SystemSettings' LIMIT 1",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(crud::db_err)?
    .is_some();
    if exists {
        sqlx::query("UPDATE `singlevalue` SET `value` = '0.5.0-beta.0', `modified` = NOW(6), `modifiedBy` = '__SYSTEM__' WHERE `fieldname` = 'version' AND `parent` = 'SystemSettings'")
            .execute(&mut *conn).await.map_err(crud::db_err)?;
    } else {
        sqlx::query("INSERT INTO `singlevalue` (`name`, `parent`, `fieldname`, `value`, `createdBy`, `modifiedBy`, `created`, `modified`) VALUES (?, 'SystemSettings', 'version', '0.5.0-beta.0', '__SYSTEM__', '__SYSTEM__', NOW(6), NOW(6))")
            .bind(crud::random_name()).execute(&mut *conn).await.map_err(crud::db_err)?;
    }
    Ok(())
}

async fn add_uoms(conn: &mut MySqlConnection) -> Result<(), BackendError> {
    for (name, whole) in [
        ("Unit", true),
        ("Kg", false),
        ("Gram", false),
        ("Meter", false),
        ("Hour", false),
        ("Day", false),
    ] {
        let exists = sqlx::query("SELECT 1 FROM `uom` WHERE `name` = ? LIMIT 1")
            .bind(name)
            .fetch_optional(&mut *conn)
            .await
            .map_err(crud::db_err)?
            .is_some();
        if exists {
            continue;
        }
        sqlx::query("INSERT INTO `uom` (`name`, `isWhole`, `createdBy`, `modifiedBy`, `created`, `modified`) VALUES (?, ?, '__SYSTEM__', '__SYSTEM__', NOW(6), NOW(6))")
            .bind(name).bind(whole).execute(&mut *conn).await.map_err(crud::db_err)?;
    }
    Ok(())
}

async fn fix_round_off_account(conn: &mut MySqlConnection) -> Result<(), BackendError> {
    let values = sqlx::query(
        "SELECT `parent`, `value` FROM `singlevalue` WHERE `fieldname` = 'roundOffAccount'",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(crud::db_err)?;
    let mut selected: Option<String> = None;
    for row in values {
        let parent: String = row.try_get("parent").map_err(decode_err)?;
        let value: Option<String> = row.try_get("value").map_err(decode_err)?;
        if parent == "AccountingSettings" {
            selected = value;
            break;
        }
    }
    sqlx::query("DELETE FROM `singlevalue` WHERE `parent` = 'AccountingSettings' AND `fieldname` = 'roundOffAccount'")
        .execute(&mut *conn).await.map_err(crud::db_err)?;

    for candidate in selected
        .into_iter()
        .chain(["Round Off".to_string(), "Rounded Off".to_string()])
    {
        let exists = sqlx::query("SELECT 1 FROM `account` WHERE `name` = ? LIMIT 1")
            .bind(&candidate)
            .fetch_optional(&mut *conn)
            .await
            .map_err(crud::db_err)?
            .is_some();
        if exists {
            sqlx::query("INSERT INTO `singlevalue` (`name`, `parent`, `fieldname`, `value`, `createdBy`, `modifiedBy`, `created`, `modified`) VALUES (?, 'AccountingSettings', 'roundOffAccount', ?, '__SYSTEM__', '__SYSTEM__', NOW(6), NOW(6))")
                .bind(crud::random_name()).bind(candidate).execute(&mut *conn).await.map_err(crud::db_err)?;
            break;
        }
    }
    Ok(())
}

async fn create_inventory_number_series(conn: &mut MySqlConnection) -> Result<(), BackendError> {
    let setup_complete = sqlx::query_scalar::<_, String>(
        "SELECT `value` FROM `singlevalue` WHERE `fieldname` = 'setupComplete' LIMIT 1",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(crud::db_err)?;
    if !setup_complete
        .as_deref()
        .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    {
        return Ok(());
    }
    for (prefix, reference_type) in [
        ("SMOV-", "StockMovement"),
        ("PREC-", "PurchaseReceipt"),
        ("SHPM-", "Shipment"),
    ] {
        let exists = sqlx::query("SELECT 1 FROM `numberseries` WHERE `name` = ? LIMIT 1")
            .bind(prefix)
            .fetch_optional(&mut *conn)
            .await
            .map_err(crud::db_err)?
            .is_some();
        if !exists {
            sqlx::query("INSERT INTO `numberseries` (`name`, `start`, `padZeros`, `current`, `referenceType`, `createdBy`, `modifiedBy`, `created`, `modified`) VALUES (?, 1001, 4, 0, ?, '__SYSTEM__', '__SYSTEM__', NOW(6), NOW(6))")
                .bind(prefix).bind(reference_type).execute(&mut *conn).await.map_err(crud::db_err)?;
        }
    }
    Ok(())
}

async fn set_payment_reference_type(conn: &mut MySqlConnection) -> Result<(), BackendError> {
    sqlx::query("UPDATE `payment` SET `referenceType` = 'PurchaseInvoice' WHERE `referenceType` IS NULL AND `paymentType` = 'Pay'")
        .execute(&mut *conn).await.map_err(crud::db_err)?;
    sqlx::query("UPDATE `payment` SET `referenceType` = 'SalesInvoice' WHERE `referenceType` IS NULL AND `paymentType` = 'Receive'")
        .execute(&mut *conn).await.map_err(crud::db_err)?;
    Ok(())
}

async fn fix_ledger_datetime(conn: &mut MySqlConnection) -> Result<(), BackendError> {
    for table in [
        "purchaseinvoice",
        "salesinvoice",
        "journalentry",
        "payment",
        "stockmovement",
        "stocktransfer",
    ] {
        let sql = format!("UPDATE `accountingledgerentry` AS ledger JOIN `{table}` AS source ON source.`name` = ledger.`referenceName` SET ledger.`date` = source.`date`");
        sqlx::query(&sql)
            .execute(&mut *conn)
            .await
            .map_err(crud::db_err)?;
    }
    Ok(())
}

async fn fix_item_hsn_field(conn: &mut MySqlConnection) -> Result<(), BackendError> {
    let has_table = crud::table_exists(conn, "Item").await?;
    if !has_table {
        return Ok(());
    }
    let columns = crud::existing_columns(conn, "Item").await?;
    if columns
        .iter()
        .any(|column| column.name.eq_ignore_ascii_case("hsnCode"))
    {
        sqlx::query("ALTER TABLE `item` MODIFY COLUMN `hsnCode` TEXT")
            .execute(&mut *conn)
            .await
            .map_err(crud::db_err)?;
    }
    Ok(())
}

async fn create_payment_methods(conn: &mut MySqlConnection) -> Result<(), BackendError> {
    let rows = sqlx::query("SELECT `name`, `accountType` FROM `account` ORDER BY `created` DESC")
        .fetch_all(&mut *conn)
        .await
        .map_err(crud::db_err)?;
    let mut cash_account = None;
    let mut bank_account = None;
    for row in rows {
        let name: String = row.try_get("name").map_err(decode_err)?;
        let account_type: Option<String> = row.try_get("accountType").map_err(decode_err)?;
        match account_type.as_deref() {
            Some("Cash") if cash_account.is_none() => cash_account = Some(name),
            Some("Bank") if bank_account.is_none() => bank_account = Some(name),
            _ => {}
        }
    }
    for (name, kind, account) in [
        ("Cash", "Cash", cash_account),
        ("Bank", "Bank", bank_account.clone()),
        ("Transfer", "Bank", bank_account),
    ] {
        let exists = sqlx::query("SELECT 1 FROM `paymentmethod` WHERE `name` = ? LIMIT 1")
            .bind(name)
            .fetch_optional(&mut *conn)
            .await
            .map_err(crud::db_err)?
            .is_some();
        if exists {
            continue;
        }
        sqlx::query("INSERT INTO `paymentmethod` (`name`, `type`, `account`, `createdBy`, `modifiedBy`, `created`, `modified`) VALUES (?, ?, ?, '__SYSTEM__', '__SYSTEM__', NOW(6), NOW(6))")
            .bind(name).bind(kind).bind(account).execute(&mut *conn).await.map_err(crud::db_err)?;
    }
    Ok(())
}

fn decode_err(error: sqlx::Error) -> BackendError {
    BackendError::from(DbError::from(error))
}

/// Semver comparison for the stable numeric versions and beta tags used by the
/// legacy patch registry. Release versions sort after their prerelease tags.
fn version_lte(left: &str, right: &str) -> bool {
    compare_versions(left, right) != std::cmp::Ordering::Greater
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (left_core, left_pre) = left
        .split_once('-')
        .map_or((left, None), |(a, b)| (a, Some(b)));
    let (right_core, right_pre) = right
        .split_once('-')
        .map_or((right, None), |(a, b)| (a, Some(b)));
    let left_numbers: Vec<u64> = left_core
        .split('.')
        .map(|s| s.parse().unwrap_or(0))
        .collect();
    let right_numbers: Vec<u64> = right_core
        .split('.')
        .map(|s| s.parse().unwrap_or(0))
        .collect();
    for index in 0..left_numbers.len().max(right_numbers.len()) {
        match left_numbers
            .get(index)
            .copied()
            .unwrap_or(0)
            .cmp(&right_numbers.get(index).copied().unwrap_or(0))
        {
            Ordering::Equal => continue,
            ordering => return ordering,
        }
    }
    match (left_pre, right_pre) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(a), Some(b)) => {
            let a: Vec<&str> = a.split('.').collect();
            let b: Vec<&str> = b.split('.').collect();
            for index in 0..a.len().max(b.len()) {
                match (a.get(index), b.get(index)) {
                    (None, None) => return Ordering::Equal,
                    (None, Some(_)) => return Ordering::Less,
                    (Some(_), None) => return Ordering::Greater,
                    (Some(x), Some(y)) => {
                        let order = match (x.parse::<u64>(), y.parse::<u64>()) {
                            (Ok(x), Ok(y)) => x.cmp(&y),
                            (Ok(_), Err(_)) => Ordering::Less,
                            (Err(_), Ok(_)) => Ordering::Greater,
                            (Err(_), Err(_)) => x.cmp(y),
                        };
                        if order != Ordering::Equal {
                            return order;
                        }
                    }
                }
            }
            Ordering::Equal
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn legacy_patch_registry_has_nine_entries_and_expected_order() {
        assert_eq!(PATCHES.len(), 9);
        let mut ordered = PATCHES.to_vec();
        ordered.sort_by(|a, b| b.priority.cmp(&a.priority));
        assert_eq!(ordered[0].name, "updateSchemas");
        assert_eq!(PATCHES.iter().filter(|p| p.before_migrate).count(), 7);
    }

    #[test]
    fn version_comparison_handles_beta_and_release_versions() {
        assert!(version_lte("0.4.3-beta.0", "0.5.0-beta.0"));
        assert!(version_lte("0.5.0-beta.0", "0.5.0-beta.0"));
        assert!(!version_lte("0.5.0", "0.5.0-beta.0"));
        assert_eq!(compare_versions("0.20.1", "0.21.2"), Ordering::Less);
        assert_eq!(
            compare_versions("0.5.0-beta.2", "0.5.0-beta.10"),
            Ordering::Less
        );
        assert_eq!(compare_versions("0.5.0-beta.10", "0.5.0"), Ordering::Less);
    }

    #[test]
    fn patch_registry_keeps_legacy_phase_and_priority_contract() {
        let before: Vec<_> = PATCHES
            .iter()
            .filter(|patch| patch.before_migrate)
            .map(|patch| patch.name)
            .collect();
        let after: Vec<_> = PATCHES
            .iter()
            .filter(|patch| !patch.before_migrate)
            .map(|patch| patch.name)
            .collect();

        assert_eq!(before.len(), 7);
        assert_eq!(before[0], "testPatch");
        assert_eq!(before[1], "updateSchemas");
        assert_eq!(after, ["addUOMs", "createPaymentMethods"]);
        assert_eq!(
            PATCHES
                .iter()
                .find(|p| p.name == "updateSchemas")
                .unwrap()
                .priority,
            100
        );
    }
}
