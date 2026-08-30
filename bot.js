// bot.js
// The actual Discord bot. Two jobs:
//  1. Handle the /setcodeschannel slash command (quick fallback config method)
//  2. Once a day, post the current codes into every server's chosen channel

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ChannelSelectMenuBuilder,
  ActionRowBuilder,
} = require('discord.js');
const cron = require('node-cron');

const { fetchCodes, buildEmbed } = require('./fetch-codes.js');
const { setGuildChannel, getAllConfiguredGuilds } = require('./db.js');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!BOT_TOKEN || !CLIENT_ID) {
  console.error('DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- Slash command registration ---
const commands = [
  new SlashCommandBuilder()
    .setName('setcodeschannel')
    .setDescription('Choose which channel gets the daily Delta Force door codes')
    .addChannelOption(opt =>
      opt.setName('channel')
        .setDescription('The channel to post codes into')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Slash commands registered.');
}

// Shared logic: save the chosen channel, then try posting today's codes
// right away. Used by both the slash command and the welcome-message
// channel picker.
async function handleChannelChosen(interaction, channel) {
  setGuildChannel(interaction.guildId, channel.id);

  await interaction.reply({
    content: `Done! Daily door codes will be posted in <#${channel.id}>.`,
    ephemeral: true,
  });

  try {
    const codes = await fetchCodes();
    const embed = buildEmbed(codes);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to post immediate codes after setup:', err);

    let helpMsg = "I saved your channel choice, but couldn't post today's codes there yet - I'll try again automatically tomorrow.";
    if (err.code === 50001 || err.code === 50013) {
      helpMsg = `I don't have permission to post in <#${channel.id}> yet. Could you check that my role has "View Channel" and "Send Messages" allowed in that channel's permission settings? Once that's fixed, just run /setcodeschannel again and I'll post right away.`;
    }

    try {
      await interaction.followUp({ content: helpMsg, ephemeral: true });
    } catch (followUpErr) {
      console.error('Failed to send follow-up error message:', followUpErr);
    }
  }
}

client.on('interactionCreate', async (interaction) => {
  // Channel picker from the welcome message
  if (interaction.isChannelSelectMenu() && interaction.customId === 'pick_codes_channel') {
    const channel = interaction.channels.first();
    await handleChannelChosen(interaction, channel);
    return;
  }

  // /setcodeschannel slash command
  if (interaction.isChatInputCommand() && interaction.commandName === 'setcodeschannel') {
    const channel = interaction.options.getChannel('channel');
    await handleChannelChosen(interaction, channel);
  }
});

// Send a welcome message with a built-in channel picker the moment the
// bot joins a new server - no command needed, just click and pick.
client.on('guildCreate', async (guild) => {
  try {
    let targetChannel = guild.systemChannel;
    const me = guild.members.me;

    if (!targetChannel || !targetChannel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])) {
      targetChannel = guild.channels.cache.find(c =>
        c.type === ChannelType.GuildText &&
        c.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])
      );
    }

    if (!targetChannel) {
      console.log(`Joined guild ${guild.id} but couldn't find any channel to post a welcome message in.`);
      return;
    }

    const row = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('pick_codes_channel')
        .setPlaceholder('Pick a channel for daily door codes')
        .addChannelTypes(ChannelType.GuildText)
    );

    await targetChannel.send({
      content: "Thanks for adding **Delta Force Door Codes**! Pick a channel below and I'll post today's codes there right away, then automatically every day after.",
      components: [row],
    });
  } catch (err) {
    console.error('Failed to send welcome message:', err);
  }
});

// --- Daily posting job ---
async function postToAllGuilds() {
  let codes;
  try {
    codes = await fetchCodes();
  } catch (err) {
    console.error('Failed to fetch codes, skipping today\'s post:', err);
    return;
  }

  const embed = buildEmbed(codes);
  const guilds = getAllConfiguredGuilds();

  for (const { guild_id, channel_id } of guilds) {
    try {
      const channel = await client.channels.fetch(channel_id);
      await channel.send({ embeds: [embed] });
      console.log(`Posted codes to guild ${guild_id}, channel ${channel_id}`);
    } catch (err) {
      console.error(`Failed to post to guild ${guild_id}:`, err.message);
    }
  }
}

// Runs once every day at 08:05 server time - matches when the game's
// codes reset. Adjust if you want it earlier/later.
const SCHEDULE = '5 8 * * *';

client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  await registerCommands();
  cron.schedule(SCHEDULE, postToAllGuilds);
  console.log(`Daily posting scheduled: ${SCHEDULE} (server time)`);
});

client.login(BOT_TOKEN);

module.exports = { postToAllGuilds };
