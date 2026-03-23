require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { execute: executeReportBug, handleModal: handleReportModal } = require('./commands/report-bug');
const { execute: executeBugStatus } = require('./commands/bug-status');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  console.log(`ClaudusBridge Bug Tracker bot ready! Logged in as ${c.user.tag}`);
  console.log(`Serving ${c.guilds.cache.size} guild(s)`);
});

// Handle slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'report-bug':
          await executeReportBug(interaction);
          break;
        case 'bug-status':
          await executeBugStatus(interaction);
          break;
        default:
          await interaction.reply({ content: 'Unknown command.', ephemeral: true });
      }
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'bug-report-modal') {
        await handleReportModal(interaction, client);
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const reply = { content: 'An error occurred processing your request.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
