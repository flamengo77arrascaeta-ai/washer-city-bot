const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  AttachmentBuilder,
  Events,
  MessageFlags,
} = require('discord.js');

const config = require('./config');
const {
  initDb,
  claimWhitelist,
  getClaimByDiscord,
  unlinkWhitelist,
} = require('./db');
const { getServerStatus } = require('./status');
const { buildTranscript } = require('./transcript');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

process.on('unhandledRejection', err => console.error('[UNHANDLED]', err));
process.on('uncaughtException', err => console.error('[UNCAUGHT]', err));

const STATE_FILE = path.join(process.cwd(), 'washer-panel-state.json');
let panelState = loadPanelState();

function loadPanelState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function savePanelState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(panelState, null, 2), 'utf8');
  } catch (error) {
    console.error('[PAINEL] Não foi possível salvar estado:', error.message);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Envia o painel público de Connect + Status.'),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Envia o painel público de tickets.'),

  new SlashCommandBuilder()
    .setName('liberarid')
    .setDescription('Envia o painel público para liberar ID.'),

  new SlashCommandBuilder()
    .setName('idinfo')
    .setDescription('Consulta o ID vinculado de um membro.')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Membro que será consultado.')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('desvincularid')
    .setDescription('Desvincula o ID de um membro.')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Membro que será desvinculado.')
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('remover_whitelist')
        .setDescription('Também altera a whitelist para 0 na base.')
        .setRequired(false)
    ),
].map(cmd => cmd.toJSON());

function isStaff(member) {
  if (!member) return false;
  return Boolean(
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    (config.staffRoleId && member.roles?.cache?.has(config.staffRoleId))
  );
}

function brandThumb() {
  return config.logoUrl || client.user?.displayAvatarURL({ size: 256 }) || null;
}

function applyVisuals(embed, { thumb, banner } = {}) {
  const thumbUrl = thumb || brandThumb();
  if (thumbUrl) embed.setThumbnail(thumbUrl);
  if (banner) embed.setImage(banner);
  return embed;
}

function nowBrazil() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

async function buildConnectPanel() {
  const status = await getServerStatus();
  const online = status.online === true;

  const embed = new EmbedBuilder()
    .setColor(online ? 0x2ECC71 : 0xE74C3C)
    .setTitle(config.connectTitle)
    .addFields(
      {
        name: '▏ Status:',
        value: online ? '🟢 `ONLINE`' : '🔴 `OFFLINE`',
        inline: true,
      },
      {
        name: '▏ Jogadores:',
        value: online
          ? `\`[ ${status.players ?? 0}/${status.maxPlayers ?? '?'} ]\``
          : '`[ 0/? ]`',
        inline: true,
      },
      {
        name: '▏ IP FiveM:',
        value: `\`\`\`${config.fivemConnect}\`\`\``,
        inline: false,
      }
    )
    .setFooter({
      text: `📊 Atualizado a cada 2 minutos | Última atualização: ${nowBrazil()}`,
    });

  applyVisuals(embed, {
    thumb: config.connectThumbUrl,
    banner: config.connectBannerUrl,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('connect_copy')
      .setLabel('Conectar')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Secondary)
  );

  if (config.rulesUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Regras')
        .setEmoji('📚')
        .setStyle(ButtonStyle.Link)
        .setURL(config.rulesUrl)
    );
  }

  return { embeds: [embed], components: [row] };
}

