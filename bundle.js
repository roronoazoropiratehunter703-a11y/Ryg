// bundle.js
const { EmbedBuilder } = require('discord.js');
const { Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getUserWallet, connection } = require('./utils');
const bs58 = require('bs58');

// Jito Block Engine endpoints (Solana mainnet-beta)
const JITO_BLOCK_ENGINES = [
    'https://mainnet.block-engine.jito.wtf',
    'https://amsterdam.mainnet.block-engine.jito.wtf',
    'https://frankfurt.mainnet.block-engine.jito.wtf',
    'https://tokyo.mainnet.block-engine.jito.wtf'
];

async function handleBundleCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const mintStr = interaction.options.getString('mint');
    const totalSol = interaction.options.getNumber('amount');
    const walletCount = interaction.options.getInteger('wallets') || 3;

    if (walletCount <= 0 || walletCount > 10) {
        return interaction.editReply({ content: '❌ Sub-wallet count must be between 1 and 10.' });
    }

    try {
        // Fetch the user's primary custodial vault wallet
        const userWallet = await getUserWallet(interaction.user.id);
        const solPerWallet = totalSol / walletCount;

        let statusText = `⚡ **Initializing Jito Bundle Execution...**\n• Target Mint: \`${mintStr}\`\n• Total Allocation: \`${totalSol} SOL\` across \`${walletCount}\` sub-wallets\n\n`;
        await interaction.editReply({ content: statusText });

        // Generate temporary Jito sub-wallets for atomic execution
        const subWallets = [];
        const instructions = [];

        for (let i = 0; i < walletCount; i++) {
            const subWallet = Keypair.generate();
            subWallets.push(subWallet);

            // Fund sub-wallet from user's primary custody vault
            instructions.push(
                SystemProgram.transfer({
                    fromPubkey: userWallet.publicKey,
                    toPubkey: subWallet.publicKey,
                    lamports: Math.floor(solPerWallet * LAMPORTS_PER_SOL),
                })
            );
        }

        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        const transaction = new Transaction();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = userWallet.publicKey;
        transaction.add(...instructions);

        // Sign with primary wallet
        transaction.sign(userWallet);

        // Serialize transaction for submission
        const serializedTx = transaction.serialize();
        const base58Tx = bs58.encode(serializedTx);

        // Submit bundle to Jito Block Engines
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
            .setTitle('🚀 JITO ATOMIC BUNDLE DEPLOYED')
            .setDescription('Transaction successfully routed for block-0 inclusion via Jito MEV engine.')
            .addFields(
                { name: '🪙 Mint Address', value: `\`${mintStr}\``, inline: false },
                { name: '📦 Bundle ID / Signature', value: `\`\`\`${responseSignature}\`\`\``, inline: false },
                { name: '🔗 Explorer', value: `[View on Solscan](https://solscan.io/tx/${responseSignature})`, inline: true }
            )
            .setColor(0x14F195)
            .setFooter({ text: 'Rugged Protocol Execution Engine' });

        return interaction.editReply({ content: null, embeds: [successEmbed] });

    } catch (error) {
        console.error('Bundle execution error:', error);
        return interaction.editReply({ content: `❌ **Bundle Execution Failed:** ${error.message}` });
    }
}

module.exports = { handleBundleCommand };
