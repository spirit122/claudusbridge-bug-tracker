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

  // Poll for resolved bug notifications from Worker API + local fallback
  const notifDir = path.join(__dirname, '..', 'data', 'notifications');
  setInterval(async () => {
    const notifications = [];

    // Poll Worker API
    const workerUrl = process.env.WORKER_URL;
    if (workerUrl) {
      try {
        const res = await fetch(`${workerUrl}/api/notifications`);
        if (res.ok) {
          const data = await res.json();
          for (const notif of (data.notifications || [])) {
            notifications.push({ ...notif, source: 'worker' });
          }
        }
      } catch (_) {}
    }

    // Poll local files (fallback for MCP)
    if (fs.existsSync(notifDir)) {
      const files = fs.readdirSync(notifDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(notifDir, file), 'utf-8'));
          notifications.push({ ...data, source: 'local', file });
        } catch (_) {}
      }
    }

    for (const notif of notifications) {
      try {
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
            console.log(`Notified ${notif.discord_user || notif.discord_user_id} about ${notif.ticket_id} resolution`);
          }
          // Post to team channel
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
          // Clean up source
          if (notif.source === 'worker' && workerUrl) {
            const headers = {};
            if (process.env.WORKER_API_KEY) headers['Authorization'] = `Bearer ${process.env.WORKER_API_KEY}`;
            fetch(`${workerUrl}/api/notifications/${notif.id}`, { method: 'DELETE', headers }).catch(() => {});
          } else if (notif.source === 'local' && notif.file) {
            fs.unlinkSync(path.join(notifDir, notif.file));
          }
        }
      } catch (err) {
        console.error(`Error processing notification:`, err.message);
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
