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
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return 0x18A86B;
  return parseInt(clean, 16);
}

const config = {
  token: required('DISCORD_TOKEN'),

  guildId: optional('GUILD_ID', '1542303858695610438'),
  staffRoleId: optional('STAFF_ROLE_ID'),
  ticketCategoryId: optional('TICKET_CATEGORY_ID', '1542323499186782249'),
  logChannelId: optional('LOG_CHANNEL_ID', '1542323670859649095'),
  whitelistRoleId: optional('WHITELIST_ROLE_ID', '1542305754806223040'),

  cityName: optional('CITY_NAME', 'WASHER GAMES'),
  fivemConnect: optional('FIVEM_CONNECT', 'connect node12.zampto.net:31969'),
  fivemStatusUrl: optional('FIVEM_STATUS_URL', 'http://node12.zampto.net:31969'),
  rulesUrl: optional('RULES_URL'),

  embedColor: parseColor(optional('EMBED_COLOR', '18A86B')),
  logoUrl: optional('LOGO_URL'),

  connectTitle: optional('CONNECT_TITLE', 'WASHER GAMES'),
  connectBannerUrl: optional('CONNECT_BANNER_URL'),
  connectThumbUrl: optional('CONNECT_THUMB_URL'),

  ticketTitle: optional('TICKET_TITLE', '🎟️ Sistema Automático de Tickets'),
  ticketDescription: optional(
    'TICKET_DESCRIPTION',
    'Para receber **SUPORTE**, abra um ticket selecionando uma opção no menu abaixo.\n\n❗ Abra tickets apenas quando necessário.'
  ),
  ticketBannerUrl: optional('TICKET_BANNER_URL'),
  ticketThumbUrl: optional('TICKET_THUMB_URL'),

  whitelistTitle: optional('WHITELIST_TITLE', 'Sistema de liberação do servidor'),
  whitelistBannerUrl: optional('WHITELIST_BANNER_URL'),
  whitelistThumbUrl: optional('WHITELIST_THUMB_URL'),

  setNicknameAfterWhitelist: bool('SET_NICKNAME_AFTER_WHITELIST', true),
  nicknameFormat: process.env.NICKNAME_FORMAT || '#{id}/{liberado_por}/ | {nome}',
  autoReleaseLabel: optional('AUTO_RELEASE_LABEL', 'Auto'),

  dbEnabled: bool('DB_ENABLED', true),
  db: {
    host: optional('DB_HOST', 'node12.zampto.net'),
    port: integer('DB_PORT', 3306),
    user: optional('DB_USER', '19640_washer'),
    password: process.env.DB_PASSWORD || '',
    database: optional('DB_NAME', '19640_creative'),
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
