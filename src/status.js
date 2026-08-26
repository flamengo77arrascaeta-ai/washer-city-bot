const config = require('./config');

async function fetchJson(url, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WasherCityBot/1.0' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getServerStatus() {
  if (!config.fivemStatusUrl) {
    return {
      online: null,
      players: null,
      maxPlayers: null,
      hostname: config.cityName,
    };
  }

  const base = config.fivemStatusUrl.replace(/\/+$/, '');

  try {
    const dynamic = await fetchJson(`${base}/dynamic.json`);
    return {
      online: true,
      players: Number(dynamic.clients ?? 0),
      maxPlayers: Number(dynamic.sv_maxclients ?? 0),
      hostname: dynamic.hostname || config.cityName,
    };
  } catch (error) {
    return {
      online: false,
      players: null,
      maxPlayers: null,
      hostname: config.cityName,
      error: error.message,
    };
  }
}

module.exports = { getServerStatus };
