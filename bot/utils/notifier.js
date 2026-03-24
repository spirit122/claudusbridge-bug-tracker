const { EmbedBuilder } = require('discord.js');

/**
 * Send a DM to the user who reported a bug when it's resolved
 * @param {Client} client - Discord client
 * @param {Object} bug - Bug report from database
 * @param {string} fixNotes - Optional notes about the fix
 */
async function notifyBugResolved(client, bug, fixNotes) {
  if (!bug.discord_user_id) return;

  try {
    const user = await client.users.fetch(bug.discord_user_id);
    const embed = new EmbedBuilder()
      .setColor(0x00ff88)
      .setTitle(`Bug ${bug.ticket_id} Resolved!`)
      .setDescription(`Your bug report **"${bug.title}"** has been resolved.`)
      .addFields(
        { name: 'Module', value: bug.detected_module || 'N/A', inline: true },
        { name: 'Domain', value: bug.domain || 'N/A', inline: true },
      )
      .setFooter({ text: 'ClaudusBridge Bug Tracker | Galidar Studio' })
      .setTimestamp();

    if (fixNotes) {
      embed.addFields({ name: 'Fix Notes', value: fixNotes });
    }

    await user.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error(`Failed to DM user ${bug.discord_user_id}:`, err.message);
    return false;
  }
}

/**
 * Post a bug report summary to the team notification channel
 * @param {Client} client - Discord client
 * @param {string} channelId - Notification channel ID
 * @param {Object} bug - Bug report from database
 */
async function postToTeamChannel(client, channelId, bug) {
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);

    const severityColors = {
      'Critical': 0xff0000,
      'High': 0xff6600,
      'Medium': 0xffcc00,
      'Low': 0x00ccff,
    };

    const embed = new EmbedBuilder()
      .setColor(severityColors[bug.severity] || 0x7c3aed)
      .setTitle(`New Bug Report: ${bug.ticket_id}`)
      .setDescription(`**${bug.title}**`)
      .addFields(
        { name: 'Severity', value: bug.severity || 'Medium', inline: true },
        { name: 'UE Version', value: bug.ue_version || 'N/A', inline: true },
        { name: 'CB Version', value: bug.cb_version || 'N/A', inline: true },
        { name: 'Domain', value: bug.domain || 'Auto-detected', inline: true },
        { name: 'Detected Module', value: bug.detected_module || 'Unknown', inline: true },
        { name: 'Reporter', value: bug.discord_user || 'Unknown', inline: true },
      )
      .setFooter({ text: 'ClaudusBridge Bug Tracker' })
      .setTimestamp();

    if (bug.error_log) {
      const logPreview = bug.error_log.length > 500
        ? bug.error_log.substring(0, 500) + '...'
        : bug.error_log;
      embed.addFields({ name: 'Error Log Preview', value: `\`\`\`\n${logPreview}\n\`\`\`` });
    }

    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error('Failed to post to team channel:', err.message);
    return false;
  }
}

/**
 * Post a PRIVATE fraud alert to the team channel when someone tries to use another user's FAB Order ID
 */
async function postFraudAlert(client, channelId, { fab_order_id, attempting_user, attempting_user_id, original_user }) {
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('FRAUD ALERT: Duplicate FAB Order ID')
      .setDescription(`Someone tried to use a FAB Order ID that belongs to another user.`)
      .addFields(
        { name: 'FAB Order ID', value: `\`${fab_order_id}\``, inline: false },
        { name: 'Attempted By', value: `${attempting_user} (<@${attempting_user_id}>)`, inline: true },
        { name: 'Original Owner', value: `${original_user}`, inline: true },
        { name: 'Action Taken', value: 'Bug report was **rejected**. The attempt has been logged.', inline: false },
      )
      .setFooter({ text: 'ClaudusBridge Anti-Piracy | This alert is only visible to the team' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to post fraud alert:', err.message);
  }
}

module.exports = { notifyBugResolved, postToTeamChannel, postFraudAlert };
