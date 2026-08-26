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

const commands = [
  new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Envia o painel principal da cidade.'),

  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Mostra o connect da cidade.'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Mostra o status atual da cidade.'),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Abre o menu para criar um ticket.'),

  new SlashCommandBuilder()
    .setName('liberarid')
    .setDescription('Libera seu ID/whitelist automaticamente.'),

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

  return member.permissions?.has(PermissionFlagsBits.Administrator)
    || member.roles?.cache?.has(config.staffRoleId);
}

function addBrand(embed) {
  if (config.logoUrl) embed.setThumbnail(config.logoUrl);
  return embed;
}

function panelEmbed() {
  const embed = addBrand(
    new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`🏙️ ${config.cityName}`)
      .setDescription(
        [
          '**Bem-vindo ao painel oficial da cidade.**',
          '',
          'Use os botões abaixo para conectar, consultar o status, abrir suporte ou liberar seu ID.',
          '',
          '🎮 **Connect** — entre na cidade',
          '📡 **Status** — veja players/servidor',
          '🎫 **Ticket** — atendimento privado',
          '✅ **Liberar ID** — whitelist automática',
        ].join('\n')
      )
      .setFooter({ text: `${config.cityName} • Sistema automático` })
      .setTimestamp()
  );

  if (config.panelBannerUrl) embed.setImage(config.panelBannerUrl);
  return embed;
}

function panelRows() {
  const row = new ActionRowBuilder();

  if (config.fivemJoinUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Conectar')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Link)
        .setURL(config.fivemJoinUrl)
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('panel_connect')
        .setLabel('Conectar')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Primary)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId('panel_status')
      .setLabel('Status')
      .setEmoji('📡')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('panel_ticket')
      .setLabel('Ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('panel_whitelist')
      .setLabel('Liberar ID')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );

  return [row];
}

function connectEmbed() {
  return addBrand(
    new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`🎮 Connect • ${config.cityName}`)
      .setDescription(
        [
          'Copie o comando abaixo, abra o **F8** no FiveM e cole:',
          '',
          `\`\`\`${config.fivemConnect}\`\`\``,
        ].join('\n')
      )
      .setFooter({ text: `${config.cityName} • Bom RP!` })
  );
}

async function statusEmbed() {
  const status = await getServerStatus();

  if (status.online === null) {
    return addBrand(
      new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle(`📡 Status • ${config.cityName}`)
        .setDescription('O monitoramento de status ainda não foi configurado no `.env`.')
    );
  }

  if (!status.online) {
    return addBrand(
      new EmbedBuilder()
        .setColor(config.embedColor)
        .setTitle(`🔴 ${config.cityName} está offline`)
        .setDescription('Não foi possível acessar o status do FXServer agora.')
        .setTimestamp()
    );
  }

  return addBrand(
    new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`🟢 ${config.cityName} está online`)
      .addFields(
        { name: 'Players', value: `**${status.players ?? 0}/${status.maxPlayers ?? '?'}**`, inline: true },
        { name: 'Servidor', value: status.hostname || config.cityName, inline: true }
      )
      .setTimestamp()
  );
}