function buildTicketPanel() {
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(config.ticketTitle)
    .setDescription(config.ticketDescription)
    .setFooter({ text: `${config.cityName} • Atendimento` });

  applyVisuals(embed, {
    thumb: config.ticketThumbUrl,
    banner: config.ticketBannerUrl,
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_category')
    .setPlaceholder('➡️ Clique aqui para selecionar...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Suporte')
        .setDescription('Problemas gerais, bugs e ajuda.')
        .setEmoji('🛠️')
        .setValue('suporte'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Denúncia')
        .setDescription('Denúncia de player ou situação.')
        .setEmoji('🚨')
        .setValue('denuncia'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Compras / Loja')
        .setDescription('Dúvidas sobre compras e benefícios.')
        .setEmoji('🛒')
        .setValue('compras'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Parceria')
        .setDescription('Propostas de parceria.')
        .setEmoji('🤝')
        .setValue('parceria'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Outro')
        .setDescription('Qualquer outro assunto.')
        .setEmoji('📌')
        .setValue('outro')
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

function buildWhitelistPanel() {
  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(config.whitelistTitle)
    .setDescription(
      [
        '**Siga os passos abaixo para completar o processo de liberação de acesso:**',
        '',
        `• Conecte-se ao servidor pelo FiveM usando: \`${config.fivemConnect}\``,
        '• Pegue o **ID** exibido dentro da cidade.',
        '• Clique em **Liberar Acesso** e informe seu ID e nome.',
        '',
        'Após a liberação o bot atualiza sua whitelist, cargo e nickname automaticamente.',
      ].join('\n')
    )
    .setFooter({ text: `${config.cityName} • Liberação automática` });

  applyVisuals(embed, {
    thumb: config.whitelistThumbUrl,
    banner: config.whitelistBannerUrl,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('whitelist_open')
      .setLabel('Liberar Acesso')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

function whitelistModal() {
  const modal = new ModalBuilder()
    .setCustomId('whitelist_modal')
    .setTitle(`Liberar ID • ${config.cityName}`);

  const id = new TextInputBuilder()
    .setCustomId('fivem_id')
    .setLabel('Seu ID da cidade')
    .setPlaceholder('Ex.: 123')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(12);

  const name = new TextInputBuilder()
    .setCustomId('rp_name')
    .setLabel('Seu nome na cidade')
    .setPlaceholder('Ex.: João Silva')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(60);

  modal.addComponents(
    new ActionRowBuilder().addComponents(id),
    new ActionRowBuilder().addComponents(name)
  );

  return modal;
}

function ticketModal(category) {
  const labels = {
    suporte: 'Suporte',
    denuncia: 'Denúncia',
    compras: 'Compras',
    parceria: 'Parceria',
    outro: 'Outro',
  };

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal:${category}`)
    .setTitle(`Ticket • ${labels[category] || 'Atendimento'}`);

  const subject = new TextInputBuilder()
    .setCustomId('ticket_subject')
    .setLabel('Resumo do assunto')
    .setPlaceholder('Explique em poucas palavras...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  const description = new TextInputBuilder()
    .setCustomId('ticket_description')
    .setLabel('Explique o que aconteceu')
    .setPlaceholder('Coloque todos os detalhes importantes...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(subject),
    new ActionRowBuilder().addComponents(description)
  );

  return modal;
}

function closeTicketModal() {
  const modal = new ModalBuilder()
    .setCustomId('ticket_close_modal')
    .setTitle('Fechar Ticket');

  const reason = new TextInputBuilder()
    .setCustomId('close_reason')
    .setLabel('Motivo do fechamento')
    .setPlaceholder('Ex.: Resolvido.')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  return modal;
}

function safeChannelName(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function buildNickname({ id, name, releasedBy }) {
  let nick = config.nicknameFormat
    .replaceAll('{id}', String(id))
    .replaceAll('{nome}', String(name))
    .replaceAll('{liberado_por}', String(releasedBy));

  if (nick.length > 32) nick = nick.slice(0, 32);
  return nick;
}

async function sendLog(payload) {
  if (!config.logChannelId) return;
  const channel = await client.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send(payload).catch(err => console.error('[LOG]', err.message));
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, config.guildId),
    { body: commands }
  );

  console.log(`[DISCORD] ${commands.length} comandos sincronizados.`);
}

async function postConnectPanel(channel) {
  const message = await channel.send(await buildConnectPanel());
  panelState.connect = {
    channelId: channel.id,
    messageId: message.id,
  };
  savePanelState();
  return message;
}

async function refreshConnectPanel() {
  const saved = panelState.connect;
  if (!saved?.channelId || !saved?.messageId) return;

  const channel = await client.channels.fetch(saved.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(saved.messageId).catch(() => null);
  if (!message) {
    delete panelState.connect;
    savePanelState();
    return;
  }

  await message.edit(await buildConnectPanel()).catch(error => {
    console.error('[STATUS] Falha ao atualizar painel:', error.message);
  });
}

async function openTicket(interaction, category, subject, description) {
  const guild = interaction.guild;

  const existing = guild.channels.cache.find(
    ch =>
      ch.topic?.includes(`ticket-owner:${interaction.user.id}`) &&
      (!config.ticketCategoryId || ch.parentId === config.ticketCategoryId)
  );

  if (existing) {
    await interaction.reply({
      content: `❌ Você já possui um ticket aberto: ${existing}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    },
  ];

  if (config.staffRoleId) {
    permissionOverwrites.push({
      id: config.staffRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.ManageMessages,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: safeChannelName(`${category}-${interaction.user.username}`),
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId || undefined,
    topic: `ticket-owner:${interaction.user.id};category:${category};claimed:none`,
    permissionOverwrites,
  });

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setTitle(`🎫 Ticket • ${category.toUpperCase()}`)
    .setDescription(
      [
        `${interaction.user}, seu atendimento foi criado.`,
        '',
        `**Assunto:** ${subject}`,
        `**Descrição:** ${description}`,
        '',
        config.staffRoleId
          ? `Aguarde a equipe <@&${config.staffRoleId}> responder.`
          : 'Aguarde a equipe responder.',
      ].join('\n')
    )
    .setFooter({ text: `ID do usuário: ${interaction.user.id}` })
    .setTimestamp();

  applyVisuals(embed, { thumb: config.ticketThumbUrl });

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel('Assumir')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Fechar')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: config.staffRoleId
      ? `${interaction.user} <@&${config.staffRoleId}>`
      : `${interaction.user}`,
    embeds: [embed],
    components: [controls],
  });

  await interaction.reply({
    content: `✅ Ticket criado: ${channel}`,
    flags: MessageFlags.Ephemeral,
  });

  await sendLog({
    embeds: [
      new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle('🎫 Ticket aberto')
        .addFields(
          { name: 'Usuário', value: `${interaction.user} (${interaction.user.id})` },
          { name: 'Categoria', value: category, inline: true },
          { name: 'Canal', value: `${channel}`, inline: true },
          { name: 'Assunto', value: subject }
        )
        .setTimestamp(),
    ],
  });
}

async function closeTicket(interaction, reason) {
  const channel = interaction.channel;

  if (!channel?.topic?.includes('ticket-owner:')) {
    await interaction.reply({
      content: '❌ Este canal não é um ticket.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ownerId = channel.topic.match(/ticket-owner:(\d+)/)?.[1];
  const allowed = isStaff(interaction.member) || interaction.user.id === ownerId;

  if (!allowed) {
    await interaction.reply({
      content: '❌ Você não pode fechar este ticket.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let transcript;
  try {
    transcript = await buildTranscript(channel);
  } catch {
    transcript = Buffer.from('Não foi possível gerar o transcript.', 'utf8');
  }

  const file = new AttachmentBuilder(transcript, {
    name: `transcript-${channel.name}.txt`,
  });

  await sendLog({
    embeds: [
      new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle('🔒 Ticket fechado')
        .addFields(
          { name: 'Canal', value: channel.name, inline: true },
          { name: 'Fechado por', value: `${interaction.user} (${interaction.user.id})`, inline: true },
          { name: 'Motivo', value: reason || 'Não informado' }
        )
        .setTimestamp(),
    ],
    files: [file],
  });

  await interaction.editReply('✅ Ticket fechado. O canal será removido.');

  setTimeout(() => {
    channel.delete(`Ticket fechado por ${interaction.user.tag}`).catch(() => {});
  }, 2500);
}

client.once(Events.ClientReady, async () => {
  console.log(`[DISCORD] Logado como ${client.user.tag}`);

  try {
    await initDb();
  } catch (error) {
    console.error('[DB] Banco indisponível no início:', error.message);
  }

  try {
    await registerCommands();
  } catch (error) {
    console.error('[DISCORD] Falha ao registrar comandos:', error.message);
  }

  client.user.setActivity(`${config.cityName} • Connect / Ticket / ID`);

  await refreshConnectPanel();
  setInterval(refreshConnectPanel, 120000);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (['connect', 'ticket', 'liberarid'].includes(interaction.commandName)) {
        if (!isStaff(interaction.member)) {
          await interaction.reply({
            content: '❌ Apenas a staff pode publicar os painéis.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (interaction.commandName === 'connect') {
          await postConnectPanel(interaction.channel);
          await interaction.reply({
            content: '✅ Painel **Connect + Status** enviado e atualização automática ativada.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (interaction.commandName === 'ticket') {
          await interaction.channel.send(buildTicketPanel());
          await interaction.reply({
            content: '✅ Painel de **Tickets** enviado.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (interaction.commandName === 'liberarid') {
          await interaction.channel.send(buildWhitelistPanel());
          await interaction.reply({
            content: '✅ Painel de **Liberar ID** enviado.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      if (interaction.commandName === 'idinfo') {
        if (!isStaff(interaction.member)) {
          await interaction.reply({
            content: '❌ Apenas a staff pode usar este comando.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const user = interaction.options.getUser('usuario', true);
        const claim = await getClaimByDiscord(user.id);

        if (!claim) {
          await interaction.reply({
            content: 'ℹ️ Esse usuário não possui ID vinculado pelo bot.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.embedColor)
              .setTitle('🔎 Informações do ID')
              .addFields(
                { name: 'Usuário', value: `${user} (${user.id})` },
                { name: 'ID FiveM', value: String(claim.fivem_id), inline: true },
                { name: 'Nome', value: String(claim.rp_name), inline: true },
                { name: 'Liberado por', value: String(claim.released_by), inline: true }
              )
              .setTimestamp(new Date(claim.created_at)),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.commandName === 'desvincularid') {
        if (!isStaff(interaction.member)) {
          await interaction.reply({
            content: '❌ Apenas a staff pode usar este comando.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const user = interaction.options.getUser('usuario', true);
        const revert = interaction.options.getBoolean('remover_whitelist') || false;
        const claim = await unlinkWhitelist(user.id, revert);

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member && config.whitelistRoleId) {
          await member.roles.remove(config.whitelistRoleId).catch(() => {});
        }

        await interaction.reply({
          content: `✅ ${user} foi desvinculado do ID **${claim.fivem_id}**${revert ? ' e teve a whitelist removida da base' : ''}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'connect_copy') {
        await interaction.reply({
          content: `Abra o **F8** no FiveM e cole:\n\`\`\`${config.fivemConnect}\`\`\``,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === 'whitelist_open') {
        await interaction.showModal(whitelistModal());
        return;
      }

      if (interaction.customId === 'ticket_claim') {
        if (!isStaff(interaction.member)) {
          await interaction.reply({
            content: '❌ Apenas a staff pode assumir tickets.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const oldTopic = interaction.channel.topic || '';
        const claimed = oldTopic.match(/claimed:(\d+)/)?.[1];

        if (claimed) {
          await interaction.reply({
            content: `ℹ️ Este ticket já foi assumido por <@${claimed}>.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const newTopic = oldTopic.replace(/claimed:(none|\d+)/, `claimed:${interaction.user.id}`);
        await interaction.channel.setTopic(newTopic);

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.embedColor)
              .setDescription(`🙋 Ticket assumido por ${interaction.user}.`)
              .setTimestamp(),
          ],
        });
        return;
      }

      if (interaction.customId === 'ticket_close') {
        await interaction.showModal(closeTicketModal());
        return;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
      await interaction.showModal(ticketModal(interaction.values[0]));
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('ticket_modal:')) {
        const category = interaction.customId.split(':')[1];
        const subject = interaction.fields.getTextInputValue('ticket_subject');
        const description = interaction.fields.getTextInputValue('ticket_description');
        await openTicket(interaction, category, subject, description);
        return;
      }

      if (interaction.customId === 'ticket_close_modal') {
        const reason = interaction.fields.getTextInputValue('close_reason');
        await closeTicket(interaction, reason);
        return;
      }

      if (interaction.customId === 'whitelist_modal') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const fivemId = interaction.fields.getTextInputValue('fivem_id').trim();
        const rpName = interaction.fields.getTextInputValue('rp_name').trim();
        const releasedBy = config.autoReleaseLabel;

        const claim = await claimWhitelist({
          discordId: interaction.user.id,
          fivemId,
          rpName,
          releasedBy,
        });

        const member = await interaction.guild.members.fetch(interaction.user.id);

        let roleResult = 'Não configurado';
        if (config.whitelistRoleId) {
          try {
            await member.roles.add(config.whitelistRoleId, 'Whitelist automática');
            roleResult = 'Aplicado';
          } catch (error) {
            roleResult = `Não aplicado: ${error.message}`;
          }
        }

        let nickResult = 'Não alterado';
        if (config.setNicknameAfterWhitelist) {
          const nickname = buildNickname({
            id: claim.id,
            name: claim.name,
            releasedBy,
          });

          try {
            await member.setNickname(nickname, 'Whitelist automática');
            nickResult = nickname;
          } catch (error) {
            nickResult = `Não alterado: ${error.message}`;
          }
        }

        const success = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('✅ ID liberado com sucesso')
          .setDescription('Sua whitelist foi atualizada automaticamente.')
          .addFields(
            { name: 'ID', value: `**${claim.id}**`, inline: true },
            { name: 'Nome', value: `**${claim.name}**`, inline: true },
            { name: 'Cargo', value: roleResult, inline: true },
            { name: 'Nickname', value: `\`${nickResult}\`` }
          )
          .setFooter({ text: `${config.cityName} • Liberação automática` })
          .setTimestamp();

        applyVisuals(success, { thumb: config.whitelistThumbUrl });

        await interaction.editReply({ embeds: [success] });

        await sendLog({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2ECC71)
              .setTitle('✅ Whitelist automática')
              .addFields(
                { name: 'Player', value: `${interaction.user} (${interaction.user.id})` },
                { name: 'ID', value: String(claim.id), inline: true },
                { name: 'Nome', value: String(claim.name), inline: true },
                { name: 'Liberado por', value: releasedBy, inline: true },
                { name: 'Nick aplicado', value: nickResult }
              )
              .setTimestamp(),
          ],
        });
        return;
      }
    }
  } catch (error) {
    console.error('[INTERACTION]', error);

    let message = `❌ ${error.message || 'Ocorreu um erro inesperado.'}`;

    if (/ECONN|ETIMEDOUT|MySQL|banco/i.test(String(error.message || ''))) {
      message = '❌ O banco de dados da cidade está indisponível no momento. O bot continua online, mas a liberação de ID precisa da conexão MySQL.';
    }

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }
});

client.login(config.token);
