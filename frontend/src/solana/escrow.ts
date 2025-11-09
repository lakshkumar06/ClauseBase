import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ensureReputationExists } from "./reputation";
import idl from "../../../agreed_contracts/target/idl/agreed_contracts.json";

const PROGRAM_ID = new PublicKey(import.meta.env.VITE_SOLANA_PROGRAM_ID || "8sRBcQiawsPTmLAcoJPtGAf4gYEszqHLx31DZEtjcinb");

// Helper to create Program - uses IDL's address
function createProgram(provider: any) {
  return new Program(idl as anchor.Idl, provider);
}
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

export interface EscrowMilestoneData {
  milestoneId: anchor.BN;
  contractId: anchor.BN;
  description: string;
  amount: anchor.BN;
  recipient: PublicKey;
  deadline: anchor.BN;
  status: { pending?: {}; funded?: {}; markedComplete?: {}; released?: {}; cancelled?: {} };
  approvalsRequired: number;
  approvals: PublicKey[];
  markedCompleteBy: PublicKey | null;
  creator: PublicKey;
  createdAt: anchor.BN;
  bump: number;
}

// Derive escrow milestone PDA
export function getEscrowMilestonePDA(contractId: string | number, milestoneId: number): [PublicKey, number] {
  // Convert contractId to BN properly
  const contractIdBigInt = typeof contractId === 'string' 
    ? BigInt(contractId)
    : BigInt(contractId);
  
  const contractBuffer = Buffer.alloc(8);
  contractBuffer.writeBigUInt64LE(contractIdBigInt);
  const contractIdBN = new anchor.BN(contractBuffer, 'le');
  
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      contractIdBN.toArrayLike(Buffer, "le", 8),
      new anchor.BN(milestoneId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  );
  return [pda, bump];
}

// Derive contract PDA
export function getContractPDA(contractId: string | number, creator: PublicKey): [PublicKey, number] {
  // Convert contractId to BN properly from BigInt
  const contractIdBigInt = typeof contractId === 'string' 
    ? BigInt(contractId)
    : BigInt(contractId);
  
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(contractIdBigInt);
  const contractIdBN = new anchor.BN(buffer, 'le');
  
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("contract"),
      contractIdBN.toArrayLike(Buffer, "le", 8),
      creator.toBuffer(),
    ],
    PROGRAM_ID
  );
  return [pda, bump];
}

// Derive reputation PDA - uses program ID from IDL to ensure consistency
export function getReputationPDA(wallet: PublicKey, programId?: PublicKey): [PublicKey, number] {
  // Use provided programId or fall back to PROGRAM_ID constant
  // When called from within a program context, should use program.programId
  const pid = programId || PROGRAM_ID;
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), wallet.toBuffer()],
    pid
  );
  return [pda, bump];
}

