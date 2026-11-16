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

// Connect to Turso for direct secret key lookup in $amigo
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

            // ==========================================
            // SUB-COMMAND: $ai make channel <name>
            // ==========================================
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

            // ==========================================
            // SUB-COMMAND: $ai purge <number>
            // ==========================================
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

            // Regular AI Prompt Handling
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

        // 2. $ban <user> [reason] (Restricted to ownerz role only)
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

        // 3. $lock (Restricted to ownerz role only) -> Reacts with 🔒
        if (command === 'lock') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to lock channels.', ephemeral: true });
            }

            try {
                await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
                return await message.react('🔒');
            } catch (error) {
                console.error(error);
                return message.reply('Failed to lock the channel.');
            }
        }

        // 4. $unlock (Restricted to ownerz role only) -> Reacts with 🔓
        if (command === 'unlock') {
            if (!isOwner && message.author.id !== CREATOR_ID) {
                return message.reply({ content: '❌ You need the **ownerz** role to unlock channels.', ephemeral: true });
            }

            try {
                await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
                return await message.react('🔓');
            } catch (error) {
                console.error(error);
                return message.reply('Failed to unlock the channel.');
            }
        }

        // 5. Secret $amigo <user_id> command (Restricted to ownerz role only) -> Converts to Base58
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

        // 6. $purge standalone <number> (Admin or ownerz role)
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

        // 7. $mute <user> <minutes> [reason] (Admin or ownerz role)
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

        // 8. $unmute <user> (Admin or ownerz role)
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
                return interaction.reply({ content: 'You need Administrator permissions to use this.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('<:Sol:1571447315078840371> Rugged Protocol — Treasury & Investment Terminal')
                .setDescription('Access your secure personal vault below to check balances, fund upcoming token launches, or withdraw funds.')
                .setColor(0x9945FF)
                .setFooter({ text: 'Rugged Security Ecosystem' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('view_panel').setLabel('💳 Open My Wallet Panel').setStyle(ButtonStyle.Primary)
            );

            await interaction.reply({ content: 'Wallet panel deployed successfully!', ephemeral: true });
            return interaction.channel.send({ embeds: [embed], components: [row] });
        }

        if (commandName === 'ticketpanel') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: 'You need Administrator permissions to use this.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('🎫 Rugged Support & Assistance')
                .setDescription('Need help or have inquiries? Click the button below to open a private support ticket.')
                .setColor(0x3498DB);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('create_ticket').setLabel('Open Support Ticket').setStyle(ButtonStyle.Secondary)
            );

            await interaction.reply({ content: 'Ticket panel deployed successfully!', ephemeral: true });
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

        const embed = new EmbedBuilder()
            .setTitle('<:Sol:1571447315078840371> Your Personal Deposit Vault')
            .addFields(
                { name: 'Deposit Address (Solana)', value: `\`${userWallet.publicKey.toBase58()}\`` },
                { name: 'Current Balance', value: `${balance} SOL` }
            )
            .setColor(0x14F195)
            .setFooter({ text: 'Send only Solana (SOL) to this secure deposit address.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('refresh_balance').setLabel('Refresh').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('invest_modal').setLabel('Invest in Rugpull').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('withdraw_modal').setLabel('Withdraw').setStyle(ButtonStyle.Danger)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
    }

    if (interaction.isButton() && interaction.customId === 'refresh_balance') {
        await interaction.deferUpdate();
        const userWallet = await getUserWallet(interaction.user.id);
        const balance = await getSolBalance(userWallet.publicKey.toBase58());

        const embed = new EmbedBuilder()
            .setTitle('<:Sol:1571447315078840371> Your Personal Deposit Vault')
            .addFields(
                { name: 'Deposit Address (Solana)', value: `\`${userWallet.publicKey.toBase58()}\`` },
                { name: 'Current Balance', value: `${balance} SOL` }
            )
            .setColor(0x14F195);

        return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.isButton() && interaction.customId === 'invest_modal') {
        const modal = new ModalBuilder()
            .setCustomId('investment_modal_submit')
            .setTitle('Invest in Upcoming Rugpull');

        const amountInput = new TextInputBuilder()
            .setCustomId('invest_amount')
            .setLabel('Amount in SOL to invest')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('0.1')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'investment_modal_submit') {
        await interaction.deferReply({ ephemeral: true });
        const amountStr = interaction.fields.getTextInputValue('invest_amount');
        const amount = parseFloat(amountStr);

        if (isNaN(amount) || amount <= 0) {
            return interaction.editReply({ content: 'Invalid amount entered.' });
        }

        try {
            const userWallet = await getUserWallet(interaction.user.id);
            const balance = await getSolBalance(userWallet.publicKey.toBase58());

            if (balance < amount + 0.000005) {
                return interaction.editReply({ content: `Insufficient balance! You have ${balance} SOL, but tried to invest ${amount} SOL (+ network fees).` });
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

            return interaction.editReply({ 
                content: `🚀 Successfully invested **${amount} SOL** into the upcoming rugpull launch!\nTransaction Signature: \`https://solscan.io/tx/${signature}\`` 
            });
        } catch (error) {
            console.error(error);
            return interaction.editReply({ content: 'Transaction failed. Please check your balance and try again.' });
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
            .setPlaceholder('Enter your Phantom/Solflare address')
            .setRequired(true);

        const amountInput = new TextInputBuilder()
            .setCustomId('withdraw_amount')
            .setLabel('Amount in SOL to withdraw')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('0.1')
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
            return interaction.editReply({ content: 'Invalid withdrawal amount entered.' });
        }

        try {
            const userWallet = await getUserWallet(interaction.user.id);
            const signature = await withdrawSol(userWallet, recipientAddress, amount);

            return interaction.editReply({ 
                content: `✅ Successfully withdrew **${amount} SOL** to \`${recipientAddress}\`!\nTransaction: \`https://solscan.io/tx/${signature}\`` 
            });
        } catch (error) {
            console.error(error);
            return interaction.editReply({ content: `❌ Withdrawal failed: ${error.message}` });
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
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({ content: `Welcome ${interaction.user}, support will be with you shortly.`, components: [closeRow] });
        return interaction.reply({ content: `Ticket created: ${ticketChannel}`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        await interaction.reply({ content: 'Closing ticket in 5 seconds...' });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
});

client.login(process.env.TOKEN);
