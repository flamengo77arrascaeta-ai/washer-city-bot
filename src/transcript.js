async function buildTranscript(channel) {
  const messages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;

    messages.push(...batch.values());
    before = batch.last().id;

    if (batch.size < 100) break;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = messages.map((m) => {
    const date = new Date(m.createdTimestamp).toISOString();
    const author = m.author?.tag || m.author?.username || 'Desconhecido';
    const id = m.author?.id || 'n/a';
    const content = m.content || '[sem texto]';
    const attachments = [...m.attachments.values()].map(a => a.url);

    return `[${date}] ${author} (${id}): ${content}${attachments.length ? ` | anexos: ${attachments.join(' ')}` : ''}`;
  });

  return Buffer.from(lines.join('\n') || 'Ticket sem mensagens.', 'utf8');
}

module.exports = { buildTranscript };
