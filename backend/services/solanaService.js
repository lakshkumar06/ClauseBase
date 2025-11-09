import crypto from 'crypto';
import { Connection, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const idl = JSON.parse(readFileSync(join(__dirname, '../../agreed_contracts/target/idl/agreed_contracts.json'), 'utf8'));

const SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgd6ofga5DgLRkJrFb';
const PROGRAM_ID = new PublicKey(process.env.SOLANA_PROGRAM_ID || '8sRBcQiawsPTmLAcoJPtGAf4gYEszqHLx31DZEtjcinb');

// Generate SHA256 hash of contract content
export function generateContractHash(contractText) {
  return crypto.createHash('sha256').update(contractText, 'utf8').digest('hex');
}

// Store contract proof on Solana devnet
export async function storeContractProofOnChain(contractHash, userWalletAddress, signerPrivateKey) {
  try {
    // Create connection to Solana devnet
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    
    // Create keypair from private key (handle JSON array format from Solana CLI)
    let signer;
    try {
      // First try to decode as base64 JSON array (Solana CLI format)
      const decodedString = Buffer.from(signerPrivateKey, 'base64').toString('utf8');
      const keyArray = JSON.parse(decodedString);
      
      if (Array.isArray(keyArray) && keyArray.length === 64) {
        const privateKeyBytes = Buffer.from(keyArray);
        signer = Keypair.fromSecretKey(privateKeyBytes);
      } else {
        throw new Error('Invalid JSON array format');
      }
    } catch (error) {
      // If JSON parsing fails, try direct base64
      try {
        const privateKeyBytes = Buffer.from(signerPrivateKey, 'base64');
        if (privateKeyBytes.length === 64) {
          signer = Keypair.fromSecretKey(privateKeyBytes);
        } else {
          throw new Error('Invalid base64 length');
        }
      } catch (base64Error) {
        // If base64 fails, try as base58
        try {
          const bs58 = await import('bs58');
          const privateKeyBytes = bs58.default.decode(signerPrivateKey);
          signer = Keypair.fromSecretKey(privateKeyBytes);
        } catch (bs58Error) {
          throw new Error('Invalid private key format. Expected base64-encoded JSON array from Solana CLI.');
        }
      }
    }
    
    // Create memo instruction with contract proof and original author address
    const memoText = `ClausebaseProof:${contractHash}:CreatedBy:${userWalletAddress}`;
    const memoData = Buffer.from(memoText, 'utf8');
    const memoInstruction = new TransactionInstruction({
      keys: [],
      programId: new PublicKey(MEMO_PROGRAM_ID),
      data: memoData
    });
    
    // Create and send transaction
    const transaction = new Transaction().add(memoInstruction);
    
    // Get recent blockhash with longer timeout
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = signer.publicKey;
    
    // Sign transaction
    transaction.sign(signer);
    
    // Send transaction
    const signature = await connection.sendTransaction(transaction, [signer], {
      skipPreflight: true,
      preflightCommitment: 'confirmed'
    });
    
    // Confirm transaction with longer timeout
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight
    }, 'confirmed');
    
    console.log(`Contract proof stored on-chain: ${signature}`);
    return signature;
    
  } catch (error) {
    console.error('Error storing contract proof on-chain:', error);
    throw new Error(`Failed to store proof on-chain: ${error.message}`);
  }
}

// Verify contract proof exists on-chain
export async function verifyContractProofOnChain(txHash) {
  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const transaction = await connection.getTransaction(txHash, {
      commitment: 'confirmed'
    });
    
    if (!transaction) {
      return { exists: false, error: 'Transaction not found' };
    }
    
    // Check if transaction was successful
    if (transaction.meta?.err) {
      return { exists: false, error: 'Transaction failed' };
    }
    
    return { exists: true, transaction };
    
  } catch (error) {
    console.error('Error verifying contract proof:', error);
    return { exists: false, error: error.message };
  }
}

/**
 * Initialize a contract on Solana blockchain
 * @param {number} contractId - Numeric contract ID
 * @param {string} ipfsHash - IPFS hash containing contract content
 * @param {string[]} participantWallets - Array of participant wallet addresses
 * @param {number} requiredApprovals - Number of required approvals
 * @param {string} signerPrivateKey - Creator's private key
 * @returns {Promise<{signature: string, contractPDA: string}>}
 */
