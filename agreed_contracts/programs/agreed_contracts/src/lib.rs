use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("8sRBcQiawsPTmLAcoJPtGAf4gYEszqHLx31DZEtjcinb");

#[program]
pub mod agreed_contracts {
    use super::*;

    pub fn initialize_reputation(ctx: Context<InitializeReputation>) -> Result<()> {
        let reputation = &mut ctx.accounts.reputation;
        let clock = Clock::get()?;
        
        reputation.wallet = ctx.accounts.user.key();
        
        // Legacy fields
        reputation.contracts_created = 0;
        reputation.contracts_completed = 0;
        reputation.contracts_approved = 0;
        reputation.total_value_escrowed = 0;
        
        // Vendor reputation
        reputation.vendor_score = 0;
        reputation.deals_as_vendor = 0;
        reputation.completed_as_vendor = 0;
        reputation.cancelled_as_vendor = 0;
        reputation.total_delivery_time_seconds = 0;
        reputation.quality_ratings_sum = 0;
        reputation.quality_ratings_count = 0;
        reputation.dispute_count_vendor = 0;
        
        // Client reputation
        reputation.client_score = 0;
        reputation.deals_as_client = 0;
        reputation.completed_as_client = 0;
        reputation.cancelled_as_client = 0;
        reputation.total_payment_time_seconds = 0;
        reputation.responsiveness_ratings_sum = 0;
        reputation.responsiveness_ratings_count = 0;
        reputation.dispute_count_client = 0;
        
        // Cross-role metrics
        reputation.total_value_transacted = 0;
        reputation.first_activity = clock.unix_timestamp;
        reputation.last_activity = clock.unix_timestamp;
        reputation.bump = ctx.bumps.reputation;
        
        msg!("Reputation account created for: {}", reputation.wallet);
        Ok(())
    }

    pub fn initialize_contract(
        ctx: Context<InitializeContract>,
        contract_id: u64,
        participants: Vec<Pubkey>,
        required_approvals: u8,
    ) -> Result<()> {
        require!(
            participants.len() <= Contract::MAX_PARTICIPANTS,
            ErrorCode::TooManyParticipants
        );
        require!(
            required_approvals as usize <= participants.len(),
            ErrorCode::InvalidApprovalThreshold
        );
        require!(
            participants.contains(&ctx.accounts.creator.key()),
            ErrorCode::CreatorMustBeParticipant
        );

        let contract = &mut ctx.accounts.contract;
        contract.contract_id = contract_id;
        contract.creator = ctx.accounts.creator.key();
        contract.participants = participants;
        contract.status = ContractStatus::Active;
        contract.required_approvals = required_approvals;
        contract.current_approvals = 0;
        contract.approvers = Vec::new();
        contract.ipfs_hash = String::new();
        contract.created_at = Clock::get()?.unix_timestamp;
        contract.bump = ctx.bumps.contract;

        // Update creator's reputation (creator acts as vendor when creating contract)
        let creator_rep = &mut ctx.accounts.creator_reputation;
        creator_rep.contracts_created += 1;
        creator_rep.deals_as_vendor += 1;
        creator_rep.last_activity = Clock::get()?.unix_timestamp;

        msg!("Contract {} created by {}", contract_id, contract.creator);
        Ok(())
    }

    pub fn approve_contract(ctx: Context<ApproveContract>) -> Result<()> {
        let contract = &mut ctx.accounts.contract;
        let approver = ctx.accounts.approver.key();

        require!(
            contract.status == ContractStatus::Active,
            ErrorCode::ContractNotActive
        );
        require!(
            contract.participants.contains(&approver),
            ErrorCode::NotAParticipant
        );
        require!(
            !contract.approvers.contains(&approver),
            ErrorCode::AlreadyApproved
        );

        contract.approvers.push(approver);
        contract.current_approvals += 1;

        // Update approver's reputation (approver acts as client when approving)
        let approver_rep = &mut ctx.accounts.approver_reputation;
        approver_rep.contracts_approved += 1;
        approver_rep.deals_as_client += 1;
        approver_rep.last_activity = Clock::get()?.unix_timestamp;

        let was_completed = contract.current_approvals >= contract.required_approvals;
        if was_completed {
            contract.status = ContractStatus::Completed;
            msg!("Contract {} completed!", contract.contract_id);
        }

        msg!("Contract {} approved by {}", contract.contract_id, approver);
        Ok(())
    }

