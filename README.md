# WASHER GAMES — Bot FiveM completo

Bot Discord em Node.js com:

- `/painel` — painel principal da cidade.
- `/connect` — mostra o connect personalizado.
- `/status` — consulta `dynamic.json` do FXServer.
- `/ticket` — atendimento com categoria, formulário e canal privado.
- Botões de **Assumir** e **Fechar** ticket.
- Transcript `.txt` enviado no canal de logs ao fechar.
- `/liberarid` — whitelist automática via MySQL.
- Verificação do Discord dono do ID em `vrp_user_ids`.
- Cargo de liberado automático.
- Nick automático no formato:
  `#ID/Auto/ | Nome`
- `/idinfo` e `/desvincularid` para a staff.
- Logs de whitelist e tickets.

## 1. Requisitos

- Node.js 20 ou superior.
- Bot criado no Discord Developer Portal.
- MySQL acessível pelo computador/VPS onde o bot estiver rodando.
- O bot precisa das permissões:
  - Ver canais
  - Enviar mensagens
  - Gerenciar canais
  - Gerenciar cargos
  - Gerenciar apelidos
  - Ler histórico de mensagens
  - Anexar arquivos

**Importante:** o cargo do BOT deve ficar acima do cargo de whitelist e acima dos membros cujo nick ele vai alterar.

## 2. Configuração

1. Copie `.env.example`.
2. Renomeie para `.env`.
3. Preencha:
   - `DISCORD_TOKEN`
   - `GUILD_ID`
   - `STAFF_ROLE_ID`
   - `TICKET_CATEGORY_ID`
   - `LOG_CHANNEL_ID`
   - `WHITELIST_ROLE_ID`
   - dados do MySQL
   - connect/IP da cidade

## 3. vRP clássico

O padrão já vem preparado para:

- `vrp_users.id`
- `vrp_users.whitelisted`
- `vrp_user_ids.user_id`
- `vrp_user_ids.identifier`

Na liberação, o bot procura:

`discord:ID_DO_DISCORD`

ligado ao ID informado. Isso evita uma pessoa liberar o ID de outra.

Se sua base usa nomes de tabelas/colunas diferentes, altere apenas o `.env`.

## 4. Nick automático

O padrão é:

`#{id}/{liberado_por}/ | {nome}`

Na liberação automática, `{liberado_por}` recebe `Auto`.

Exemplo:

`#152/Auto/ | João Silva`

Você pode trocar em:

`NICKNAME_FORMAT=...`

## 5. Iniciar

No Windows, basta abrir:

`start.bat`

Ou pelo terminal:

```bash
npm install
npm start
```

Os slash commands são registrados automaticamente quando o bot conecta.

## 6. Painel

Use `/painel` em um canal.

Ele envia um painel persistente com:

- Conectar
- Status
- Ticket
- Liberar ID

## 7. Banco hospedado em outro lugar

Se o bot estiver na Discloud/VPS e seu MySQL estiver no seu PC, `127.0.0.1` NÃO vai funcionar.

O banco precisa estar acessível pela internet/VPS, ou o bot deve rodar na mesma máquina/rede do MySQL.
