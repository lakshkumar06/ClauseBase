# Pact

Complete vendor lifecycle management. Track reputation, negotiate contracts with version control, and automate milestone-based payments.

## Overview

Enterprises lose 9% of annual revenue to contract mismanagement. Vendor fraud costs millions per incident. Payment delays lock up $400B globally. These problems exist because discovery, negotiation, and execution are fragmented across email, legal systems, and manual payment processing.

Pact unifies the entire vendor relationship into one platform. Reputation scores follow wallets across organizations. Contract changes are tracked like Git commits. Payments release automatically when milestones complete. Everything is verifiable on-chain.

## Core Features

### Dual Reputation System

Every user has two scores: performance as a vendor and reliability as a client. Scores are computed from completed deals, payment speed, delivery time, and dispute history. Portable across all platform users.

**Vendor Reputation** tracks:
- Delivery timeliness (average time from milestone creation to completion)
- Quality ratings (1-5 scale from clients)
- Completion rate (deals completed vs. cancelled)
- Dispute count

**Client Reputation** tracks:
- Payment timeliness (how quickly milestones are approved after completion)
- Responsiveness ratings (1-5 scale from vendors)
- Completion rate
- Dispute count

Reputation scores are stored on-chain and follow wallet addresses, making them portable across organizations and platforms.

### Version-Controlled Contracts

Propose changes, review diffs, approve with multi-sig. Full commit history shows who changed what and when. Final contract hash stored on-chain as immutable proof.

**How it works:**
1. Any contract member can propose changes by editing the contract
2. Changes are tracked as new versions with automatic diff computation
3. Other members review and approve/reject changes
4. When all members approve, the version auto-merges
5. Merged versions are stored on IPFS with the hash recorded on-chain

This eliminates the "final_v2_ACTUAL_final.pdf" problem and provides a complete audit trail of all contract modifications.

### Milestone-Based Escrow

Client deposits payment upfront into program-controlled vaults. Vendor marks milestones complete. Client approves. Smart contract releases payment instantly. No intermediary, no 60-day wait.

**Workflow:**
1. Client creates a milestone with description, amount, recipient, and deadline
2. Funds are locked in an escrow account on-chain
3. Vendor marks the milestone as complete when work is done
4. Client (and other participants) approve the completion
5. Once approval threshold is met, funds automatically release to vendor
6. Reputation scores update based on delivery time and payment speed

This ensures vendors get paid promptly for completed work while protecting clients from incomplete deliverables.

### AI-Powered Contract Analysis

Automatically extracts clauses, deadlines, and payment milestones from contract text using Google Gemini. Provides a RAG-based chatbot for contract Q&A.

**Capabilities:**
- Clause extraction with categorization (Payment, Termination, Confidentiality, etc.)
- Deadline identification with date parsing
- Payment milestone detection with amount and recipient extraction
- Natural language Q&A about contract terms

### Fraud Detection

Algorithm analyzes wallet age, transaction history, account activity, and cross-platform reputation. High-risk accounts flagged before deals begin.

## How It Works

### 1. Discovery

Client invites vendor to deal. Both see each other's verified reputation scores. Scores are computed from on-chain activity and are portable across the platform.

### 2. Negotiation

Parties collaborate on contract terms with full version control. Each change creates a new version with diff tracking. Members approve or reject changes. When all members approve, the version merges automatically. Multi-sig approval finalizes agreement.

### 3. Execution

Client locks payment in escrow for each milestone. Vendor completes work and marks milestone complete. Client approves. Smart contract releases payment automatically when approval threshold is met. No manual payment processing required.

### 4. Reputation Update

Deal completion updates both parties' on-chain scores visible to future counterparties. Vendor scores reflect delivery timeliness and quality. Client scores reflect payment speed and responsiveness.



## Technical Architecture

### Blockchain Integration

Pact uses Solana for on-chain state management. Contract metadata, approval status, and IPFS hashes are stored in Program Derived Accounts (PDAs) for deterministic addressing. Escrow funds are held in PDA-controlled vaults that automatically release when approval conditions are met. Reputation scores are stored on-chain and follow wallet addresses, making them portable across platforms. Contract content is stored on IPFS to keep sensitive data off the public ledger while maintaining verifiable integrity through on-chain hashes.

### Tech Stack

**Frontend:**
- React + Vite
- Tailwind CSS
- Solana Wallet Adapter (Phantom, Solflare support)

**Backend:**
- Node.js + Express
- SQLite for relational data (contracts, versions, approvals)
- IPFS (Pinata/Web3.Storage) for document storage
- Google Gemini for AI contract analysis

**On-Chain:**
- Solana Programs (Rust + Anchor Framework)
- Deployed on Solana Devnet
- PDAs for deterministic account addressing
- Multi-signature approval logic at program level

### Key Design Decisions

**Hybrid Storage Model:** Contract content stored on IPFS, metadata on Solana. This balances cost (IPFS is cheaper for large documents) with verifiability (on-chain hashes prove integrity).

**Dual Reputation System:** Separate scores for vendor and client roles recognize that the same person may act as both. This provides more accurate reputation signals.

**Auto-merge on 100% Approval:** When all contract members approve a version, it automatically merges. This reduces friction while maintaining consensus.

**Milestone-Based Payments:** Breaking payments into milestones reduces risk for both parties. Vendors get paid incrementally, clients only pay for completed work.

**On-Chain Reputation:** Storing reputation on-chain makes it portable and verifiable. Users can build reputation across multiple organizations and platforms.

## Getting Started

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

### Build & Deploy

```bash
# Clone repo
git clone [your-repo-url]
cd ClauseBase

# Build Solana program
cd agreed_contracts
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run tests
anchor test
```

### Environment Setup

```bash
# Backend
cd backend
npm install
cp .env.example .env  # Configure SOLANA_PROGRAM_ID, GEMINI_API_KEY, etc.
npm start

# Frontend
cd frontend
npm install
npm run dev
```

## Built For

**Track 1**: Secure & Intelligent Onboarding Hub

- Automated workflow engine via multi-sig approvals
- Fraud detection and risk scoring
- Audit dashboard for deal monitoring

**Track 2**: Best Use of Solana

- Portable cross-organization reputation
- Trustless escrow without intermediaries
- Cryptographic proof of agreements
- Real-time settlement at near-zero cost

## Why This Matters

Every contract is a promise. Right now, promises live in email threads, lawyers' desks, and people's memory. Pact puts them in version-controlled, cryptographically-verified, immutable shared truth.

This isn't about replacing lawyers. It's about giving everyone the tools lawyers wish they had.
