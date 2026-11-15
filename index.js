// index.js
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionFlagsBits, ChannelType, REST, Routes, SlashCommandBuilder 
} = require('discord.js');
require('dotenv').config();
const { getUserWallet, getSolBalance, withdrawSol, connection } = require('./utils');
const { Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Automatically register the /panel slash command on startup
    const commands = [
        new SlashCommandBuilder()
            .setName('panel')
            .setDescription('Deploys the Solana deposit and investment panel (Admin only)')
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        console.log('Started refreshing application (/) commands for your server.');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    // 1. /panel command (Admin Only)
    if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'You need Administrator permissions to use this.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('💎 Solana Investment & Deposit Panel')
            .setDescription('Click below to view your unique deposit address, check your balance, invest, withdraw, or open a support ticket.')
            .setColor(0x9945FF);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('view_panel').setLabel('My Deposit Panel').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('create_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ content: 'Panel deployed successfully!', ephemeral: true });
        return interaction.channel.send({ embeds: [embed], components: [row] });
    }

    // 2. Button: View Unique Panel & Balance
    if (interaction.isButton() && interaction.customId === 'view_panel') {
        await interaction.deferReply({ ephemeral: true });
        const userWallet = await getUserWallet(interaction.user.id);
        const balance = await getSolBalance(userWallet.publicKey.toBase58());

        const embed = new EmbedBuilder()
            .setTitle('Your Personal Deposit Vault')
            .addFields(
                { name: 'Deposit Address (Solana)', value: `\`${userWallet.publicKey.toBase58()}\`` },
                { name: 'Current Balance', value: `${balance} SOL` }
            )
            .setColor(0x14F195)
            .setFooter({ text: 'Send only Solana (SOL) to this address.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('refresh_balance').setLabel('Refresh').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('invest_modal').setLabel('Invest').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('withdraw_modal').setLabel('Withdraw').setStyle(ButtonStyle.Danger)
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // 3. Button: Refresh Balance Check
    if (interaction.isButton() && interaction.customId === 'refresh_balance') {
        await interaction.deferUpdate();
        const userWallet = await getUserWallet(interaction.user.id);
        const balance = await getSolBalance(userWallet.publicKey.toBase58());

        const embed = new EmbedBuilder()
            .setTitle('Your Personal Deposit Vault')
            .addFields(
                { name: 'Deposit Address (Solana)', value: `\`${userWallet.publicKey.toBase58()}\`` },
                { name: 'Current Balance', value: `${balance} SOL` }
            )
            .setColor(0x14F195);

        return interaction.editReply({ embeds: [embed] });
    }

    // 4. Button: Open Investment Modal
    if (interaction.isButton() && interaction.customId === 'invest_modal') {
        const modal = new ModalBuilder()
            .setCustomId('investment_modal_submit')
            .setTitle('Invest in Community Round');

        const amountInput = new TextInputBuilder()
            .setCustomId('invest_amount')
            .setLabel('Amount in SOL to invest')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('0.1')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        return interaction.showModal(modal);
    }

    // 5. Modal Submit: Forward SOL from User Wallet to Main Owner Wallet
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
                content: `Success! Invested **${amount} SOL**. \nTransaction Signature: \`https://solscan.io/tx/${signature}\`` 
            });
        } catch (error) {
            console.error(error);
            return interaction.editReply({ content: 'Transaction failed. Please check your balance and try again.' });
        }
    }

    // 6. Button: Open Withdraw Modal
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

    // 7. Modal Submit: Process User Withdrawal
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

    // 8. Ticket Tool: Create Private Channel
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

    // 9. Ticket Tool: Close Channel
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
        await interaction.reply({ content: 'Closing ticket in 5 seconds...' });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
});

client.login(process.env.TOKEN);