// Initialize escrow milestone (creator funds escrow)
export async function initializeEscrowMilestone(
  wallet: anchor.Wallet,
  contractId: string,
  milestoneId: number,
  description: string,
  amountInSol: number,
  recipientAddress: string,
  deadlineTimestamp: number,
  contractCreator: PublicKey,
  contractPDAOverride?: string
): Promise<{ signature: string; escrowPDA: PublicKey }> {
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = createProgram(provider);

  const [escrowPDA] = getEscrowMilestonePDA(contractId, milestoneId);
  const contractPDA = contractPDAOverride
    ? new PublicKey(contractPDAOverride)
    : getContractPDA(contractId, contractCreator)[0];
  
  // Use program ID from IDL to ensure consistency with reputation account creation
  const [creatorReputationPDA] = getReputationPDA(wallet.publicKey, program.programId);
  const recipient = new PublicKey(recipientAddress);
  const amountInLamports = BigInt(Math.round(amountInSol * LAMPORTS_PER_SOL));

  // Build BN values safely from BigInt using little-endian buffers for u64
  const contractBuf = Buffer.alloc(8);
  contractBuf.writeBigUInt64LE(BigInt(contractId));
  const contractIdBN = new anchor.BN(contractBuf, 'le');

  const milestoneBuf = Buffer.alloc(8);
  milestoneBuf.writeBigUInt64LE(BigInt(milestoneId));
  const milestoneIdBN = new anchor.BN(milestoneBuf, 'le');

  const deadlineBuf = Buffer.alloc(8);
  deadlineBuf.writeBigUInt64LE(BigInt(deadlineTimestamp));
  const deadlineBN = new anchor.BN(deadlineBuf, 'le');

  try {
    // Ensure creator's reputation account exists before initializing escrow
    console.log("Ensuring creator reputation account exists...");
    await ensureReputationExists(wallet);
    console.log("Creator reputation account verified");

    const tx = await program.methods
      .initializeEscrowMilestone(
        milestoneIdBN,
        contractIdBN,
        description,
        new anchor.BN(amountInLamports.toString()),
        recipient,
        deadlineBN
      )
      .accounts({
        escrowMilestone: escrowPDA,
        contract: contractPDA,
        creatorReputation: creatorReputationPDA,
        creator: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`Escrow milestone initialized: ${tx}`);
    return { signature: tx, escrowPDA };
  } catch (error) {
    console.error("Error initializing escrow milestone:", error);
    throw error;
  }
}

// Mark milestone as complete
export async function markMilestoneComplete(
  wallet: anchor.Wallet,
  contractId: string,
  milestoneId: number,
  contractCreator: PublicKey,
  contractPDAOverride?: string
): Promise<string> {
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = createProgram(provider);

  const [escrowPDA] = getEscrowMilestonePDA(contractId, milestoneId);
  const contractPDA = contractPDAOverride
    ? new PublicKey(contractPDAOverride)
    : getContractPDA(contractId, contractCreator)[0];

  try {
    // Ensure vendor (marker) reputation account exists before marking complete
    // The marker must be the recipient, so they should initialize their own reputation
    console.log("Ensuring vendor reputation account exists...");
    await ensureReputationExists(wallet);
    console.log("Vendor reputation account verified");

    const tx = await program.methods
      .markMilestoneComplete()
      .accounts({
        escrowMilestone: escrowPDA,
        contract: contractPDA,
        marker: wallet.publicKey,
      })
      .rpc();

    console.log(`Milestone marked complete: ${tx}`);
    return tx;
  } catch (error) {
    console.error("Error marking milestone complete:", error);
    throw error;
  }
}

// Approve milestone release
export async function approveMilestoneRelease(
  wallet: anchor.Wallet,
  contractId: string,
  milestoneId: number,
  contractCreator: PublicKey,
  contractPDAOverride?: string
): Promise<string> {
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = createProgram(provider);

  const [escrowPDA] = getEscrowMilestonePDA(contractId, milestoneId);
  const contractPDA = contractPDAOverride
    ? new PublicKey(contractPDAOverride)
    : getContractPDA(contractId, contractCreator)[0];
  
  // Use program ID from IDL to ensure consistency
  const [approverReputationPDA] = getReputationPDA(wallet.publicKey, program.programId);

  try {
    // Ensure approver's reputation account exists
    console.log("Ensuring approver reputation account exists...");
    await ensureReputationExists(wallet);
    console.log("Approver reputation account verified");

    const tx = await program.methods
      .approveMilestoneRelease()
      .accounts({
        escrowMilestone: escrowPDA,
        contract: contractPDA,
        approverReputation: approverReputationPDA,
        approver: wallet.publicKey,
      })
      .rpc();

    console.log(`Milestone approved: ${tx}`);
    return tx;
  } catch (error) {
    console.error("Error approving milestone:", error);
    throw error;
  }
}

// Release escrow funds (anyone can call if approvals met)
export async function releaseEscrowFunds(
  wallet: anchor.Wallet,
  contractId: string,
  milestoneId: number,
  recipientAddress: string,
  creatorAddress?: string
): Promise<string> {
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = createProgram(provider);

  const [escrowPDA] = getEscrowMilestonePDA(contractId, milestoneId);
  const recipient = new PublicKey(recipientAddress);

  try {
    // Fetch escrow milestone to get creator if not provided
    let creator: PublicKey;
    if (creatorAddress) {
      creator = new PublicKey(creatorAddress);
    } else {
      const escrowData = await program.account.escrowMilestone.fetch(escrowPDA);
      creator = escrowData.creator;
    }

    // Ensure creator's reputation account exists (if caller is creator)
    // Note: We can only initialize our own reputation, but the accounts must exist
    if (wallet.publicKey.equals(creator)) {
      console.log("Ensuring creator reputation account exists...");
      await ensureReputationExists(wallet);
    }
    
    // For recipient, we can't initialize their account, but we can check if it exists
    // If it doesn't exist, the transaction will fail with a clear error
    const [vendorRepPDA] = getReputationPDA(recipient, program.programId);
    try {
      await program.account.userReputation.fetch(vendorRepPDA);
    } catch (e) {
      console.warn("Recipient reputation account doesn't exist. They need to initialize it first.");
      throw new Error("Recipient reputation account doesn't exist. Please ask the recipient to initialize their reputation account first.");
    }

    const tx = await program.methods
      .releaseEscrowFunds()
      .accounts({
        escrowMilestone: escrowPDA,
        recipient: recipient,
      })
      .rpc();

    console.log(`Escrow funds released: ${tx}`);
    return tx;
  } catch (error) {
    console.error("Error releasing escrow funds:", error);
    throw error;
  }
}

// Cancel escrow milestone (creator only)
export async function cancelEscrowMilestone(
  wallet: anchor.Wallet,
  contractId: string,
  milestoneId: number
): Promise<string> {
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = createProgram(provider);

  const [escrowPDA] = getEscrowMilestonePDA(contractId, milestoneId);

  try {
    const tx = await program.methods
      .cancelEscrowMilestone()
      .accounts({
        escrowMilestone: escrowPDA,
        creator: wallet.publicKey,
      })
      .rpc();

    console.log(`Escrow milestone cancelled: ${tx}`);
    return tx;
  } catch (error) {
    console.error("Error cancelling escrow milestone:", error);
    throw error;
  }
}

// Fetch escrow milestone data from chain
export async function fetchEscrowMilestone(
  contractId: number,
  milestoneId: number
): Promise<EscrowMilestoneData | null> {
  const provider = new anchor.AnchorProvider(
    connection,
    {} as anchor.Wallet,
    { commitment: "confirmed" }
  );
  const program = createProgram(provider);

  const [escrowPDA] = getEscrowMilestonePDA(contractId, milestoneId);

  try {
    const escrowData = await program.account.escrowMilestone.fetch(escrowPDA);
    return escrowData as EscrowMilestoneData;
  } catch (error) {
    console.error("Error fetching escrow milestone:", error);
    return null;
  }
}

// Fetch all escrow milestones for a contract
export async function fetchContractEscrowMilestones(
  contractId: string
): Promise<EscrowMilestoneData[]> {
  const provider = new anchor.AnchorProvider(
    connection,
    {} as anchor.Wallet,
    { commitment: "confirmed" }
  );
  const program = createProgram(provider);

  try {
    // Convert contractId string to BN properly
    // Split into high and low parts for large numbers
    const contractIdBigInt = BigInt(contractId);
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(contractIdBigInt);
    const contractIdBN = new anchor.BN(buffer, 'le');

    const escrows = await program.account.escrowMilestone.all([
      {
        memcmp: {
          offset: 8 + 8, // discriminator + milestone_id
          bytes: anchor.utils.bytes.bs58.encode(
            contractIdBN.toArrayLike(Buffer, "le", 8)
          ),
        },
      },
    ]);

    return escrows.map((e) => e.account as EscrowMilestoneData);
  } catch (error) {
    console.error("Error fetching contract escrow milestones:", error);
    return [];
  }
}