    pub fn mark_contract_complete(
        ctx: Context<MarkContractComplete>,
    ) -> Result<()> {
        let contract = &ctx.accounts.contract;
        
        require!(
            contract.status == ContractStatus::Completed,
            ErrorCode::ContractNotCompleted
        );

        // Update participant's completion count
        let participant_rep = &mut ctx.accounts.participant_reputation;
        participant_rep.contracts_completed += 1;
        participant_rep.completed_as_vendor += 1;
        participant_rep.last_activity = Clock::get()?.unix_timestamp;

        msg!("Marked complete for participant: {}", participant_rep.wallet);
        Ok(())
    }

    pub fn cancel_contract(ctx: Context<CancelContract>) -> Result<()> {
        let contract = &mut ctx.accounts.contract;

        require!(
            contract.status == ContractStatus::Active,
            ErrorCode::ContractNotActive
        );
        require!(
            contract.creator == ctx.accounts.creator.key(),
            ErrorCode::OnlyCreatorCanCancel
        );

        contract.status = ContractStatus::Cancelled;

        // Update creator reputation (creator acts as vendor when creating contract)
        let creator_rep = &mut ctx.accounts.creator_reputation;
        creator_rep.cancelled_as_vendor += 1;
        creator_rep.last_activity = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn update_contract_ipfs(ctx: Context<UpdateContractIpfs>, ipfs_hash: String) -> Result<()> {
        require!(
            ipfs_hash.len() <= 46,
            ErrorCode::IpfsHashTooLong
        );
        
        let contract = &mut ctx.accounts.contract;
        let updater = ctx.accounts.updater.key();

        require!(
            contract.participants.contains(&updater),
            ErrorCode::NotAParticipant
        );

        contract.ipfs_hash = ipfs_hash;
        
        msg!("Contract {} IPFS hash updated to {}", contract.contract_id, contract.ipfs_hash);
        Ok(())
    }

    // ========== ESCROW MILESTONE FUNCTIONS ==========

    pub fn initialize_escrow_milestone(
        ctx: Context<InitializeEscrowMilestone>,
        milestone_id: u64,
        contract_id: u64,
        description: String,
        amount: u64,
        recipient: Pubkey,
        deadline: i64,
    ) -> Result<()> {
        require!(
            description.len() <= 200,
            ErrorCode::DescriptionTooLong
        );
        
        let contract = &ctx.accounts.contract;
        require!(
            contract.status == ContractStatus::Active || contract.status == ContractStatus::Completed,
            ErrorCode::ContractNotActive
        );
        require!(
            contract.creator == ctx.accounts.creator.key(),
            ErrorCode::OnlyCreatorCanInitializeEscrow
        );
        require!(
            contract.participants.contains(&recipient),
            ErrorCode::RecipientNotParticipant
        );
        require!(
            amount > 0,
            ErrorCode::InvalidAmount
        );

        // Transfer SOL to escrow PDA first
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.escrow_milestone.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        // Now initialize the escrow data
        let escrow = &mut ctx.accounts.escrow_milestone;
        escrow.milestone_id = milestone_id;
        escrow.contract_id = contract_id;
        escrow.description = description;
        escrow.amount = amount;
        escrow.recipient = recipient;
        escrow.deadline = deadline;
        escrow.status = MilestoneStatus::Funded;
        escrow.approvals_required = contract.participants.len() as u8;
        escrow.approvals = Vec::new();
        escrow.marked_complete_by = None;
        escrow.creator = ctx.accounts.creator.key();
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.bump = ctx.bumps.escrow_milestone;

        // Update creator reputation (creator acts as client when funding milestone)
        let creator_rep = &mut ctx.accounts.creator_reputation;
        creator_rep.total_value_escrowed += amount;
        creator_rep.total_value_transacted += amount;
        creator_rep.deals_as_client += 1;
        creator_rep.last_activity = Clock::get()?.unix_timestamp;

        // Note: Recipient's deals_as_vendor will be tracked when milestone is marked complete
        // This avoids requiring recipient_reputation account at creation time

        msg!("Escrow milestone {} created and funded with {} lamports", milestone_id, amount);
        Ok(())
    }

    pub fn mark_milestone_complete(
        ctx: Context<MarkMilestoneComplete>,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_milestone;
        let marker = ctx.accounts.marker.key();
        let clock = Clock::get()?;

        require!(
            escrow.status == MilestoneStatus::Funded,
            ErrorCode::MilestoneNotFunded
        );

        let contract = &ctx.accounts.contract;
        require!(
            contract.participants.contains(&marker),
            ErrorCode::NotAParticipant
        );
        require!(
            marker == escrow.recipient,
            ErrorCode::OnlyRecipientCanMarkComplete
        );

        escrow.marked_complete_by = Some(marker);
        escrow.status = MilestoneStatus::MarkedComplete;

        // Update vendor (recipient) reputation - track delivery time and deal start
        let vendor_rep = &mut ctx.accounts.vendor_reputation;
        // Track this as a vendor deal when they start working (when marking complete)
        // This ensures we count deals where vendor actually worked
        vendor_rep.deals_as_vendor += 1;
        let delivery_time = (clock.unix_timestamp - escrow.created_at) as u64;
        vendor_rep.total_delivery_time_seconds += delivery_time;
        vendor_rep.last_activity = clock.unix_timestamp;

        msg!("Milestone {} marked complete by {}", escrow.milestone_id, marker);
        Ok(())
    }

    pub fn approve_milestone_release(
        ctx: Context<ApproveMilestoneRelease>,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_milestone;
        let approver = ctx.accounts.approver.key();

        require!(
            escrow.status == MilestoneStatus::MarkedComplete,
            ErrorCode::MilestoneNotMarkedComplete
        );

        let contract = &ctx.accounts.contract;
        require!(
            contract.participants.contains(&approver),
            ErrorCode::NotAParticipant
        );
        require!(
            !escrow.approvals.contains(&approver),
            ErrorCode::AlreadyApprovedMilestone
        );

        escrow.approvals.push(approver);

        // Update approver reputation
        let approver_rep = &mut ctx.accounts.approver_reputation;
        approver_rep.last_activity = Clock::get()?.unix_timestamp;

        msg!(
            "Milestone {} approved by {} ({}/{})",
            escrow.milestone_id,
            approver,
            escrow.approvals.len(),
            escrow.approvals_required
        );

        Ok(())
    }

    pub fn release_escrow_funds(
        ctx: Context<ReleaseEscrowFunds>,
    ) -> Result<()> {
        let clock = Clock::get()?;
        
        // Check status and approvals first
        let (amount, milestone_id, recipient, created_at) = {
            let escrow = &ctx.accounts.escrow_milestone;
            require!(
                escrow.status == MilestoneStatus::MarkedComplete,
                ErrorCode::MilestoneNotMarkedComplete
            );
            require!(
                escrow.approvals.len() >= escrow.approvals_required as usize,
                ErrorCode::InsufficientApprovals
            );
            (escrow.amount, escrow.milestone_id, escrow.recipient, escrow.created_at)
        };
        
        // Transfer funds from escrow PDA to recipient
        **ctx.accounts.escrow_milestone.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;

        // Update status
        let escrow = &mut ctx.accounts.escrow_milestone;
        escrow.status = MilestoneStatus::Released;

        // Update vendor (recipient) reputation - milestone completed
        let vendor_rep = &mut ctx.accounts.vendor_reputation;
        vendor_rep.completed_as_vendor += 1;
        vendor_rep.total_value_transacted += amount;
        vendor_rep.last_activity = clock.unix_timestamp;

        // Update client (creator) reputation - track payment time
        let client_rep = &mut ctx.accounts.client_reputation;
        let payment_time = (clock.unix_timestamp - created_at) as u64;
        client_rep.total_payment_time_seconds += payment_time;
        client_rep.completed_as_client += 1;
        client_rep.last_activity = clock.unix_timestamp;

        msg!("Escrow milestone {} released {} lamports to {}", milestone_id, amount, recipient);
        Ok(())
    }

    pub fn cancel_escrow_milestone(
        ctx: Context<CancelEscrowMilestone>,
    ) -> Result<()> {
        let creator = ctx.accounts.creator.key();

        // Check permissions and status first
        let (amount, milestone_id, is_funded) = {
            let escrow = &ctx.accounts.escrow_milestone;
            require!(
                escrow.creator == creator,
                ErrorCode::OnlyCreatorCanCancelEscrow
            );
            require!(
                escrow.status == MilestoneStatus::Funded || escrow.status == MilestoneStatus::Pending,
                ErrorCode::CannotCancelMilestone
            );
            (escrow.amount, escrow.milestone_id, escrow.status == MilestoneStatus::Funded)
        };

        // Refund to creator if funded
        if is_funded {
            **ctx.accounts.escrow_milestone.to_account_info().try_borrow_mut_lamports()? -= amount;
            **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += amount;
        }

        // Update status
        let escrow = &mut ctx.accounts.escrow_milestone;
        escrow.status = MilestoneStatus::Cancelled;

        // Update reputation for cancellations
        let creator_rep = &mut ctx.accounts.creator_reputation;
        creator_rep.cancelled_as_client += 1;
        creator_rep.last_activity = Clock::get()?.unix_timestamp;

        msg!("Escrow milestone {} cancelled and refunded", milestone_id);
        Ok(())
    }

    pub fn rate_vendor(
        ctx: Context<RateVendor>,
        rating: u8,
    ) -> Result<()> {
        require!(
            rating >= 1 && rating <= 5,
            ErrorCode::InvalidRating
        );

        let vendor_rep = &mut ctx.accounts.vendor_reputation;
        vendor_rep.quality_ratings_sum += rating as u32;
        vendor_rep.quality_ratings_count += 1;
        
        // Calculate average vendor score (0-500 scale, where 500 = 5.0)
        if vendor_rep.quality_ratings_count > 0 {
            vendor_rep.vendor_score = (vendor_rep.quality_ratings_sum * 100) / vendor_rep.quality_ratings_count;
        }
        
        vendor_rep.last_activity = Clock::get()?.unix_timestamp;

        msg!("Vendor {} rated {} by {}", vendor_rep.wallet, rating, ctx.accounts.rater.key());
        Ok(())
    }

    pub fn rate_client(
        ctx: Context<RateClient>,
        rating: u8,
    ) -> Result<()> {
        require!(
            rating >= 1 && rating <= 5,
            ErrorCode::InvalidRating
        );

        let client_rep = &mut ctx.accounts.client_reputation;
        client_rep.responsiveness_ratings_sum += rating as u32;
        client_rep.responsiveness_ratings_count += 1;
        
        // Calculate average client score (0-500 scale, where 500 = 5.0)
        if client_rep.responsiveness_ratings_count > 0 {
            client_rep.client_score = (client_rep.responsiveness_ratings_sum * 100) / client_rep.responsiveness_ratings_count;
        }
        
        client_rep.last_activity = Clock::get()?.unix_timestamp;

        msg!("Client {} rated {} by {}", client_rep.wallet, rating, ctx.accounts.rater.key());
        Ok(())
    }

    pub fn report_dispute(
        ctx: Context<ReportDispute>,
        is_vendor_dispute: bool,
    ) -> Result<()> {
        let reputation = &mut ctx.accounts.reputation;
        
        if is_vendor_dispute {
            reputation.dispute_count_vendor += 1;
            msg!("Dispute reported for vendor: {}", reputation.wallet);
        } else {
            reputation.dispute_count_client += 1;
            msg!("Dispute reported for client: {}", reputation.wallet);
        }
        
        reputation.last_activity = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeReputation<'info> {
    #[account(
        init,
        payer = user,
        space = UserReputation::LEN,
        seeds = [b"reputation", user.key().as_ref()],
        bump
    )]
    pub reputation: Account<'info, UserReputation>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(contract_id: u64)]
pub struct InitializeContract<'info> {
    #[account(
        init,
        payer = creator,
        space = Contract::LEN,
        seeds = [b"contract", contract_id.to_le_bytes().as_ref(), creator.key().as_ref()],
        bump
    )]
    pub contract: Account<'info, Contract>,
    
    #[account(
        mut,
        seeds = [b"reputation", creator.key().as_ref()],
        bump = creator_reputation.bump,
    )]
    pub creator_reputation: Account<'info, UserReputation>,
    
    #[account(mut)]
    pub creator: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveContract<'info> {
    #[account(
        mut,
        seeds = [b"contract", contract.contract_id.to_le_bytes().as_ref(), contract.creator.key().as_ref()],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,
    
    #[account(
        mut,
        seeds = [b"reputation", approver.key().as_ref()],
        bump = approver_reputation.bump,
    )]
    pub approver_reputation: Account<'info, UserReputation>,
    
    pub approver: Signer<'info>,
}

