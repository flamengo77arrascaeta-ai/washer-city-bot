const mysql = require('mysql2/promise');
const config = require('./config');

let pool = null;

function qi(value) {
  return `\`${value}\``;
}

async function initDb() {
  if (!config.dbEnabled) {
    console.warn('[DB] Desativado por DB_ENABLED=false.');
    return;
  }

  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 6,
    queueLimit: 0,
    charset: 'utf8mb4',
  });

  await pool.query('SELECT 1');

  const claims = qi(config.whitelist.claimsTable);
  await pool.query(`
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

  console.log('[DB] MySQL conectado.');
}

function ensureDb() {
  if (!config.dbEnabled) throw new Error('A whitelist está desativada no .env.');
  if (!pool) throw new Error('MySQL ainda não está conectado.');
}

function normalizeDiscord(value) {
  return String(value ?? '')
    .trim()
    .replace(/^discord:/i, '');
}

async function verifyIdOwner(conn, discordId, fivemId) {
  const w = config.whitelist;

  if (w.verifyMode === 'none') return true;

  if (w.verifyMode === 'identifier_table') {
    const table = qi(w.identifierTable);
    const userCol = qi(w.identifierUserIdColumn);
    const identCol = qi(w.identifierColumn);
    const wanted = `${w.discordPrefix}${discordId}`;

    const [rows] = await conn.execute(
      `SELECT ${userCol} AS user_id
       FROM ${table}
       WHERE ${userCol} = ? AND ${identCol} = ?
       LIMIT 1`,
      [fivemId, wanted]
    );

    return rows.length > 0;
  }

  const table = qi(w.table);
  const idCol = qi(w.idColumn);
  const discordCol = qi(w.discordColumn);

  const [rows] = await conn.execute(
    `SELECT ${discordCol} AS discord_value
     FROM ${table}
     WHERE ${idCol} = ?
     LIMIT 1`,
    [fivemId]
  );

  if (!rows.length) return false;
  return normalizeDiscord(rows[0].discord_value) === String(discordId);
}

async function claimWhitelist({ discordId, fivemId, rpName, releasedBy }) {
  ensureDb();

  const idText = String(fivemId).trim();
  if (!/^\d{1,12}$/.test(idText)) {
    throw new Error('ID inválido. Digite apenas números.');
  }

  const cleanName = String(rpName || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 60) {
    throw new Error('Nome inválido. Use entre 2 e 60 caracteres.');
  }

  const w = config.whitelist;
  const table = qi(w.table);
  const idCol = qi(w.idColumn);
  const statusCol = qi(w.statusColumn);
  const claims = qi(w.claimsTable);

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

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

    const [users] = await conn.execute(
      `SELECT ${idCol} AS player_id, ${statusCol} AS current_status
       FROM ${table}
       WHERE ${idCol} = ?
       LIMIT 1
       FOR UPDATE`,
      [idText]
    );

    if (!users.length) {
      throw new Error('Esse ID não existe no banco da cidade. Entre na cidade uma vez e tente novamente.');
    }

    const ownerOk = await verifyIdOwner(conn, discordId, idText);
    if (!ownerOk) {
      throw new Error('Esse ID não pertence ao seu Discord. Entre na cidade com este Discord conectado e tente novamente.');
    }

    await conn.execute(
      `UPDATE ${table} SET ${statusCol} = ? WHERE ${idCol} = ? LIMIT 1`,
      [w.statusValue, idText]
    );

    await conn.execute(
      `INSERT INTO ${claims} (discord_id, fivem_id, rp_name, released_by)
       VALUES (?, ?, ?, ?)`,
      [discordId, idText, cleanName, releasedBy]
    );

    await conn.commit();

    return {
      id: idText,
      name: cleanName,
      previousStatus: users[0].current_status,
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
  ensureDb();
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
  ensureDb();

  const w = config.whitelist;
  const claims = qi(w.claimsTable);
  const table = qi(w.table);
  const idCol = qi(w.idColumn);
  const statusCol = qi(w.statusColumn);

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
      await conn.execute(
        `UPDATE ${table} SET ${statusCol} = 0 WHERE ${idCol} = ? LIMIT 1`,
        [claim.fivem_id]
      );
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
