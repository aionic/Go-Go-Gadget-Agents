# =====================================================================
# Post-provision: build schema + seed sample data (Python via uv)
# =====================================================================

resource "null_resource" "postgres_seed" {
  count = var.run_postgres_seed ? 1 : 0

  triggers = {
    server      = module.postgres.fqdn
    database    = var.postgres_database_name
    schema_hash = filemd5("${path.module}/../../scripts/seed_postgres/schema.sql")
    seed_hash   = filemd5("${path.module}/../../scripts/seed_postgres/seed.py")
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../../scripts/seed_postgres"
    interpreter = ["pwsh", "-Command"]
    command     = "uv run seed.py"

    environment = {
      PGHOST          = module.postgres.fqdn
      PGDATABASE      = var.postgres_database_name
      PGUSER          = var.postgres_administrator_login
      PGPASSWORD      = random_password.postgres.result
      ENABLE_PGVECTOR = tostring(var.enable_pgvector)
    }
  }

  depends_on = [
    module.postgres,
    azurerm_key_vault_secret.postgres_password,
  ]
}