#[derive(Accounts)]
pub struct MarkContractComplete<'info> {
    #[account(
        seeds = [b"contract", contract.contract_id.to_le_bytes().as_ref(), contract.creator.key().as_ref()],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,
    
    #[account(
        mut,
        seeds = [b"reputation", participant.key().as_ref()],
        bump = participant_reputation.bump,
    )]
    pub participant_reputation: Account<'info, UserReputation>,
    
    /// CHECK: We verify they're in contract.participants
    pub participant: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CancelContract<'info> {
    #[account(
        mut,
        seeds = [b"contract", contract.contract_id.to_le_bytes().as_ref(), contract.creator.key().as_ref()],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,
    
    #[account(
        mut,
        seeds = [b"reputation", creator.key().as_ref()],
        bump = creator_reputation.bump,
    )]
    pub creator_reputation: Account<'info, UserReputation>,
    
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateContractIpfs<'info> {
    #[account(
        mut,
        seeds = [b"contract", contract.contract_id.to_le_bytes().as_ref(), contract.creator.key().as_ref()],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,
    
    pub updater: Signer<'info>,
}

// ========== ESCROW MILESTONE ACCOUNT STRUCTURES ==========

#[derive(Accounts)]
#[instruction(milestone_id: u64, contract_id: u64)]
pub struct InitializeEscrowMilestone<'info> {
    #[account(
        init,
        payer = creator,
        space = EscrowMilestone::LEN,
        seeds = [b"escrow", contract_id.to_le_bytes().as_ref(), milestone_id.to_le_bytes().as_ref()],
        bump
    )]
    pub escrow_milestone: Account<'info, EscrowMilestone>,

    #[account(
        seeds = [b"contract", contract.contract_id.to_le_bytes().as_ref(), contract.creator.key().as_ref()],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,

    #[account(
        mut,
        seeds = [b"reputation", creator.key().as_ref()],
        bump = creator_reputation.bump,
    )]
    pub creator_reputation: Account<'info, UserReputation>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MarkMilestoneComplete<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow_milestone.contract_id.to_le_bytes().as_ref(), escrow_milestone.milestone_id.to_le_bytes().as_ref()],
        bump = escrow_milestone.bump
    )]
    pub escrow_milestone: Account<'info, EscrowMilestone>,

    #[account(
        seeds = [b"contract", contract.contract_id.to_le_bytes().as_ref(), contract.creator.key().as_ref()],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,

    #[account(
        mut,
        seeds = [b"reputation", escrow_milestone.recipient.key().as_ref()],
        bump = vendor_reputation.bump,
    )]
    pub vendor_reputation: Account<'info, UserReputation>,

    pub marker: Signer<'info>,
}

