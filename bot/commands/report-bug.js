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
const { createBug, registerFabOrder } = require('../utils/database');
const { parseLog } = require('../utils/log-parser');
const { postToTeamChannel, postFraudAlert } = require('../utils/notifier');

function verifyFabOrder(orderId, discordUser, discordUserId) {
  if (!orderId || orderId.trim().length === 0) {
    return { valid: false, verified: false, fraud: false, reason: 'FAB Order ID is required. You can find it in your FAB Store purchase confirmation email.' };
  }

  const cleaned = orderId.trim();

  if (cleaned.length < 4) {
    return { valid: false, verified: false, fraud: false, reason: 'Order ID is too short. Please enter your full FAB Store order number.' };
  }

  // Check DB registry - detects if another user already claimed this order
  const result = registerFabOrder(cleaned, discordUser, discordUserId);

  if (result.fraud) {
    return {
      valid: false, verified: false, fraud: true,
      original_user: result.original_user,
      reason: `This FAB Order ID is already registered to another account. If you believe this is an error, contact support in #general.`,
    };
  }

  const looksLegit = /^[A-Za-z0-9\-_]{6,}$/.test(cleaned) || /\d{6,}/.test(cleaned);

  return {
    valid: true,
    verified: looksLegit,
    fraud: false,
    reason: looksLegit ? 'Format verified' : 'Pending manual verification',
  };
}

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

  const fabOrderInput = new TextInputBuilder()
    .setCustomId('bug-fab-order')
    .setLabel('FAB Store Order ID (proof of purchase)')
    .setPlaceholder('e.g., FAB-1234567890 or your order number')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

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
    new ActionRowBuilder().addComponents(fabOrderInput),
    new ActionRowBuilder().addComponents(stepsInput),
  );

  await interaction.showModal(modal);
}

async function handleModal(interaction, client) {
  const title = interaction.fields.getTextInputValue('bug-title');
  const errorLog = interaction.fields.getTextInputValue('bug-log');
  const ueVersion = interaction.fields.getTextInputValue('bug-ue-version');
  const fabOrderId = interaction.fields.getTextInputValue('bug-fab-order') || null;
  const steps = interaction.fields.getTextInputValue('bug-steps') || null;

  // Verify FAB Order ID + fraud detection
  const fabVerification = verifyFabOrder(fabOrderId, interaction.user.tag, interaction.user.id);

  if (fabVerification.fraud) {
    // Silent alert to team channel - user sees generic error
    const notifChannelId = process.env.NOTIFICATION_CHANNEL_ID;
    if (notifChannelId) {
      postFraudAlert(client, notifChannelId, {
        fab_order_id: fabOrderId,
        attempting_user: interaction.user.tag,
        attempting_user_id: interaction.user.id,
        original_user: fabVerification.original_user,
      });
    }
  }

  if (!fabVerification.valid) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('Invalid FAB Order ID')
      .setDescription(fabVerification.reason)
      .addFields(
        { name: 'What you entered', value: fabOrderId || 'empty', inline: true },
        { name: 'Expected format', value: 'Order number from FAB Store purchase confirmation email', inline: true },
      )
      .setFooter({ text: 'Need help? Contact support in #general | Galidar Studio' });

    return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
  }

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
    cb_version: null,
    domain: parsed.domain,
    detected_module: parsed.module,
    steps_to_reproduce: steps,
    severity,
    discord_user: interaction.user.tag,
    discord_user_id: interaction.user.id,
    message_id: null,
    fab_order_id: fabOrderId,
    fab_verified: fabVerification.verified,
  });

  // Sync to Worker (Cloudflare D1)
  try {
    const bugData = JSON.stringify({
      title, error_log: errorLog, ue_version: ueVersion, cb_version: null,
      domain: parsed.domain, detected_module: parsed.module,
      steps_to_reproduce: steps, severity,
      discord_user: interaction.user.tag, discord_user_id: interaction.user.id,
      fab_order_id: fabOrderId, fab_verified: fabVerification.verified ? 1 : 0,
    });
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.WORKER_API_KEY) headers['Authorization'] = `Bearer ${process.env.WORKER_API_KEY}`;

    const workerUrl = process.env.WORKER_URL;
    if (workerUrl) {
      fetch(`${workerUrl}/api/bugs`, { method: 'POST', headers, body: bugData }).catch(() => {});
    }
  } catch (_) {}

  // Build confirmation embed
  const severityColors = {
    'Critical': 0xff0000,
    'High': 0xff6600,
    'Medium': 0xffcc00,
    'Low': 0x00ccff,
  };

  const verifiedBadge = fabVerification.verified ? '✅ Verified Purchase' : '⏳ Pending Verification';

  const embed = new EmbedBuilder()
    .setColor(severityColors[severity] || 0x7c3aed)
    .setTitle(`Bug Report Created: ${bug.ticket_id}`)
    .setDescription(`**${title}**`)
    .addFields(
      { name: 'Severity', value: severity, inline: true },
      { name: 'UE Version', value: ueVersion, inline: true },
      { name: 'FAB Purchase', value: verifiedBadge, inline: true },
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
