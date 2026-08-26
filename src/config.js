require('dotenv').config();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente no .env: ${name}`);
  return value;
}

function optional(name, fallback = '') {
  const raw = process.env[name];
  return raw == null || raw === '' ? fallback : raw.trim();
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(raw.toLowerCase());
}

function integer(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} precisa ser inteiro.`);
  return value;
}

function identifier(name, fallback) {
  const value = optional(name, fallback);
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${name} possui caracteres inválidos.`);
  }
  return value;
}

function parseColor(hex) {
  const clean = String(hex).replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return 0xD9D9D9;
  return parseInt(clean, 16);
}

const config = {
  token: required('DISCORD_TOKEN'),
  guildId: required('GUILD_ID'),
  staffRoleId: required('STAFF_ROLE_ID'),
  ticketCategoryId: required('TICKET_CATEGORY_ID'),
  logChannelId: required('LOG_CHANNEL_ID'),
  whitelistRoleId: optional('WHITELIST_ROLE_ID'),

  cityName: optional('CITY_NAME', 'WASHER GAMES'),
  fivemConnect: optional('FIVEM_CONNECT', 'connect 127.0.0.1:30120'),
  fivemJoinUrl: optional('FIVEM_JOIN_URL'),
  fivemStatusUrl: optional('FIVEM_STATUS_URL'),
  embedColor: parseColor(optional('EMBED_COLOR', 'D9D9D9')),
  panelBannerUrl: optional('PANEL_BANNER_URL'),
  ticketBannerUrl: optional('TICKET_BANNER_URL'),
  logoUrl: optional('LOGO_URL'),

  setNicknameAfterWhitelist: bool('SET_NICKNAME_AFTER_WHITELIST', true),
  nicknameFormat: process.env.NICKNAME_FORMAT || '#{id}/{liberado_por}/ | {nome}',
  autoReleaseLabel: optional('AUTO_RELEASE_LABEL', 'Auto'),

  dbEnabled: bool('DB_ENABLED', true),
  db: {
    host: optional('DB_HOST', '127.0.0.1'),
    port: integer('DB_PORT', 3306),
    user: optional('DB_USER', 'root'),
    password: process.env.DB_PASSWORD || '',
    database: optional('DB_NAME', 'database'),
  },

  whitelist: {
    table: identifier('WL_TABLE', 'vrp_users'),
    idColumn: identifier('WL_ID_COLUMN', 'id'),
    statusColumn: identifier('WL_STATUS_COLUMN', 'whitelisted'),
    statusValue: optional('WL_STATUS_VALUE', '1'),

    verifyMode: optional('WL_VERIFY_MODE', 'identifier_table').toLowerCase(),
    identifierTable: identifier('WL_IDENTIFIER_TABLE', 'vrp_user_ids'),
    identifierUserIdColumn: identifier('WL_IDENTIFIER_USER_ID_COLUMN', 'user_id'),
    identifierColumn: identifier('WL_IDENTIFIER_COLUMN', 'identifier'),
    discordPrefix: process.env.WL_DISCORD_PREFIX ?? 'discord:',
    discordColumn: identifier('WL_DISCORD_COLUMN', 'discord'),

    claimsTable: identifier('WL_CLAIMS_TABLE', 'washer_bot_whitelist_claims'),
  },
};

if (!['identifier_table', 'column', 'none'].includes(config.whitelist.verifyMode)) {
  throw new Error('WL_VERIFY_MODE deve ser identifier_table, column ou none.');
}

module.exports = config;
