const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBugByTicket, getLinkedImprovements } = require('../utils/database');

const command = new SlashCommandBuilder()
  .setName('bug-status')
  .setDescription('Check the status of a bug report')
  .addStringOption(option =>
    option.setName('ticket')
      .setDescription('Ticket ID (e.g., CB-001)')
      .setRequired(true)
  );

async function execute(interaction) {
  const ticketId = interaction.options.getString('ticket').toUpperCase();
  const bug = getBugByTicket(ticketId);

  if (!bug) {
    await interaction.reply({ content: `Bug **${ticketId}** not found.`, ephemeral: true });
    return;
  }

  const statusEmojis = {
    'open': '🔴',
    'investigating': '🟡',
    'fixed': '🟢',
    'wont-fix': '⚪',
  };

  const severityColors = {
    'Critical': 0xff0000,
    'High': 0xff6600,
    'Medium': 0xffcc00,
    'Low': 0x00ccff,
  };

  const embed = new EmbedBuilder()
    .setColor(severityColors[bug.severity] || 0x7c3aed)
    .setTitle(`${bug.ticket_id}: ${bug.title}`)
    .addFields(
      { name: 'Status', value: `${statusEmojis[bug.status] || '⚪'} ${bug.status}`, inline: true },
      { name: 'Severity', value: bug.severity || 'Medium', inline: true },
      { name: 'Module', value: bug.detected_module || 'Unknown', inline: true },
      { name: 'Domain', value: bug.domain || 'Unknown', inline: true },
      { name: 'UE Version', value: bug.ue_version || 'N/A', inline: true },
      { name: 'CB Version', value: bug.cb_version || 'N/A', inline: true },
      { name: 'Reported', value: `<t:${Math.floor(new Date(bug.created_at).getTime() / 1000)}:R>`, inline: true },
      { name: 'Reporter', value: bug.discord_user || 'Unknown', inline: true },
    )
    .setFooter({ text: 'ClaudusBridge Bug Tracker | Galidar Studio' })
    .setTimestamp();

  // Check for linked improvements
  const improvements = getLinkedImprovements(bug.id);
  if (improvements.length > 0) {
    const impText = improvements.map(i =>
      `**${i.task_id}**: ${i.title} (${i.status})`
    ).join('\n');
    embed.addFields({ name: 'Linked Improvements', value: impText });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { command, execute };