function ticketMenu() {
  const embed = addBrand(
    new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`🎫 Central de Atendimento • ${config.cityName}`)
      .setDescription(
        [
          'Escolha abaixo o motivo do seu atendimento.',
          '',
          'Você só pode ter **1 ticket aberto por vez**.',
        ].join('\n')
      )
  );

  if (config.ticketBannerUrl) embed.setImage(config.ticketBannerUrl);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_category')
    .setPlaceholder('Selecione o tipo do ticket...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Suporte')
        .setDescription('Ajuda com problemas gerais.')
        .setEmoji('🛠️')
        .setValue('suporte'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Denúncia')
        .setDescription('Denuncie player ou situação.')
        .setEmoji('🚨')
        .setValue('denuncia'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Compras / Loja')
        .setDescription('Assuntos sobre compras e benefícios.')
        .setEmoji('🛒')
        .setValue('compras'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Parceria')
        .setDescription('Propostas de parceria.')
        .setEmoji('🤝')
        .setValue('parceria'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Outro')
        .setDescription('Outro assunto.')
        .setEmoji('📌')
        .setValue('outro')
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
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
    .setLabel('Seu nome')
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
  const channel = await client.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send(payload).catch(err => console.error('[LOG]', err));
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, config.guildId),
    { body: commands }
  );

  console.log(`[DISCORD] ${commands.length} comandos sincronizados.`);
}

async function openTicket(interaction, category, subject, description) {
  const guild = interaction.guild;

  const existing = guild.channels.cache.find(
    ch => ch.parentId === config.ticketCategoryId
      && ch.topic?.includes(`ticket-owner:${interaction.user.id}`)
  );

  if (existing) {
    await interaction.reply({
      content: `❌ Você já possui um ticket aberto: ${existing}`,
      ephemeral: true,
    });
    return;
  }

  const channel = await guild.channels.create({
    name: safeChannelName(`${category}-${interaction.user.username}`),
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId,
    topic: `ticket-owner:${interaction.user.id};category:${category};claimed:none`,
    permissionOverwrites: [
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
      {
        id: config.staffRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.ManageMessages,
        ],
      },
    ],
  });

  const embed = addBrand(
    new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(`🎫 Ticket • ${category.toUpperCase()}`)
      .setDescription(
        [
          `${interaction.user}, seu atendimento foi criado.`,
          '',
          `**Assunto:** ${subject}`,
          `**Descrição:** ${description}`,
          '',
          `Aguarde a equipe <@&${config.staffRoleId}> responder.`,
        ].join('\n')
      )
      .setFooter({ text: `ID do usuário: ${interaction.user.id}` })
      .setTimestamp()
  );

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
    content: `${interaction.user} <@&${config.staffRoleId}>`,
    embeds: [embed],
    components: [controls],
  });

  await interaction.reply({
    content: `✅ Ticket criado: ${channel}`,
    ephemeral: true,
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
          { name: 'Assunto', value: subject },
        )
        .setTimestamp(),
    ],
  });
}

