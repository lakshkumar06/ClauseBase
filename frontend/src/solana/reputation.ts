import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../../../agreed_contracts/target/idl/agreed_contracts.json";

const PROGRAM_ID = new PublicKey(import.meta.env.VITE_SOLANA_PROGRAM_ID || "8sRBcQiawsPTmLAcoJPtGAf4gYEszqHLx31DZEtjcinb");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

export async function initializeReputation(wallet: any) {
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  const program = new Program(idl as anchor.Idl, provider);

  // Use program.programId to ensure PDA matches what program expects
  const [reputationPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), wallet.publicKey.toBuffer()],
    program.programId
  );

  // Check if already exists
  try {
    await program.account.userReputation.fetch(reputationPDA);
    console.log("Reputation account already exists");
    return reputationPDA;
  } catch (e) {
    // Doesn't exist, create it
  }

  const tx = await program.methods
    .initializeReputation()
    .accounts({
      reputation: reputationPDA,
      user: wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("Reputation account created:", tx);
  return reputationPDA;
}

export async function fetchReputation(walletPubkey: PublicKey) {
  const provider = new anchor.AnchorProvider(connection, {} as any, {});
  const program = new Program(idl as anchor.Idl, provider);

  const [reputationPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), walletPubkey.toBuffer()],
    program.programId
  );

  try {
    const reputation = await program.account.userReputation.fetch(reputationPDA);
    return {
      wallet: reputation.wallet.toBase58(),
      contractsCreated: reputation.contractsCreated,
      contractsCompleted: reputation.contractsCompleted,
      contractsApproved: reputation.contractsApproved,
      totalValueEscrowed: reputation.totalValueEscrowed.toString(),
      firstActivity: new Date(reputation.firstActivity.toNumber() * 1000),
      lastActivity: new Date(reputation.lastActivity.toNumber() * 1000),
    };
  } catch (e) {
    console.log("Reputation account doesn't exist yet");
    return null;
  }
}

export async function markContractComplete(
  wallet: any,
  contractId: number,
  creatorPubkey: PublicKey,
  participantPubkey: PublicKey
) {
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  const program = new Program(idl as anchor.Idl, provider);

  const [contractPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("contract"),
      new anchor.BN(contractId).toArrayLike(Buffer, "le", 8),
      creatorPubkey.toBuffer(),
    ],
    program.programId
  );

  const [participantRepPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), participantPubkey.toBuffer()],
    program.programId
  );

  const tx = await program.methods
    .markContractComplete()
    .accounts({
      contract: contractPDA,
      participantReputation: participantRepPDA,
      participant: participantPubkey,
    })
    .rpc();

  return tx;
}

export async function ensureReputationExists(wallet: any) {
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  const program = new Program(idl as anchor.Idl, provider);
  
  // Use program.programId to ensure PDA matches what program expects
  const [reputationPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), wallet.publicKey.toBuffer()],
    program.programId
  );

  try {
    await program.account.userReputation.fetch(reputationPDA);
    console.log("Reputation account already exists");
    return reputationPDA;
  } catch (e) {
    console.log("Creating reputation account...");
    try {
      await initializeReputation(wallet);
      return reputationPDA;
    } catch (initError: any) {
      // If the error is "already processed", check if account now exists
      if (initError.message?.includes("already been processed") || 
          initError.message?.includes("already exists")) {
        console.log("Account was already created, continuing...");
        // Double-check the account exists now
        try {
          await program.account.userReputation.fetch(reputationPDA);
          return reputationPDA;
        } catch (fetchError) {
          throw new Error("Reputation account creation failed and account doesn't exist");
        }
      }
      throw initError;
    }
  }
}

