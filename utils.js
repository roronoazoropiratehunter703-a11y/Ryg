// utils.js
const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./bot_database.sqlite');

// Initialize Database Table for User Wallets
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS user_wallets (
        user_id TEXT PRIMARY KEY,
        public_key TEXT,
        secret_key TEXT
    )`);
});

// Solana Mainnet Connection
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

// Get or create a unique deposit wallet for a user
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

// Fetch SOL balance for any public key
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

module.exports = { getUserWallet, getSolBalance, connection };
