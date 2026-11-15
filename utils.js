// utils.js
const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./bot_database.sqlite');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS user_wallets (
        user_id TEXT PRIMARY KEY,
        public_key TEXT,
        secret_key TEXT
    )`);
});

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

function getUserWallet(userId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM user_wallets WHERE user_id = ?`, [userId], (err, row) => {
            if (err) return reject(err);
            if (row) {
                const secretKey = Uint8Array.from(JSON.parse(row.secret_key));
                resolve(Keypair.fromSecretKey(secretKey));
            } else {
                const newWallet = Keypair.generate();
                const secretKeyString = JSON.stringify(Array.from(newWallet.secretKey));
                db.run(`INSERT INTO user_wallets (user_id, public_key, secret_key) VALUES (?, ?, ?)`,
                    [userId, newWallet.publicKey.toBase58(), secretKeyString],
                    (err) => {
                        if (err) return reject(err);
                        resolve(newWallet);
                    }
                );
            }
        });
    });
}

async function getSolBalance(publicKeyString) {
    try {
        const pubKey = new PublicKey(publicKeyString);
        const balance = await connection.getBalance(pubKey);
        return balance / LAMPORTS_PER_SOL;
    } catch (error) {
        console.error('Error fetching balance:', error);
        return 0;
    }
}

async function withdrawSol(userKeypair, recipientAddress, amountInSol) {
    try {
        const recipientPubKey = new PublicKey(recipientAddress);
        const lamportsToSend = Math.floor(amountInSol * LAMPORTS_PER_SOL);

        const balance = await connection.getBalance(userKeypair.publicKey);
        if (balance < lamportsToSend + 5000) {
            throw new Error('Insufficient balance (including network fee buffer).');
        }

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: userKeypair.publicKey,
                toPubkey: recipientPubKey,
                lamports: lamportsToSend,
            })
        );

        const signature = await sendAndConfirmTransaction(connection, transaction, [userKeypair]);
        return signature;
    } catch (error) {
        throw error;
    }
}

module.exports = { getUserWallet, getSolBalance, withdrawSol, connection };
