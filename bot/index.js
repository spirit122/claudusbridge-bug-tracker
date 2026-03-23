require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { execute: executeReportBug, handleModal: handleReportModal } = require('./commands/report-bug');
const { execute: executeBugStatus } = require('./commands/bug-status');
const { notifyBugResolved } = require('./utils/notifier');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  console.log(`ClaudusBridge Bug Tracker bot ready! Logged in as ${c.user.tag}`);
  console.log(`Serving ${c.guilds.cache.size} guild(s)`);

  // Poll for resolved bug notifications from MCP
  const notifDir = path.join(__dirname, '..', 'data', 'notifications');
  setInterval(async () => {
    if (!fs.existsSync(notifDir)) return;
    const files = fs.readdirSync(notifDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const filePath = path.join(notifDir, file);
        const notif = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (notif.type === 'bug_resolved' && notif.discord_user_id) {
          const bug = {
            ticket_id: notif.ticket_id,
            title: notif.title,
            discord_user_id: notif.discord_user_id,
            detected_module: null,
            domain: null,
          };
          const sent = await notifyBugResolved(client, bug, notif.fix_notes);
          if (sent) {
            console.log(`Notified ${notif.discord_user} about ${notif.ticket_id} resolution`);
          }
          // Also post to team channel
          const channelId = process.env.NOTIFICATION_CHANNEL_ID;
          if (channelId) {
            const channel = await client.channels.fetch(channelId);
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
              .setColor(0x00ff88)
              .setTitle(`Bug ${notif.ticket_id} Resolved`)
              .setDescription(`**${notif.title}** has been fixed.`)
              .setTimestamp();
            if (notif.fix_notes) {
              embed.addFields({ name: 'Fix Notes', value: notif.fix_notes });
            }
            await channel.send({ embeds: [embed] });
          }
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(`Error processing notification ${file}:`, err.message);
      }
    }
  }, 10000); // Check every 10 seconds
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