export async function initializeContractOnChain(contractId, ipfsHash, participantWallets, requiredApprovals, signerPrivateKey) {
  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    
    // Parse signer keypair
    const signer = await parseKeypair(signerPrivateKey);
    
    // Convert participant addresses to PublicKeys
    const participants = participantWallets.map(addr => new PublicKey(addr));
    
    // Create wallet and provider
    const wallet = new Wallet(signer);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl, provider);
    
    // Derive contract PDA
    const [contractPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('contract'),
        new anchor.default.BN(contractId.toString()).toArrayLike(Buffer, 'le', 8),
        signer.publicKey.toBuffer(),
      ],
      PROGRAM_ID
    );
    
    // Derive reputation PDA
    const [creatorReputationPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('reputation'), signer.publicKey.toBuffer()],
      PROGRAM_ID
    );
    
    // Check if reputation account exists, create if not
    try {
      await program.account.userReputation.fetch(creatorReputationPDA);
    } catch (e) {
      console.log('Creating reputation account for creator...');
      await program.methods
        .initializeReputation()
        .accounts({
          reputation: creatorReputationPDA,
          user: signer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }
    
    // Initialize contract on-chain
    const tx = await program.methods
      .initializeContract(
        new anchor.default.BN(contractId.toString()),
        participants,
        requiredApprovals
      )
      .accounts({
        contract: contractPDA,
        creatorReputation: creatorReputationPDA,
        creator: signer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log(`Contract initialized on-chain: ${tx}`);
    
    return {
      signature: tx,
      contractPDA: contractPDA.toString(),
    };
    
  } catch (error) {
    console.error('Error initializing contract on-chain:', error);
    throw new Error(`Failed to initialize contract on Solana: ${error.message}`);
  }
}

/**
 * Update IPFS hash for an existing contract on-chain
 * @param {number} contractId - Numeric contract ID
 * @param {string} ipfsHash - IPFS hash
 * @param {string} creatorWallet - Creator's wallet address
 * @param {string} updaterPrivateKey - Updater's private key
 * @returns {Promise<{signature: string}>}
 */
// Update contract IPFS hash on-chain using the stored PDA directly
export async function updateContractIpfsOnChainByPDA(contractPDA, ipfsHash, updaterPrivateKey) {
  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    
    // Parse updater keypair
    const updater = await parseKeypair(updaterPrivateKey);
    
    // Create wallet and provider
    const wallet = new Wallet(updater);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl, provider);
    
    // Convert PDA string to PublicKey
    const contractPDAPubkey = new PublicKey(contractPDA);
    
    // Check if contract account exists on-chain
    let contractExists = false;
    try {
      await program.account.contract.fetch(contractPDAPubkey);
      contractExists = true;
      console.log('Contract account exists on-chain at PDA:', contractPDA);
    } catch (e) {
      console.log('Contract account does not exist on-chain at PDA:', contractPDA, 'Error:', e.message);
    }

    if (!contractExists) {
      return {
        signature: null,
        warning: 'Contract not initialized on-chain'
      };
    }

    // Update IPFS hash on-chain
    const tx = await program.methods
      .updateContractIpfs(ipfsHash)
      .accounts({
        contract: contractPDAPubkey,
        updater: updater.publicKey,
      })
      .rpc();
    
    console.log(`Contract IPFS hash updated on-chain: ${tx}`);
    
    return {
      signature: tx,
    };
    
  } catch (error) {
    console.error('Error updating contract IPFS on-chain:', error);
    throw new Error(`Failed to update contract IPFS on Solana: ${error.message}`);
  }
}

// Legacy function - kept for backwards compatibility
export async function updateContractIpfsOnChain(contractId, ipfsHash, creatorWallet, updaterPrivateKey) {
  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    
    // Parse updater keypair
    const updater = await parseKeypair(updaterPrivateKey);
    
    // Convert creator address to PublicKey
    const creatorPubkey = new PublicKey(creatorWallet);
    
    // Create wallet and provider
    const wallet = new Wallet(updater);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl, provider);
    
    // Derive contract PDA
    const [contractPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('contract'),
        new anchor.default.BN(contractId.toString()).toArrayLike(Buffer, 'le', 8),
        creatorPubkey.toBuffer(),
      ],
      PROGRAM_ID
    );
    
    // Check if contract account exists on-chain
    let contractExists = false;
    try {
      await program.account.contract.fetch(contractPDA);
      contractExists = true;
      console.log('Contract account exists on-chain');
    } catch (e) {
      console.log('Contract account does not exist on-chain, skipping update');
    }

    if (!contractExists) {
      return {
        signature: null,
        warning: 'Contract not initialized on-chain'
      };
    }

    // Update IPFS hash on-chain
    const tx = await program.methods
      .updateContractIpfs(ipfsHash)
      .accounts({
        contract: contractPDA,
        updater: updater.publicKey,
      })
      .rpc();
    
    console.log(`Contract IPFS hash updated on-chain: ${tx}`);
    
    return {
      signature: tx,
    };
    
  } catch (error) {
    console.error('Error updating contract IPFS on-chain:', error);
    throw new Error(`Failed to update contract IPFS on Solana: ${error.message}`);
  }
}

/**
 * Derive the contract PDA address without initializing
 * @param {number} contractId - Numeric contract ID
 * @param {string} creatorWallet - Creator's wallet address
 * @returns {string} - Contract PDA address
 */
export function deriveContractPDA(contractId, creatorWallet) {
  const creatorPubkey = new PublicKey(creatorWallet);
  const [contractPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('contract'),
      new anchor.default.BN(contractId.toString()).toArrayLike(Buffer, 'le', 8),
      creatorPubkey.toBuffer(),
    ],
    PROGRAM_ID
  );
  return contractPDA.toString();
}

/**
 * Parse a private key in various formats
 * @param {string} privateKey - Private key (base64 JSON array, base64, or base58)
 * @returns {Promise<Keypair>}
 */
async function parseKeypair(privateKey) {
  try {
    // First try to decode as base64 JSON array (Solana CLI format)
    const decodedString = Buffer.from(privateKey, 'base64').toString('utf8');
    const keyArray = JSON.parse(decodedString);
    
    if (Array.isArray(keyArray) && keyArray.length === 64) {
      const privateKeyBytes = Buffer.from(keyArray);
      return Keypair.fromSecretKey(privateKeyBytes);
    } else {
      throw new Error('Invalid JSON array format');
    }
  } catch (error) {
    // If JSON parsing fails, try direct base64
    try {
      const privateKeyBytes = Buffer.from(privateKey, 'base64');
      if (privateKeyBytes.length === 64) {
        return Keypair.fromSecretKey(privateKeyBytes);
      } else {
        throw new Error('Invalid base64 length');
      }
    } catch (base64Error) {
      // If base64 fails, try as base58
      try {
        const bs58 = await import('bs58');
        const privateKeyBytes = bs58.default.decode(privateKey);
        return Keypair.fromSecretKey(privateKeyBytes);
      } catch (bs58Error) {
        throw new Error('Invalid private key format. Expected base64-encoded JSON array from Solana CLI.');
      }
    }
  }
}
