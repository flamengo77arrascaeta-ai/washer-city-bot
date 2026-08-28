const mysql = require('mysql2/promise');
const config = require('./config');

let pool = null;
let dbReady = false;
let claimsAvailable = false;
let activeSchema = null;

function qi(value) {
  return `\`${value}\``;
}

function createPool() {
  return mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 6,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
}

async function tableHasColumns(conn, table, columns) {
  try {
    const [rows] = await conn.query(`SHOW COLUMNS FROM ${qi(table)}`);
    const found = new Set(rows.map(row => String(row.Field).toLowerCase()));
    return columns.every(col => found.has(String(col).toLowerCase()));
  } catch {
    return false;
  }
}

async function resolveWhitelistSchema(conn) {
  const w = config.whitelist;
  const candidates = [
    { table: w.table, idColumn: w.idColumn, statusColumn: w.statusColumn },
    { table: 'vrp_users', idColumn: 'id', statusColumn: 'whitelisted' },
    { table: 'accounts', idColumn: 'id', statusColumn: 'Whitelist' },
    { table: 'accounts', idColumn: 'id', statusColumn: 'whitelist' },
    { table: 'accounts', idColumn: 'id', statusColumn: 'whitelisted' },
  ];

  const seen = new Set();

  for (const candidate of candidates) {
    const key = `${candidate.table}:${candidate.idColumn}:${candidate.statusColumn}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (await tableHasColumns(conn, candidate.table, [candidate.idColumn, candidate.statusColumn])) {
      return candidate;
    }
  }

  throw new Error(
    `Não achei a tabela de whitelist. Testei ${w.table}.${w.statusColumn}, vrp_users.whitelisted e accounts.Whitelist.`
  );
}

async function ensureClaimsTable(conn) {
  const claims = qi(config.whitelist.claimsTable);

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${claims} (
        discord_id VARCHAR(32) NOT NULL,
        fivem_id BIGINT NOT NULL,
        rp_name VARCHAR(100) NOT NULL,
        released_by VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (discord_id),
        UNIQUE KEY uq_fivem_id (fivem_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    claimsAvailable = true;
  } catch (error) {
    claimsAvailable = false;
    console.warn('[DB] Tabela de vínculos não pôde ser criada; whitelist continuará funcionando:', error.message);
  }
}

async function initDb() {
  if (!config.dbEnabled) {
    dbReady = false;
    console.warn('[DB] Desativado por DB_ENABLED=false.');
    return false;
  }

  if (!pool) pool = createPool();

  try {
    const conn = await pool.getConnection();
    try {
      await conn.query('SELECT 1');
      activeSchema = await resolveWhitelistSchema(conn);
      await ensureClaimsTable(conn);
      dbReady = true;
      console.log(`[DB] MySQL conectado. Whitelist: ${activeSchema.table}.${activeSchema.statusColumn}`);
      return true;
    } finally {
      conn.release();
    }
  } catch (error) {
    dbReady = false;
    throw error;
  }
}

async function ensureDb() {
  if (!config.dbEnabled) {
    throw new Error('A whitelist está desativada.');
  }

  if (!dbReady) {
    try {
      await initDb();
    } catch {
      throw new Error('Banco de dados indisponível. Verifique host, porta, usuário e senha do MySQL.');
    }
  }
}

function normalizeDiscord(value) {
  return String(value ?? '')
    .trim()
    .replace(/^discord:/i, '');
}

function isAccountsSchema() {
  return String(activeSchema?.table || '').toLowerCase() === 'accounts';
}

async function resolveWhitelistTarget(conn, cityId, forUpdate = false) {
  const schema = activeSchema;
  const table = qi(schema.table);
  const idCol = qi(schema.idColumn);
  const statusCol = qi(schema.statusColumn);
  const lock = forUpdate ? ' FOR UPDATE' : '';

  // Creative/Washer: o ID mostrado no jogo vem de characters.id.
  // A whitelist fica em accounts e as duas tabelas são ligadas por License.
  if (isAccountsSchema() && await tableHasColumns(conn, 'characters', ['id', 'License'])) {
    const [characters] = await conn.execute(
      `SELECT id AS city_id, License AS license
       FROM ${qi('characters')}
       WHERE id = ?
       LIMIT 1${lock}`,
      [cityId]
    );

    if (!characters.length) return null;

    const license = characters[0].license;
    const [accounts] = await conn.execute(
      `SELECT ${idCol} AS database_id, ${statusCol} AS current_status
       FROM ${table}
       WHERE ${qi('License')} = ?
       LIMIT 1${lock}`,
      [license]
    );

    if (!accounts.length) return null;

    return {
      cityId: String(cityId),
      databaseId: accounts[0].database_id,
      currentStatus: accounts[0].current_status,
      license,
    };
  }

  const [users] = await conn.execute(
    `SELECT ${idCol} AS database_id, ${statusCol} AS current_status
     FROM ${table}
     WHERE ${idCol} = ?
     LIMIT 1${lock}`,
    [cityId]
  );

  if (!users.length) return null;

  return {
    cityId: String(cityId),
    databaseId: users[0].database_id,
    currentStatus: users[0].current_status,
    license: null,
  };
}

async function verifyIdOwner(conn, discordId, cityId, databaseId) {
  const w = config.whitelist;

  if (w.verifyMode === 'none') return true;

  if (w.verifyMode === 'identifier_table') {
    const exists = await tableHasColumns(
      conn,
      w.identifierTable,
      [w.identifierUserIdColumn, w.identifierColumn]
    );

    if (!exists) {
      console.warn('[DB] Tabela de identificadores não encontrada; validação por Discord ignorada.');
      return true;
    }

    const table = qi(w.identifierTable);
    const userCol = qi(w.identifierUserIdColumn);
    const identCol = qi(w.identifierColumn);
    const wanted = `${w.discordPrefix}${discordId}`;

    const [rows] = await conn.execute(
      `SELECT ${userCol} AS user_id
       FROM ${table}
       WHERE ${userCol} = ? AND ${identCol} = ?
       LIMIT 1`,
      [cityId, wanted]
    );

    return rows.length > 0;
  }

  const schema = activeSchema;
  const table = qi(schema.table);
  const idCol = qi(schema.idColumn);
  const discordCol = qi(w.discordColumn);

  const hasDiscord = await tableHasColumns(conn, schema.table, [w.discordColumn]);
  if (!hasDiscord) {
    console.warn('[DB] Coluna Discord não encontrada; validação por Discord ignorada.');
    return true;
  }

  const [rows] = await conn.execute(
    `SELECT ${discordCol} AS discord_value
     FROM ${table}
     WHERE ${idCol} = ?
     LIMIT 1`,
    [databaseId]
  );

  if (!rows.length) return false;
  return normalizeDiscord(rows[0].discord_value) === String(discordId);
}

async function claimWhitelist({ discordId, fivemId, rpName, releasedBy }) {
  await ensureDb();

  const idText = String(fivemId).trim();
  if (!/^\d{1,12}$/.test(idText)) {
    throw new Error('ID inválido. Digite apenas números.');
  }

  const cleanName = String(rpName || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 60) {
    throw new Error('Nome inválido. Use entre 2 e 60 caracteres.');
  }

  const schema = activeSchema;
  const table = qi(schema.table);
  const idCol = qi(schema.idColumn);
  const statusCol = qi(schema.statusColumn);
  const claims = qi(config.whitelist.claimsTable);

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    if (claimsAvailable) {
      const [byDiscord] = await conn.execute(
        `SELECT fivem_id FROM ${claims} WHERE discord_id = ? LIMIT 1 FOR UPDATE`,
        [discordId]
      );

      if (byDiscord.length) {
        throw new Error(`Seu Discord já está vinculado ao ID ${byDiscord[0].fivem_id}.`);
      }

      const [byId] = await conn.execute(
        `SELECT discord_id FROM ${claims} WHERE fivem_id = ? LIMIT 1 FOR UPDATE`,
        [idText]
      );

      if (byId.length) {
        throw new Error('Esse ID já foi liberado por outra conta do Discord.');
      }
    }

    const target = await resolveWhitelistTarget(conn, idText, true);

    if (!target) {
      throw new Error('Esse ID não existe no banco da cidade. Entre na cidade uma vez e tente novamente.');
    }

    const ownerOk = await verifyIdOwner(conn, discordId, idText, target.databaseId);
    if (!ownerOk) {
      throw new Error('Esse ID não pertence ao seu Discord.');
    }

    await conn.execute(
      `UPDATE ${table} SET ${statusCol} = ? WHERE ${idCol} = ? LIMIT 1`,
      [config.whitelist.statusValue, target.databaseId]
    );

    if (claimsAvailable) {
      await conn.execute(
        `INSERT INTO ${claims} (discord_id, fivem_id, rp_name, released_by)
         VALUES (?, ?, ?, ?)`,
        [discordId, idText, cleanName, releasedBy]
      );
    }

    await conn.commit();

    return {
      id: idText,
      name: cleanName,
      previousStatus: target.currentStatus,
      releasedBy,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function getClaimByDiscord(discordId) {
  await ensureDb();
  if (!claimsAvailable) return null;

  const claims = qi(config.whitelist.claimsTable);
  const [rows] = await pool.execute(
    `SELECT discord_id, fivem_id, rp_name, released_by, created_at
     FROM ${claims}
     WHERE discord_id = ?
     LIMIT 1`,
    [discordId]
  );
  return rows[0] || null;
}

async function unlinkWhitelist(discordId, revertWhitelist = false) {
  await ensureDb();

  if (!claimsAvailable) {
    throw new Error('A tabela de vínculos não está disponível para desvincular automaticamente.');
  }

  const claims = qi(config.whitelist.claimsTable);
  const schema = activeSchema;
  const table = qi(schema.table);
  const idCol = qi(schema.idColumn);
  const statusCol = qi(schema.statusColumn);

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT discord_id, fivem_id, rp_name, released_by
       FROM ${claims}
       WHERE discord_id = ?
       LIMIT 1
       FOR UPDATE`,
      [discordId]
    );

    if (!rows.length) {
      throw new Error('Esse usuário não possui ID vinculado pelo bot.');
    }

    const claim = rows[0];

    if (revertWhitelist) {
      const target = await resolveWhitelistTarget(conn, String(claim.fivem_id), true);
      if (target) {
        await conn.execute(
          `UPDATE ${table} SET ${statusCol} = 0 WHERE ${idCol} = ? LIMIT 1`,
          [target.databaseId]
        );
      }
    }

    await conn.execute(
      `DELETE FROM ${claims} WHERE discord_id = ? LIMIT 1`,
      [discordId]
    );

    await conn.commit();
    return claim;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  initDb,
  claimWhitelist,
  getClaimByDiscord,
  unlinkWhitelist,
};
