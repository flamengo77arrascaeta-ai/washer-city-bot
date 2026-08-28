const mysql = require('mysql2/promise');
const config = require('./config');

let pool = null;
let dbReady = false;
let claimsAvailable = false;

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

async function ensureClaimsTable(conn) {
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS washer_bot_whitelist_claims (
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
    console.warn('[DB] Tabela de vinculos indisponivel:', error.message);
  }
}

async function initDb() {
  if (!config.dbEnabled) {
    dbReady = false;
    console.warn('[DB] Desativado por DB_ENABLED=false.');
    return false;
  }

  if (!pool) pool = createPool();

  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
    await ensureClaimsTable(conn);
    dbReady = true;
    console.log('[DB] MySQL conectado. Whitelist: accounts.Whitelist via characters.License');
    return true;
  } finally {
    conn.release();
  }
}

async function ensureDb() {
  if (!config.dbEnabled) throw new Error('A whitelist esta desativada.');
  if (!dbReady) {
    try {
      await initDb();
    } catch {
      throw new Error('Banco de dados indisponivel. Verifique host, porta, usuario e senha do MySQL.');
    }
  }
}

async function getCharacterById(conn, cityId, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [rows] = await conn.execute(
    `SELECT id, License, Name, Lastname
     FROM characters
     WHERE id = ? AND (Deleted = 0 OR Deleted IS NULL)
     LIMIT 1${suffix}`,
    [cityId]
  );
  return rows[0] || null;
}

async function claimWhitelist({ discordId, fivemId, rpName, releasedBy }) {
  await ensureDb();

  const idText = String(fivemId).trim();
  if (!/^\d{1,12}$/.test(idText)) {
    throw new Error('ID invalido. Digite apenas numeros.');
  }

  const cleanName = String(rpName || '').trim().replace(/\s+/g, ' ');
  if (cleanName.length < 2 || cleanName.length > 60) {
    throw new Error('Nome invalido. Use entre 2 e 60 caracteres.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const character = await getCharacterById(conn, idText, true);
    if (!character?.License) {
      throw new Error('Esse ID nao existe no banco da cidade. Entre na cidade uma vez e tente novamente.');
    }

    const [accounts] = await conn.execute(
      `SELECT id, Whitelist
       FROM accounts
       WHERE License = ?
       FOR UPDATE`,
      [character.License]
    );

    if (!accounts.length) {
      throw new Error('A conta desse ID nao foi encontrada na tabela accounts.');
    }

    let existingDiscord = null;
    let existingId = null;

    if (claimsAvailable) {
      const [byDiscord] = await conn.execute(
        `SELECT discord_id, fivem_id FROM washer_bot_whitelist_claims
         WHERE discord_id = ? LIMIT 1 FOR UPDATE`,
        [discordId]
      );
      existingDiscord = byDiscord[0] || null;

      if (existingDiscord && String(existingDiscord.fivem_id) !== idText) {
        throw new Error(`Seu Discord ja esta vinculado ao ID ${existingDiscord.fivem_id}. Use /desvincularid primeiro.`);
      }

      const [byId] = await conn.execute(
        `SELECT discord_id, fivem_id FROM washer_bot_whitelist_claims
         WHERE fivem_id = ? LIMIT 1 FOR UPDATE`,
        [idText]
      );
      existingId = byId[0] || null;

      if (existingId && String(existingId.discord_id) !== String(discordId)) {
        throw new Error('Esse ID ja foi liberado por outra conta do Discord.');
      }
    }

    // IMPORTANTE: atualiza TODAS as linhas de accounts com a mesma License.
    // Isso evita uma linha antiga/duplicada continuar com Whitelist = 0.
    await conn.execute(
      `UPDATE accounts SET Whitelist = 1 WHERE License = ?`,
      [character.License]
    );

    if (claimsAvailable) {
      if (!existingDiscord && !existingId) {
        await conn.execute(
          `INSERT INTO washer_bot_whitelist_claims
           (discord_id, fivem_id, rp_name, released_by)
           VALUES (?, ?, ?, ?)`,
          [discordId, idText, cleanName, releasedBy]
        );
      } else {
        await conn.execute(
          `UPDATE washer_bot_whitelist_claims
           SET rp_name = ?, released_by = ?
           WHERE discord_id = ? AND fivem_id = ?`,
          [cleanName, releasedBy, discordId, idText]
        );
      }
    }

    await conn.commit();

    return {
      id: idText,
      name: cleanName,
      previousStatus: accounts.some(a => Number(a.Whitelist) === 1) ? 1 : 0,
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

  const [rows] = await pool.execute(
    `SELECT discord_id, fivem_id, rp_name, released_by, created_at
     FROM washer_bot_whitelist_claims
     WHERE discord_id = ? LIMIT 1`,
    [discordId]
  );
  return rows[0] || null;
}

async function unlinkWhitelist(discordId, revertWhitelist = false) {
  await ensureDb();
  if (!claimsAvailable) {
    throw new Error('A tabela de vinculos nao esta disponivel.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT discord_id, fivem_id, rp_name, released_by
       FROM washer_bot_whitelist_claims
       WHERE discord_id = ? LIMIT 1 FOR UPDATE`,
      [discordId]
    );

    if (!rows.length) {
      throw new Error('Esse usuario nao possui ID vinculado pelo bot.');
    }

    const claim = rows[0];

    if (revertWhitelist) {
      const character = await getCharacterById(conn, String(claim.fivem_id), true);
      if (character?.License) {
        await conn.execute(
          `UPDATE accounts SET Whitelist = 0 WHERE License = ?`,
          [character.License]
        );
      }
    }

    await conn.execute(
      `DELETE FROM washer_bot_whitelist_claims WHERE discord_id = ? LIMIT 1`,
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