async function closeTicket(interaction, reason) {
  const channel = interaction.channel;

  if (!channel?.topic?.includes('ticket-owner:')) {
    await interaction.reply({ content: '❌ Este canal não é um ticket.', ephemeral: true });
    return;
  }

  const ownerId = channel.topic.match(/ticket-owner:(\d+)/)?.[1];
  const allowed = isStaff(interaction.member) || interaction.user.id === ownerId;

  if (!allowed) {
    await interaction.reply({ content: '❌ Você não pode fechar este ticket.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

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

client.once('ready', async () => {
  console.log(`[DISCORD] Logado como ${client.user.tag}`);

  try {
    await initDb();
  } catch (error) {
    console.error('[DB] Falha ao conectar:', error.message);
  }

  try {
    await registerCommands();
  } catch (error) {
    console.error('[DISCORD] Falha ao registrar comandos:', error);
  }

  client.user.setActivity(`${config.cityName} • /painel`);
});

client.on('interactionCreate', async interaction => {
  try {
    // ================= SLASH COMMANDS =================

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'painel') {
        if (!isStaff(interaction.member)) {
          await interaction.reply({ content: '❌ Apenas a staff pode enviar o painel.', ephemeral: true });
          return;
        }

        await interaction.channel.send({
          embeds: [panelEmbed()],
          components: panelRows(),
        });

        await interaction.reply({ content: '✅ Painel enviado.', ephemeral: true });
        return;
      }

      if (interaction.commandName === 'connect') {
        const components = config.fivemJoinUrl
          ? [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setLabel('Entrar na cidade')
                  .setEmoji('🎮')
                  .setStyle(ButtonStyle.Link)
                  .setURL(config.fivemJoinUrl)
              ),
            ]
          : [];

        await interaction.reply({
          embeds: [connectEmbed()],
          components,
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === 'status') {
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({ embeds: [await statusEmbed()] });
        return;
      }

      if (interaction.commandName === 'ticket') {
        await interaction.reply({ ...ticketMenu(), ephemeral: true });
        return;
      }

      if (interaction.commandName === 'liberarid') {
        await interaction.showModal(whitelistModal());
        return;
      }

      if (interaction.commandName === 'idinfo') {
        if (!isStaff(interaction.member)) {
          await interaction.reply({ content: '❌ Apenas a staff pode usar este comando.', ephemeral: true });
          return;
        }

        const user = interaction.options.getUser('usuario', true);
        const claim = await getClaimByDiscord(user.id);

        if (!claim) {
          await interaction.reply({ content: 'ℹ️ Esse usuário não possui ID vinculado pelo bot.', ephemeral: true });
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
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === 'desvincularid') {
        if (!isStaff(interaction.member)) {
          await interaction.reply({ content: '❌ Apenas a staff pode usar este comando.', ephemeral: true });
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
          ephemeral: true,
        });

        await sendLog({
          embeds: [
            new EmbedBuilder()
              .setColor(config.embedColor)
              .setTitle('🧹 ID desvinculado')
              .addFields(
                { name: 'Usuário', value: `${user} (${user.id})` },
                { name: 'ID', value: String(claim.fivem_id), inline: true },
                { name: 'Por', value: `${interaction.user} (${interaction.user.id})`, inline: true },
                { name: 'Whitelist zerada?', value: revert ? 'Sim' : 'Não', inline: true }
              )
              .setTimestamp(),
          ],
        });
        return;
      }
    }

    // ================= BOTÕES =================

    if (interaction.isButton()) {
      if (interaction.customId === 'panel_connect') {
        await interaction.reply({ embeds: [connectEmbed()], ephemeral: true });
        return;
      }

      if (interaction.customId === 'panel_status') {
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({ embeds: [await statusEmbed()] });
        return;
      }

      if (interaction.customId === 'panel_ticket') {
        await interaction.reply({ ...ticketMenu(), ephemeral: true });
        return;
      }

      if (interaction.customId === 'panel_whitelist') {
        await interaction.showModal(whitelistModal());
        return;
      }

      if (interaction.customId === 'ticket_claim') {
        if (!isStaff(interaction.member)) {
          await interaction.reply({ content: '❌ Apenas a staff pode assumir tickets.', ephemeral: true });
          return;
        }

        const oldTopic = interaction.channel.topic || '';
        const claimed = oldTopic.match(/claimed:(\d+)/)?.[1];

        if (claimed) {
          await interaction.reply({ content: `ℹ️ Este ticket já foi assumido por <@${claimed}>.`, ephemeral: true });
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

    // ================= SELECT MENU =================

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
      const category = interaction.values[0];
      await interaction.showModal(ticketModal(category));
      return;
    }

    // ================= MODALS =================

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
        await interaction.deferReply({ ephemeral: true });

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

        if (config.whitelistRoleId) {
          await member.roles.add(config.whitelistRoleId).catch(err => {
            console.error('[WHITELIST] Não consegui dar o cargo:', err.message);
          });
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
            nickResult = `Falhou: ${error.message}`;
          }
        }

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.embedColor)
              .setTitle('✅ ID liberado com sucesso')
              .setDescription('Sua whitelist foi atualizada automaticamente.')
              .addFields(
                { name: 'ID', value: `**${claim.id}**`, inline: true },
                { name: 'Nome', value: `**${claim.name}**`, inline: true },
                { name: 'Liberado por', value: `**${releasedBy}**`, inline: true },
                { name: 'Nick', value: `\`${nickResult}\`` }
              )
              .setFooter({ text: `${config.cityName} • Liberação automática` })
              .setTimestamp(),
          ],
        });

        await sendLog({
          embeds: [
            new EmbedBuilder()
              .setColor(config.embedColor)
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

    const message = `❌ ${error.message || 'Ocorreu um erro inesperado.'}`;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.login(config.token);
