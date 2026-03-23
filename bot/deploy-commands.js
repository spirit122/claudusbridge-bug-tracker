require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { command: reportBug } = require('./commands/report-bug');
const { command: bugStatus } = require('./commands/bug-status');

const commands = [reportBug.toJSON(), bugStatus.toJSON()];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash commands...`);

    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );

    console.log(`Successfully registered ${data.length} commands.`);
  } catch (error) {
    console.error('Error registering commands:', error);
  }
})();