#[derive(Accounts)]
pub struct ApproveMilestoneRelease<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow_milestone.contract_id.to_le_bytes().as_ref(), escrow_milestone.milestone_id.to_le_bytes().as_ref()],
        bump = escrow_milestone.bump
    )]
    pub escrow_milestone: Account<'info, EscrowMilestone>,

    #[account(
        seeds = [b"contract", contract.contract_id.to_le_bytes().as_ref(), contract.creator.key().as_ref()],
        bump = contract.bump
    )]
    pub contract: Account<'info, Contract>,

    #[account(
        mut,
        seeds = [b"reputation", approver.key().as_ref()],
        bump = approver_reputation.bump,
    )]
    pub approver_reputation: Account<'info, UserReputation>,

    pub approver: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReleaseEscrowFunds<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow_milestone.contract_id.to_le_bytes().as_ref(), escrow_milestone.milestone_id.to_le_bytes().as_ref()],
        bump = escrow_milestone.bump
    )]
    pub escrow_milestone: Account<'info, EscrowMilestone>,

    /// CHECK: Verified via escrow_milestone.recipient
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"reputation", escrow_milestone.recipient.key().as_ref()],
        bump = vendor_reputation.bump,
    )]
    pub vendor_reputation: Account<'info, UserReputation>,

    #[account(
        mut,
        seeds = [b"reputation", escrow_milestone.creator.key().as_ref()],
        bump = client_reputation.bump,
    )]
    pub client_reputation: Account<'info, UserReputation>,
}

