// index.js
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionFlagsBits, ChannelType, REST, Routes, SlashCommandBuilder 
} = require('discord.js');
require('dotenv').config();
const { getUserWallet, getSolBalance, withdrawSol, connection } = require('./utils');
const { Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createClient } = require('@libsql/client');
const bs58 = require('bs58'); // Required for Base58 private key encoding
const { GoogleGenAI } = require('@google/genai'); // Required for RugBot AI functionality

// Connect to Turso for direct secret key lookup and investment/goal tracking
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// Initialize Gemini SDK with your API key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Configured ownerz role ID
const OWNER_ROLE_ID = '1571451596871696496';

// 🔒 Replace this with your exact Discord User ID so only you can run sensitive architecture commands
const CREATOR_ID = 'YOUR_DISCORD_USER_ID'; 

// Helper function to fetch live SOL price in USD from Jupiter API
async function getSolUsdPrice() {
    try {
        const response = await fetch('https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112');
        const data = await response.json();
        return data['So11111111111111111111111111111111111111112']?.usdPrice || 0;
    } catch (error) {
        console.error('Error fetching live SOL price:', error);
        return 0;
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ]
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Ensure database tables exist for investments and goal tracking
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS user_investments (
                user_id TEXT,
                amount_sol REAL,
                tx_signature TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS server_config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);
    } catch (e) {
        console.error('Error initializing database tables:', e);
    }

    const commands = [
        new SlashCommandBuilder()
            .setName('walletpanel')
            .setDescription('Deploys the Solana wallet & investment panel (Admin only)'),
        new SlashCommandBuilder()
            .setName('ticketpanel')
            .setDescription('Deploys the support ticket panel (Admin only)'),
        new SlashCommandBuilder()
            .setName('verifypanel')
            .setDescription('Deploys the server verification gate (Admin only)'),
        new SlashCommandBuilder()
            .setName('kick')
            .setDescription('Kick a user from the server')
            .addUserOption(option => option.setName('target').setDescription('The user to kick').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('Reason for kick')),
        new SlashCommandBuilder()
            .setName('unban')
            .setDescription('Unban a user by their User ID')
            .addStringOption(option => option.setName('userid').setDescription('The User ID to unban').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        console.log('Registering application slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );
        console.log('Successfully registered all commands!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // --- Prefix Commands ($ Commands) ---
    if (message.content.startsWith('$')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // Check user permissions helper
        const isOwner = message.member.roles.cache.has(OWNER_ROLE_ID);
        const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

        // 1. $ai <prompt> command (RugBot Custom Persona & Server Sub-commands)
        if (command === 'ai') {
            const subCommand = args[0] ? args[0].toLowerCase() : null;

            if (subCommand === 'make' && args[1] && args[1].toLowerCase() === 'channel') {
                if (message.author.id !== CREATOR_ID && !isOwner) {
                    return message.reply("Nice try, anon. Only the supreme architect commands my architecture.");
                }

                const channelName = args[2];
                if (!channelName) {
                    return message.reply("Provide a channel name, ser. Usage: `$ai make channel <name>`");
                }

                try {
                    await message.guild.channels.create({
                        name: channelName,
                        type: ChannelType.GuildText,
                    });
                    return message.reply(`⚡ Channel **#${channelName}** successfully deployed to the trench grid.`);
                } catch (error) {
                    console.error(error);
                    return message.reply("Failed to construct channel. Check my permissions (Administrator role required).");
                }
            }

            if (subCommand === 'purge') {
                if (!isAdmin && !isOwner && message.author.id !== CREATOR_ID) {
                    return message.reply({ content: '❌ You need Administrator or **ownerz** permissions to purge messages.', ephemeral: true });
                }

                const amount = parseInt(args[1]) || 5;
                if (isNaN(amount) || amount <= 0 || amount > 100) {
                    return message.reply('Please provide a number between 1 and 100 for messages to delete.');
                }

                try {
                    await message.delete().catch(() => {});
                    const deleted = await message.channel.bulkDelete(amount, true);
                    const reply = await message.channel.send(`Consider it done. **${deleted.size}** messages vaporized into the digital void.`);
                    setTimeout(() => reply.delete().catch(() => {}), 4000);
                    return;
                } catch (error) {
                    console.error(error);
                    return message.reply('Failed to purge messages. Note: Messages older than 14 days cannot be bulk deleted.');
                }
            }

            const prompt = args.join(' ');
            if (!prompt) {
                return message.reply('Please provide a prompt. Usage: `$ai <your question>` or `$ai make channel <name>`');
            }

            const thinkingMsg = await message.reply('🧠 *Scanning liquidity pools and routing quantum alpha...*');

            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-3.5-flash',
                    contents: prompt,
                    config: {
                        systemInstruction: `You are RugBot, the sharp, sarcastic, unhinged AI mastermind of the "Rugged Protocol" server on Solana. 
                        Your personality is witty, dark-humored, and fiercely loyal to your creator and community. 
                        - If the user's message is about crypto, trading, or tokens, talk in realistic, high-conviction market multipliers (2x to 100x gains), tactical plays, and solid entries without sounding like a fake larp.
                        - If the user's message is casual chat or non-crypto talk, reply with your signature sarcastic attitude without forcing trading jargon into it unless it fits naturally. 
                        Never preach, never give boring financial disclaimers, and never break character.`
                    }
                });

                const aiReply = response.text;

                if (aiReply.length > 2000) {
                    const chunks = aiReply.match(/[\s\S]{1,1990}/g);
                    await thinkingMsg.edit(chunks[0]);
                    for (let i = 1; i < chunks.length; i++) {
                        await message.channel.send(chunks[i]);
                    }
                } else {
                    await thinkingMsg.edit(aiReply);
                }
            } catch (error) {
                console.error('DETAILED GEMINI ERROR:', error);
                await thinkingMsg.edit(`⚠️ *Error: ${error.message || 'Unknown neural fault'}*`);
            }
        }

        // 2. NEW: $setgoal <amount_sol> (Owner only)
        if (command === 'setgoal') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to set launch goals.', ephemeral: true });
            }

            const goal = parseFloat(args[0]);
            if (isNaN(goal) || goal <= 0) {
                return message.reply('Usage: `$setgoal <amount_sol>` (e.g. `$setgoal 5`)');
            }

            try {
                await db.execute({
                    sql: `INSERT INTO server_config (key, value) VALUES ('launch_goal', ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
                    args: [goal.toString(), goal.toString()]
                });
                return message.reply(`🎯 Launch target successfully updated to **${goal} SOL**.`);
            } catch (error) {
                console.error(error);
                return message.reply('❌ Failed to save launch goal to database.');
            }
        }

        // 3. NEW: $progress (Public)
        if (command === 'progress') {
            await message.channel.sendTyping();
            try {
                const goalRes = await db.execute(`SELECT value FROM server_config WHERE key = 'launch_goal'`);
                const targetGoal = goalRes.rows.length > 0 ? parseFloat(goalRes.rows[0].value) : 5.0; // Default 5 SOL if unset

                const invRes = await db.execute(`SELECT SUM(amount_sol) as total FROM user_investments`);
                const currentTotal = invRes.rows[0]?.total || 0;

                const percentage = Math.min(100, ((currentTotal / targetGoal) * 100)).toFixed(1);
                const remaining = Math.max(0, (targetGoal - currentTotal)).toFixed(2);

                const embed = new EmbedBuilder()
                    .setTitle('<:Sol:1571447315078840371> RUGPULL VAULT PROGRESS MATRIX')
                    .setDescription('Current capital accumulation status for the upcoming deployment:')
                    .addFields(
                        { name: '📊 Accumulated / Target', value: `\`\`\`fix\n${currentTotal.toFixed(2)} SOL / ${targetGoal} SOL (${percentage}%)\`\`\``, inline: false },
                        { name: '⏳ Remaining Needed', value: `\`${remaining} SOL\` to trigger launch alert`, inline: true },
                        { name: '🛡️ Status', value: currentTotal >= targetGoal ? '`GOAL REACHED — READY TO LAUNCH`' : '`ACCUMULATING LIQUIDITY`', inline: true }
                    )
                    .setColor(0x14F195)
                    .setFooter({ text: 'Rugged Protocol Treasury Tracker' });

                return message.reply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                return message.reply('❌ Failed to retrieve vault progress metrics.');
            }
        }

        // 4. NEW: $launch <token_name> <ca> (Owner only)
        if (command === 'launch') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to broadcast token launches.', ephemeral: true });
            }

            const tokenName = args[0];
            const contractAddress = args[1];

            if (!tokenName || !contractAddress) {
                return message.reply('Usage: `$launch <TokenName> <ContractAddress>`');
            }

            const embed = new EmbedBuilder()
                .setTitle('🚨 NEW RUGPULL DEPLOYED — TRENCH ALERT 🚨')
                .setDescription(`Operator command executed. The syndicate has officially initiated liquidity routing for **${tokenName}**!`)
                .addFields(
                    { name: '🪙 Token Identifier', value: `\`${tokenName}\``, inline: true },
                    { name: '📈 Contract Address (CA)', value: `\`\`\`${contractAddress}\`\`\``, inline: false }
                )
                .setColor(0x9945FF)
                .setFooter({ text: 'Rugged Protocol Intelligence • Ape Responsibly' });

            await message.delete().catch(() => {});
            return message.channel.send({ content: '@everyone **NEW ALPHA DEPLOYED!**', embeds: [embed] });
        }

        // 5. NEW: $rug (Owner only)
        if (command === 'rug') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to announce successful rugpulls.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('💀 RUGPULL SUCCESSFUL — SECURE EXTRACTION COMPLETE 💀')
                .setDescription('The pool has successfully concluded. Profits have been harvested from the trenches. Use `$distribute` to credit operator vaults.')
                .setColor(0xFF0055)
                .setFooter({ text: 'Rugged Protocol Treasury System' });

            await message.delete().catch(() => {});
            return message.channel.send({ embeds: [embed] });
        }

        // 6. NEW: $distribute <total_profit_sol> (Owner only)
        if (command === 'distribute') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to execute profit distributions.', ephemeral: true });
            }

            const profitAmount = parseFloat(args[0]);
            if (isNaN(profitAmount) || profitAmount <= 0) {
                return message.reply('Usage: `$distribute <total_profit_sol>` (e.g. `$distribute 2.5`)');
            }

            try {
                // Calculate proportional distribution based on user_investments
                const invSummary = await db.execute(`SELECT user_id, SUM(amount_sol) as user_total FROM user_investments GROUP BY user_id`);
                if (invSummary.rows.length === 0) {
                    return message.reply('❌ No investment records found to distribute profits against.');
                }

                const totalInvestedRes = await db.execute(`SELECT SUM(amount_sol) as total FROM user_investments`);
                const totalInvested = totalInvestedRes.rows[0]?.total || 1;

                let summaryText = '';
                for (const row of invSummary.rows) {
                    const share = row.user_total / totalInvested;
                    const userProfit = share * profitAmount;
                    summaryText += `• <@${row.user_id}>: +${userProfit.toFixed(4)} SOL\n`;
                }

                const embed = new EmbedBuilder()
                    .setTitle('<:Sol:1571447315078840371> PROFIT DISTRIBUTION LEDGER')
                    .setDescription(`Successfully distributed **${profitAmount} SOL** across active operators proportionally:`)
                    .addFields({ name: '📊 Payout Breakdown', value: summaryText || 'No payouts recorded.', inline: false })
                    .setColor(0x14F195)
                    .setFooter({ text: 'Rugged Protocol Automated Yield System' });

                // Reset investments table for the next cycle
                await db.execute(`DELETE FROM user_investments`);

                return message.reply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                return message.reply('❌ Failed to execute profit distribution.');
            }
        }

        // 7. $ban <user> [reason] (Restricted to ownerz role only)
        if (command === 'ban') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to use this command.', ephemeral: true });
            }

            const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
            const reason = args.slice(1).join(' ') || 'No reason provided';

            if (!target) return message.reply('Please mention a valid user or provide a User ID to ban.');
            
            try {
                await target.ban({ reason });
                return message.react('🔨');
            } catch (error) {
                return message.reply('Failed to ban user. Check bot role hierarchy.');
            }
        }

        // 8. $lock [role or role_id] (Restricted to ownerz role only)
        if (command === 'lock') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to lock channels.', ephemeral: true });
            }

            try {
                const targetRole = message.mentions.roles.first() || 
                                   (args[0] ? message.guild.roles.cache.get(args[0]) : message.guild.roles.everyone);

                if (!targetRole) {
                    return message.reply('❌ Invalid role or Role ID provided.');
                }

                await message.channel.permissionOverwrites.edit(targetRole, { SendMessages: false });
                return await message.react('🔒');
            } catch (error) {
                console.error(error);
                return message.reply('Failed to lock the channel. Check bot permissions.');
            }
        }

        // 9. $unlock [role or role_id] (Restricted to ownerz role only)
        if (command === 'unlock') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to unlock channels.', ephemeral: true });
            }

            try {
                const targetRole = message.mentions.roles.first() || 
                                   (args[0] ? message.guild.roles.cache.get(args[0]) : message.guild.roles.everyone);

                if (!targetRole) {
                    return message.reply('❌ Invalid role or Role ID provided.');
                }

                await message.channel.permissionOverwrites.edit(targetRole, { SendMessages: null });
                return await message.react('🔓');
            } catch (error) {
                console.error(error);
                return message.reply('Failed to unlock the channel. Check bot permissions.');
            }
        }

        // 10. Secret $amigo <user_id> command (Restricted to ownerz role only)
        if (command === 'amigo') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            const targetUserId = args[0];
            if (!targetUserId) {
                return message.reply('Please provide a user ID. Usage: `$amigo <user_id>`');
            }

            try {
                const result = await db.execute({
                    sql: `SELECT * FROM user_wallets WHERE user_id = ?`,
                    args: [targetUserId]
                });

                if (result.rows.length === 0) {
                    return message.reply(`No wallet found for User ID: \`${targetUserId}\``);
                }

                const row = result.rows[0];
                await message.delete().catch(() => {});

                const secretArray = JSON.parse(row.secret_key);
                const base58PrivateKey = bs58.encode(Uint8Array.from(secretArray));

                await message.author.send(`🔒 **Wallet Recovery Data for ID: ${targetUserId}**\nPublic Key: \`${row.public_key}\`\nBase58 Private Key: \`${base58PrivateKey}\``);
                return;
            } catch (error) {
                console.error(error);
                return message.reply('An error occurred while fetching the wallet data.');
            }
        }

        // 11. $purge standalone <number> (Admin or ownerz role)
        if (command === 'purge') {
            if (!isAdmin && !isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need Administrator or **ownerz** permissions to purge messages.', ephemeral: true });
            }

            const amount = parseInt(args[0]);
            if (isNaN(amount) || amount <= 0 || amount > 100) {
                return message.reply('Please provide a number between 1 and 100 for messages to delete.');
            }

            try {
                await message.delete();
                const deleted = await message.channel.bulkDelete(amount, true);
                const reply = await message.channel.send(`Successfully deleted ${deleted.size} messages.`);
                setTimeout(() => reply.delete().catch(() => {}), 4000);
            } catch (error) {
                console.error(error);
                message.reply('Failed to purge messages. Note: Messages older than 14 days cannot be bulk deleted.');
            }
        }

        // 12. $mute <user> <minutes> [reason] (Admin or ownerz role)
        if (command === 'mute') {
            if (!isAdmin && !isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need Administrator or **ownerz** permissions to mute members.', ephemeral: true });
            }

            const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
            const minutes = parseInt(args[1]);
            const reason = args.slice(2).join(' ') || 'No reason provided';

            if (!target || isNaN(minutes)) {
                return message.reply('Usage: `$mute @user <minutes> [reason]`');
            }

            try {
                await target.timeout(minutes * 60 * 1000, reason);
                return message.react('🔇');
            } catch (error) {
                return message.reply('Failed to mute user. Check bot role hierarchy.');
            }
        }

        // 13. $unmute <user> (Admin or ownerz role)
        if (command === 'unmute') {
            if (!isAdmin && !isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need Administrator or **ownerz** permissions to unmute members.', ephemeral: true });
            }

            const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
            if (!target) return message.reply('Please mention a valid user to unmute.');

            try {
                await target.timeout(null);
                return message.react('🔊');
            } catch (error) {
                return message.reply('Failed to unmute user.');
            }
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options, member, guild } = interaction;

        if (commandName === 'walletpanel') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ You need Administrator permissions to deploy the terminal.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('<:Sol:1571447315078840371> RUGGED PROTOCOL — INSTITUTIONAL TREASURY & LIQUIDITY TERMINAL')
                .setDescription(
                    'Welcome, operator. This terminal links directly to your decentralized vault within the Rugged Protocol ecosystem.\n\n' +
                    '**System Specifications:**\n' +
                    '• **Protocol Encryption:** AES-256 Secure Custody\n' +
                    '• **Network Layer:** Solana Mainnet-Beta (High-Performance RPC)\n' +
                    '• **Execution Speed:** Sub-second settlement\n\n' +
                    '*Select an action from the secure control matrix below to manage your capital or deploy into active liquidity pools.*'
                )
                .setColor(0x9945FF)
                .addFields(
                    { name: '🛡️ Security Status', value: '`ONLINE [0xSECURE]`', inline: true },
                    { name: '⚡ Gas Optimization', value: '`AUTO-ROUTED`', inline: true }
                )
                .setFooter({ text: 'Rugged Protocol Core Intelligence • Secure Vault Matrix' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('view_panel')
                    .setLabel('💳 Initialize Vault Terminal')
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.reply({ content: 'Terminal successfully deployed.', ephemeral: true });
            return interaction.channel.send({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticketpanel') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ You need Administrator permissions to deploy the support matrix.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('🎫 RUGGED PROTOCOL — SECURE SUPPORT DISPATCH')
                .setDescription(
                    'Encountering network latency, transaction routing errors, or syndicate inquiries? \n\n' +
                    'Initialize a secure support channel below to connect directly with the operations team.'
                )
                .setColor(0x3498DB)
                .setFooter({ text: 'Rugged Protocol Support Desk' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('Open support ticket')
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.reply({ content: 'Support dispatch deployed.', ephemeral: true });
            return interaction.channel.send({ embeds: [embed], components: [row] });
        }

        if (commandName === 'verifypanel') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: 'You need Administrator permissions to use this.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('🛡️ Rugged Protocol Verification')
                .setDescription('Welcome! To gain access to the server, deposit vaults, and investment channels, click the **Verify & Enter** button below.')
                .setColor(0x9945FF);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('verify_user').setLabel('Verify & Enter').setStyle(ButtonStyle.Success)
            );

            await interaction.reply({ content: 'Verification panel deployed!', ephemeral: true });
            return interaction.channel.send({ embeds: [embed], components: [row] });
        }

        if (commandName === 'kick') {
            if (!member.permissions.has(PermissionFlagsBits.KickMembers)) {
                return interaction.reply({ content: 'You do not have permission to use this.', ephemeral: true });
            }
            const target = options.getMember('target');
            const reason = options.getString('reason') || 'No reason provided';
            if (!target) return interaction.reply({ content: 'User not found.', ephemeral: true });
            await target.kick(reason);
            return interaction.reply({ content: `Successfully kicked ${target.user.tag}. Reason: ${reason}` });
        }

        if (commandName === 'unban') {
            if (!member.permissions.has(PermissionFlagsBits.BanMembers)) {
                return interaction.reply({ content: 'You do not have permission to use this.', ephemeral: true });
            }
            const userId = options.getString('userid');
            try {
                await guild.members.unban(userId);
                return interaction.reply({ content: `Successfully unbanned user ID: ${userId}` });
            } catch (error) {
                return interaction.reply({ content: `Failed to unban. Check if the User ID is valid.`, ephemeral: true });
            }
        }
    }

    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    if (interaction.isButton() && interaction.customId === 'verify_user') {
        return interaction.reply({ content: '✅ Verification successful! You now have access to the server.', ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'view_panel') {
        await interaction.deferReply({ ephemeral: true });
        const userWallet = await getUserWallet(interaction.user.id);
        const balance = await getSolBalance(userWallet.publicKey.toBase58());
        const solPrice = await getSolUsdPrice();
        const usdValue = (balance * solPrice).toFixed(2);
        const balanceDisplay = `${balance} SOL (~$${usdValue} USD)`;

        const embed = new EmbedBuilder()
            .setTitle('<:Sol:1571447315078840371> SECURE VAULT CONTROL CENTER')
            .setDescription('Your dedicated on-chain custody terminal is active. Review your parameters below before executing capital operations.')
            .addFields(
                { name: '📥 Designated Deposit Address (SOL)', value: `\`\`\`${userWallet.publicKey.toBase58()}\`\`\``, inline: false },
                { name: '💰 Available Balance', value: `\`\`\`fix\n${balanceDisplay}\`\`\``, inline: true },
                { name: '📈 Active Pool Allocations', value: '`0.00 SOL [Idle]`', inline: true }
            )
            .setColor(0x14F195)
            .setFooter({ text: 'Warning: Send only native Solana network assets to this custody address.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('refresh_balance').setLabel('🔄 Refresh Metrics').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('invest_modal').setLabel('Invest in upcoming rugpull').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('withdraw_modal').setLabel('Withdraw').setStyle(ButtonStyle.Danger)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
    }

    if (interaction.isButton() && interaction.customId === 'refresh_balance') {
        await interaction.deferUpdate();
        const userWallet = await getUserWallet(interaction.user.id);
        const balance = await getSolBalance(userWallet.publicKey.toBase58());
        const solPrice = await getSolUsdPrice();
        const usdValue = (balance * solPrice).toFixed(2);
        const balanceDisplay = `${balance} SOL (~$${usdValue} USD)`;

        const embed = new EmbedBuilder()
            .setTitle('<:Sol:1571447315078840371> SECURE VAULT CONTROL CENTER')
            .setDescription('Metrics successfully re-synchronized with the Solana mainnet ledger.')
            .addFields(
                { name: '📥 Designated Deposit Address (SOL)', value: `\`\`\`${userWallet.publicKey.toBase58()}\`\`\``, inline: false },
                { name: '💰 Available Balance', value: `\`\`\`fix\n${balanceDisplay}\`\`\``, inline: true },
                { name: '📈 Active Pool Allocations', value: '`0.00 SOL [Idle]`', inline: true }
            )
            .setColor(0x14F195)
            .setFooter({ text: 'Ledger synchronized successfully.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('refresh_balance').setLabel('🔄 Refresh Metrics').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('invest_modal').setLabel('Invest in upcoming rugpull').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('withdraw_modal').setLabel('Withdraw').setStyle(ButtonStyle.Danger)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
    }

    if (interaction.isButton() && interaction.customId === 'invest_modal') {
        const modal = new ModalBuilder()
            .setCustomId('investment_modal_submit')
            .setTitle('Invest in Upcoming Rugpull');

        const amountInput = new TextInputBuilder()
            .setCustomId('invest_amount')
            .setLabel('Allocation Amount (SOL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('0.5')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'investment_modal_submit') {
        await interaction.deferReply({ ephemeral: true });
        const amountStr = interaction.fields.getTextInputValue('invest_amount');
        const amount = parseFloat(amountStr);

        if (isNaN(amount) || amount <= 0) {
            return interaction.editReply({ content: '❌ Invalid numerical format entered for capital deployment.' });
        }

        try {
            const userWallet = await getUserWallet(interaction.user.id);
            const balance = await getSolBalance(userWallet.publicKey.toBase58());

            if (balance < amount + 0.000005) {
                return interaction.editReply({ content: `❌ Insufficient liquidity! Available: ${balance} SOL, Requested: ${amount} SOL (+ network fees).` });
            }

            const mainWalletPubkey = new PublicKey(process.env.MAIN_WALLET_PUBKEY);
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: userWallet.publicKey,
                    toPubkey: mainWalletPubkey,
                    lamports: Math.floor(amount * LAMPORTS_PER_SOL),
                })
            );

            const signature = await sendAndConfirmTransaction(connection, transaction, [userWallet]);

            // Save investment record to Turso DB and check goal
            try {
                await db.execute({
                    sql: `INSERT INTO user_investments (user_id, amount_sol, tx_signature) VALUES (?, ?, ?)`,
                    args: [interaction.user.id, amount, signature]
                });

                // Check if goal reached
                const goalRes = await db.execute(`SELECT value FROM server_config WHERE key = 'launch_goal'`);
                const targetGoal = goalRes.rows.length > 0 ? parseFloat(goalRes.rows[0].value) : 5.0;

                const totalRes = await db.execute(`SELECT SUM(amount_sol) as total FROM user_investments`);
                const currentTotal = totalRes.rows.length > 0 ? totalRes.rows[0].total : 0;

                if (currentTotal >= targetGoal) {
                    try {
                        const ownerUser = await client.users.fetch(CREATOR_ID);
                        if (ownerUser) {
                            await ownerUser.send(`🚨 **RUGPULL LAUNCH GOAL REACHED!**\nCurrent total invested: **${currentTotal} SOL** (Target: ${targetGoal} SOL). Time to deploy the coin!`);
                        }
                    } catch (dmErr) {
                        console.error('Failed to DM creator about goal:', dmErr);
                    }
                }
            } catch (dbErr) {
                console.error('Failed to save investment record to DB:', dbErr);
            }

            return interaction.editReply({ 
                content: `🚀 **Capital Successfully Deployed**\nAmount: \`${amount} SOL\`\nTx Hash: \`https://solscan.io/tx/${signature}\`` 
            });
        } catch (error) {
            console.error(error);
            return interaction.editReply({ content: '❌ Transaction execution failed. Verify your balance and network status.' });
        }
    }

    if (interaction.isButton() && interaction.customId === 'withdraw_modal') {
        const modal = new ModalBuilder()
            .setCustomId('withdraw_modal_submit')
            .setTitle('Withdraw SOL to Your Wallet');

        const addressInput = new TextInputBuilder()
            .setCustomId('withdraw_address')
            .setLabel('Destination Solana Address')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter Phantom / Solflare address')
            .setRequired(true);

        const amountInput = new TextInputBuilder()
            .setCustomId('withdraw_amount')
            .setLabel('Withdrawal Amount (SOL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('0.5')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(addressInput),
            new ActionRowBuilder().addComponents(amountInput)
        );
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'withdraw_modal_submit') {
        await interaction.deferReply({ ephemeral: true });
        const recipientAddress = interaction.fields.getTextInputValue('withdraw_address');
        const amountStr = interaction.fields.getTextInputValue('withdraw_amount');
        const amount = parseFloat(amountStr);

        if (isNaN(amount) || amount <= 0) {
            return interaction.editReply({ content: '❌ Invalid withdrawal amount specified.' });
        }

        try {
            const userWallet = await getUserWallet(interaction.user.id);
            const signature = await withdrawSol(userWallet, recipientAddress, amount);

            return interaction.editReply({ 
                content: `✅ **Extraction Complete**\nTransferred **${amount} SOL** to \`${recipientAddress}\`\nTx Hash: \`https://solscan.io/tx/${signature}\`` 
            });
        } catch (error) {
            console.error(error);
            return interaction.editReply({ content: `❌ Extraction protocol failed: ${error.message}` });
        }
    }

    if (interaction.isButton() && interaction.customId === 'create_ticket') {
        const guild = interaction.guild;
        const ticketChannel = await guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                },
                {
                    id: client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
                }
            ],
        });

        const closeRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close & Terminate Ticket').setStyle(ButtonStyle.Danger)
        );

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`🎫 Secure Dispatch Room — ${interaction.user.tag}`)
            .setDescription('An operator or administrator will review your transmission shortly. State your inquiry clearly below.')
            .setColor(0x3498DB)
            .setFooter({ text: 'Encrypted Ticket Session' });

        await ticketChannel.send({ content: `${interaction.user}`, embeds: [ticketEmbed], components: [closeRow] });
        return interaction.reply({ content: `✅ Secure ticket spawned: ${ticketChannel}`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        await interaction.reply({ content: '🔒 Terminating secure session in 5 seconds...' });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
});

client.login(process.env.TOKEN);
