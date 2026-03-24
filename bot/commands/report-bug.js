const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const { createBug } = require('../utils/database');
const { parseLog } = require('../utils/log-parser');
const { postToTeamChannel } = require('../utils/notifier');

const command = new SlashCommandBuilder()
  .setName('report-bug')
  .setDescription('Report a ClaudusBridge bug with your error log');

// Store pending reports (user selections before modal)
const pendingReports = new Map();

async function execute(interaction) {
  // Show modal for text inputs
  const modal = new ModalBuilder()
    .setCustomId('bug-report-modal')
    .setTitle('ClaudusBridge Bug Report');

  const titleInput = new TextInputBuilder()
    .setCustomId('bug-title')
    .setLabel('Bug Title')
    .setPlaceholder('Brief description of the issue')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const logInput = new TextInputBuilder()
    .setCustomId('bug-log')
    .setLabel('Error Log')
    .setPlaceholder('Paste your UE Output Log error here')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const versionInput = new TextInputBuilder()
    .setCustomId('bug-ue-version')
    .setLabel('Unreal Engine Version')
    .setPlaceholder('e.g., 5.7, 5.6, 5.5')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);

  const cbVersionInput = new TextInputBuilder()
    .setCustomId('bug-cb-version')
    .setLabel('ClaudusBridge Version')
    .setPlaceholder('e.g., 0.2.0')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(20);

  const stepsInput = new TextInputBuilder()
    .setCustomId('bug-steps')
    .setLabel('Steps to Reproduce')
    .setPlaceholder('1. Open Blueprint editor\n2. Use tool X\n3. Error occurs')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(logInput),
    new ActionRowBuilder().addComponents(versionInput),
    new ActionRowBuilder().addComponents(cbVersionInput),
    new ActionRowBuilder().addComponents(stepsInput),
  );

  await interaction.showModal(modal);
}

async function handleModal(interaction, client) {
  const title = interaction.fields.getTextInputValue('bug-title');
  const errorLog = interaction.fields.getTextInputValue('bug-log');
  const ueVersion = interaction.fields.getTextInputValue('bug-ue-version');
  const cbVersion = interaction.fields.getTextInputValue('bug-cb-version') || null;
  const steps = interaction.fields.getTextInputValue('bug-steps') || null;

  // Auto-detect module from error log
  const parsed = parseLog(errorLog);

  // Determine severity from log content
  let severity = 'Medium';
  if (/crash|fatal|assert|exception|access violation/i.test(errorLog)) {
    severity = 'Critical';
  } else if (/error|failed|nullptr|invalid/i.test(errorLog)) {
    severity = 'High';
  } else if (/warning|deprecated/i.test(errorLog)) {
    severity = 'Low';
  }

  // Save to database
  const bug = createBug({
    title,
    error_log: errorLog,
    ue_version: ueVersion,
    cb_version: cbVersion,
    domain: parsed.domain,
    detected_module: parsed.module,
    steps_to_reproduce: steps,
    severity,
    discord_user: interaction.user.tag,
    discord_user_id: interaction.user.id,
    message_id: null,
  });

  // Sync to Worker (Cloudflare D1) + local dashboard
  try {
    const bugData = JSON.stringify({
      title, error_log: errorLog, ue_version: ueVersion, cb_version: cbVersion,
      domain: parsed.domain, detected_module: parsed.module,
      steps_to_reproduce: steps, severity,
      discord_user: interaction.user.tag, discord_user_id: interaction.user.id,
    });
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.WORKER_API_KEY) headers['Authorization'] = `Bearer ${process.env.WORKER_API_KEY}`;

    // POST to Cloudflare Worker
    const workerUrl = process.env.WORKER_URL;
    if (workerUrl) {
      fetch(`${workerUrl}/api/bugs`, { method: 'POST', headers, body: bugData }).catch(() => {});
    }

    // POST to local dashboard
    const http = require('http');
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/api/bugs',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bugData) },
    });
    req.on('error', () => {});
    req.write(bugData);
    req.end();
  } catch (_) {}

  // Build confirmation embed
  const severityColors = {
    'Critical': 0xff0000,
    'High': 0xff6600,
    'Medium': 0xffcc00,
    'Low': 0x00ccff,
  };

  const embed = new EmbedBuilder()
    .setColor(severityColors[severity] || 0x7c3aed)
    .setTitle(`Bug Report Created: ${bug.ticket_id}`)
    .setDescription(`**${title}**`)
    .addFields(
      { name: 'Severity', value: severity, inline: true },
      { name: 'UE Version', value: ueVersion, inline: true },
      { name: 'CB Version', value: cbVersion || 'N/A', inline: true },
      { name: 'Detected Module', value: parsed.module || 'Unknown', inline: true },
      { name: 'Domain', value: parsed.domain || 'Unknown', inline: true },
      { name: 'Status', value: 'Open', inline: true },
    )
    .setFooter({ text: `Track with /bug-status ${bug.ticket_id} | Galidar Studio` })
    .setTimestamp();

  if (parsed.allMatches.length > 1) {
    const otherModules = parsed.allMatches.slice(1).map(m => `${m.module} (${m.domain})`).join(', ');
    embed.addFields({ name: 'Other Modules Detected', value: otherModules });
  }

  await interaction.reply({ embeds: [embed], ephemeral: false });

  // Post to team channel
  const notifChannelId = process.env.NOTIFICATION_CHANNEL_ID;
  if (notifChannelId) {
    await postToTeamChannel(client, notifChannelId, bug);
  }
}

module.exports = { command, execute, handleModal };