#[derive(Accounts)]
pub struct CancelEscrowMilestone<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow_milestone.contract_id.to_le_bytes().as_ref(), escrow_milestone.milestone_id.to_le_bytes().as_ref()],
        bump = escrow_milestone.bump
    )]
    pub escrow_milestone: Account<'info, EscrowMilestone>,

    #[account(
        mut,
        seeds = [b"reputation", creator.key().as_ref()],
        bump = creator_reputation.bump,
    )]
    pub creator_reputation: Account<'info, UserReputation>,

    #[account(mut)]
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct RateVendor<'info> {
    #[account(
        mut,
        seeds = [b"reputation", vendor_reputation.wallet.key().as_ref()],
        bump = vendor_reputation.bump,
    )]
    pub vendor_reputation: Account<'info, UserReputation>,

    pub rater: Signer<'info>,
}

#[derive(Accounts)]
pub struct RateClient<'info> {
    #[account(
        mut,
        seeds = [b"reputation", client_reputation.wallet.key().as_ref()],
        bump = client_reputation.bump,
    )]
    pub client_reputation: Account<'info, UserReputation>,

    pub rater: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReportDispute<'info> {
    #[account(
        mut,
        seeds = [b"reputation", reputation.wallet.key().as_ref()],
        bump = reputation.bump,
    )]
    pub reputation: Account<'info, UserReputation>,

    pub reporter: Signer<'info>,
}

#[account]
pub struct Contract {
    pub contract_id: u64,
    pub creator: Pubkey,
    pub participants: Vec<Pubkey>,
    pub status: ContractStatus,
    pub required_approvals: u8,
    pub current_approvals: u8,
    pub approvers: Vec<Pubkey>,
    pub ipfs_hash: String,
    pub created_at: i64,
    pub bump: u8,
}

impl Contract {
    pub const MAX_PARTICIPANTS: usize = 10;
    pub const LEN: usize = 8 + // discriminator
        8 + // contract_id
        32 + // creator
        (4 + 32 * Self::MAX_PARTICIPANTS) + // participants vec
        1 + // status
        1 + // required_approvals
        1 + // current_approvals
        (4 + 32 * Self::MAX_PARTICIPANTS) + // approvers vec
        (4 + 46) + // ipfs_hash
        8 + // created_at
        1; // bump
}

#[account]
pub struct UserReputation {
    pub wallet: Pubkey,
    
    // Legacy fields (kept for backward compatibility)
    pub contracts_created: u32,
    pub contracts_completed: u32,
    pub contracts_approved: u32,
    pub total_value_escrowed: u64,
    
    // Vendor reputation (when providing services/receiving payments)
    pub vendor_score: u32,              // 0-500 (represents 0.0-5.0, stored as fixed-point * 100)
    pub deals_as_vendor: u32,
    pub completed_as_vendor: u32,
    pub cancelled_as_vendor: u32,
    pub total_delivery_time_seconds: u64,  // Sum of all delivery times
    pub quality_ratings_sum: u32,          // Sum of quality ratings (1-5 each)
    pub quality_ratings_count: u32,        // Number of quality ratings received
    pub dispute_count_vendor: u32,
    
    // Client reputation (when buying services/paying)
    pub client_score: u32,              // 0-500 (represents 0.0-5.0, stored as fixed-point * 100)
    pub deals_as_client: u32,
    pub completed_as_client: u32,
    pub cancelled_as_client: u32,
    pub total_payment_time_seconds: u64,   // Sum of all payment times (from milestone creation to approval)
    pub responsiveness_ratings_sum: u32,   // Sum of responsiveness ratings (1-5 each)
    pub responsiveness_ratings_count: u32, // Number of responsiveness ratings received
    pub dispute_count_client: u32,
    
    // Cross-role metrics
    pub total_value_transacted: u64,
    pub first_activity: i64,
    pub last_activity: i64,
    pub bump: u8,
}

impl UserReputation {
    pub const LEN: usize = 8 + // discriminator
        32 + // wallet
        // Legacy fields
        4 +  // contracts_created
        4 +  // contracts_completed
        4 +  // contracts_approved
        8 +  // total_value_escrowed
        // Vendor reputation
        4 +  // vendor_score
        4 +  // deals_as_vendor
        4 +  // completed_as_vendor
        4 +  // cancelled_as_vendor
        8 +  // total_delivery_time_seconds
        4 +  // quality_ratings_sum
        4 +  // quality_ratings_count
        4 +  // dispute_count_vendor
        // Client reputation
        4 +  // client_score
        4 +  // deals_as_client
        4 +  // completed_as_client
        4 +  // cancelled_as_client
        8 +  // total_payment_time_seconds
        4 +  // responsiveness_ratings_sum
        4 +  // responsiveness_ratings_count
        4 +  // dispute_count_client
        // Cross-role metrics
        8 +  // total_value_transacted
        8 +  // first_activity
        8 +  // last_activity
        1;   // bump
}

#[account]
pub struct EscrowMilestone {
    pub milestone_id: u64,
    pub contract_id: u64,
    pub description: String,
    pub amount: u64,
    pub recipient: Pubkey,
    pub deadline: i64,
    pub status: MilestoneStatus,
    pub approvals_required: u8,
    pub approvals: Vec<Pubkey>,
    pub marked_complete_by: Option<Pubkey>,
    pub creator: Pubkey,
    pub created_at: i64,
    pub bump: u8,
}

impl EscrowMilestone {
    pub const MAX_PARTICIPANTS: usize = 10;
    pub const LEN: usize = 8 + // discriminator
        8 + // milestone_id
        8 + // contract_id
        (4 + 200) + // description (max 200 chars)
        8 + // amount
        32 + // recipient
        8 + // deadline
        1 + // status enum
        1 + // approvals_required
        (4 + 32 * Self::MAX_PARTICIPANTS) + // approvals vec
        (1 + 32) + // marked_complete_by option
        32 + // creator
        8 + // created_at
        1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ContractStatus {
    Active,
    Completed,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum MilestoneStatus {
    Pending,
    Funded,
    MarkedComplete,
    Released,
    Cancelled,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Too many participants (max 10)")]
    TooManyParticipants,
    #[msg("Invalid approval threshold")]
    InvalidApprovalThreshold,
    #[msg("Creator must be a participant")]
    CreatorMustBeParticipant,
    #[msg("Contract is not active")]
    ContractNotActive,
    #[msg("You are not a participant")]
    NotAParticipant,
    #[msg("You have already approved this contract")]
    AlreadyApproved,
    #[msg("Only creator can cancel the contract")]
    OnlyCreatorCanCancel,
    #[msg("Contract is not completed yet")]
    ContractNotCompleted,
    #[msg("Reputation account already exists")]
    ReputationAlreadyExists,
    #[msg("Description too long (max 200 characters)")]
    DescriptionTooLong,
    #[msg("Only creator can initialize escrow")]
    OnlyCreatorCanInitializeEscrow,
    #[msg("Recipient must be a participant")]
    RecipientNotParticipant,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Milestone is not funded")]
    MilestoneNotFunded,
    #[msg("Milestone not marked complete")]
    MilestoneNotMarkedComplete,
    #[msg("Already approved this milestone")]
    AlreadyApprovedMilestone,
    #[msg("Insufficient approvals to release funds")]
    InsufficientApprovals,
    #[msg("Only creator can cancel escrow")]
    OnlyCreatorCanCancelEscrow,
    #[msg("Cannot cancel milestone in current status")]
    CannotCancelMilestone,
    #[msg("IPFS hash too long (max 46 characters)")]
    IpfsHashTooLong,
    #[msg("Invalid rating (must be between 1 and 5)")]
    InvalidRating,
    #[msg("Only recipient can mark milestone as complete")]
    OnlyRecipientCanMarkComplete,
}

