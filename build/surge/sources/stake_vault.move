/// Surge V5 — Stake Vault
/// V2: harvest_yield requires VaultAdminCap (yield-theft fix) — UNCHANGED below
/// V5: real native staking to Triton One via a new StakingVault (pooled-by-epoch).
///     The legacy `Vault` (idle balance + simulated yield) is kept untouched for
///     upgrade compatibility and to drain remaining legacy stakes.
module surge::stake_vault {

    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::transfer;
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui_system::sui_system::{Self, SuiSystemState};
    use sui_system::staking_pool::{Self, StakedSui};
    use surge::loyalty_tracker::{Self, LoyaltyRecord};

    // ── Constants ──────────────────────────────────────────────────────────────

    const MS_PER_EPOCH: u64 = 86_400_000;
    const MIN_STAKE_MIST: u64 = 1_000_000_000; // 1 SUI (also Sui's MIN_STAKING_THRESHOLD)

    /// Triton One validator on Sui mainnet — verified on-chain via
    /// suix_getLatestSuiSystemState (activeValidators).
    const TRITON_VALIDATOR: address = @0xa608b66f7ae2201286f7dd07a8b073cde7955b35056629636a6c9b3f5275f384;

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_NOT_OWNER: u64             = 1;
    const E_UNLOCK_NOT_READY: u64      = 2;
    const E_ALREADY_UNSTAKING: u64     = 3;
    const E_BELOW_MINIMUM: u64         = 4;
    const E_INSUFFICIENT_LIQUIDITY: u64 = 5;

    // ── Structs (V1/V2 — UNCHANGED, do not modify: upgrade compatibility) ───────

    public struct Vault has key {
        id: UID,
        total_staked: Balance<SUI>,
        pending_yield: Balance<SUI>,
    }

    public struct VaultAdminCap has key, store { id: UID }

    public struct StakeReceipt has key, store {
        id: UID,
        owner: address,
        principal_mist: u64,
        deposit_ts_ms: u64,
        unlock_ts_ms: Option<u64>,
    }

    // ── Structs (V5 — real staking) ─────────────────────────────────────────────

    /// Holds real StakedSui delegated to Triton. Pooled by activation epoch:
    /// same-epoch deposits merge into one StakedSui, so the object count scales
    /// with epochs, not with the number of stakers.
    public struct StakingVault has key {
        id: UID,
        /// Sum of all user principal (staked + liquid + pending). Source of truth.
        total_principal: u64,
        /// Active delegations. Bounded small (~1-2) because harvest collapses them.
        stakes: vector<StakedSui>,
        /// Real validator rewards, waiting to be routed to the prize pool.
        pending_rewards: Balance<SUI>,
        /// Principal set aside (liquid) to pay users who requested unstake.
        liquid_principal: Balance<SUI>,
        /// Principal requested-to-unstake but not yet liquefied at a harvest.
        pending_unstake_mist: u64,
    }

    public struct StakingReceipt has key, store {
        id: UID,
        owner: address,
        principal_mist: u64,
        deposit_ts_ms: u64,
        unlock_ts_ms: Option<u64>,
    }

    // ── Events (V1/V2 — UNCHANGED) ──────────────────────────────────────────────

    public struct Deposited has copy, drop {
        staker: address,
        amount_mist: u64,
        receipt_id: ID,
    }

    public struct UnstakeRequested has copy, drop {
        staker: address,
        receipt_id: ID,
        unlock_ts_ms: u64,
    }

    public struct Withdrawn has copy, drop {
        staker: address,
        amount_mist: u64,
    }

    // Preserved from V4 for upgrade compatibility (no longer emitted).
    public struct DepositedV2 has copy, drop {
        staker: address,
        amount_mist: u64,
        receipt_id: ID,
        referrer: Option<address>,
    }

    public struct PartialUnstakeRequested has copy, drop {
        staker: address,
        original_receipt_id: ID,
        new_receipt_id: ID,
        unstake_amount_mist: u64,
        remaining_mist: u64,
        unlock_ts_ms: u64,
    }

    // ── Events (V5) ─────────────────────────────────────────────────────────────

    public struct Staked has copy, drop {
        staker: address,
        amount_mist: u64,
        receipt_id: ID,
    }

    public struct StakeUnstakeRequested has copy, drop {
        staker: address,
        receipt_id: ID,
        unlock_ts_ms: u64,
    }

    public struct StakeWithdrawn has copy, drop {
        staker: address,
        amount_mist: u64,
    }

    public struct Harvested has copy, drop {
        rewards_mist: u64,
        total_principal: u64,
    }

    // ── Init (runs only on first publish; V5 vault created via create_staking_vault) ─

    fun init(ctx: &mut TxContext) {
        let vault = Vault {
            id: object::new(ctx),
            total_staked: balance::zero<SUI>(),
            pending_yield: balance::zero<SUI>(),
        };
        transfer::share_object(vault);

        let cap = VaultAdminCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    /// One-time: create + share the StakingVault after the V5 upgrade.
    /// (init does not run on upgrades, so the admin calls this once.)
    entry fun create_staking_vault(_cap: &VaultAdminCap, ctx: &mut TxContext) {
        let vault = StakingVault {
            id: object::new(ctx),
            total_principal: 0,
            stakes: vector::empty<StakedSui>(),
            pending_rewards: balance::zero<SUI>(),
            liquid_principal: balance::zero<SUI>(),
            pending_unstake_mist: 0,
        };
        transfer::share_object(vault);
    }

    // ── V5: Real Staking Functions ──────────────────────────────────────────────

    /// Stake SUI — delegated to Triton One immediately.
    entry fun stake(
        vault: &mut StakingVault,
        state: &mut SuiSystemState,
        coin: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&coin);
        assert!(amount >= MIN_STAKE_MIST, E_BELOW_MINIMUM);

        let new_stake = sui_system::request_add_stake_non_entry(state, coin, TRITON_VALIDATOR, ctx);
        merge_or_push(vault, new_stake);
        vault.total_principal = vault.total_principal + amount;

        let receipt = StakingReceipt {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            principal_mist: amount,
            deposit_ts_ms: clock::timestamp_ms(clock),
            unlock_ts_ms: option::none(),
        };
        let receipt_id = object::id(&receipt);
        event::emit(Staked { staker: tx_context::sender(ctx), amount_mist: amount, receipt_id });
        transfer::transfer(receipt, tx_context::sender(ctx));
    }

    /// Request unstake — starts the 1-epoch (~24h) delay and earmarks the
    /// principal to be liquefied at the next harvest.
    entry fun request_unstake_staked(
        vault: &mut StakingVault,
        receipt: &mut StakingReceipt,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(receipt.owner == tx_context::sender(ctx), E_NOT_OWNER);
        assert!(option::is_none(&receipt.unlock_ts_ms), E_ALREADY_UNSTAKING);

        let unlock_at = clock::timestamp_ms(clock) + MS_PER_EPOCH;
        receipt.unlock_ts_ms = option::some(unlock_at);
        vault.pending_unstake_mist = vault.pending_unstake_mist + receipt.principal_mist;

        event::emit(StakeUnstakeRequested {
            staker: tx_context::sender(ctx),
            receipt_id: object::id(receipt),
            unlock_ts_ms: unlock_at,
        });
    }

    /// Withdraw principal after unlock. Paid from the liquid buffer that a
    /// prior harvest set aside. If the buffer hasn't been topped up yet
    /// (harvest not run since the request), aborts — user simply retries
    /// after the next harvest. No funds are ever at risk.
    entry fun withdraw_staked(
        vault: &mut StakingVault,
        receipt: StakingReceipt,
        loyalty: &mut LoyaltyRecord,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(receipt.owner == tx_context::sender(ctx), E_NOT_OWNER);
        let unlock_ts = *option::borrow(&receipt.unlock_ts_ms);
        assert!(clock::timestamp_ms(clock) >= unlock_ts, E_UNLOCK_NOT_READY);

        let StakingReceipt { id, owner: _, principal_mist, deposit_ts_ms: _, unlock_ts_ms: _ } = receipt;
        object::delete(id);

        assert!(balance::value(&vault.liquid_principal) >= principal_mist, E_INSUFFICIENT_LIQUIDITY);
        let payout = balance::split(&mut vault.liquid_principal, principal_mist);
        vault.total_principal = vault.total_principal - principal_mist;

        loyalty_tracker::reset(loyalty, clock, ctx);

        let coin = coin::from_balance(payout, ctx);
        event::emit(StakeWithdrawn { staker: tx_context::sender(ctx), amount_mist: principal_mist });
        transfer::public_transfer(coin, tx_context::sender(ctx));
    }

    /// Harvest (crank, ~1x/epoch): withdraw all delegations, route real rewards
    /// to pending_rewards, set aside principal for pending unstakes, re-stake
    /// the rest. O(number of epoch-buckets) — independent of staker count.
    public fun harvest(
        vault: &mut StakingVault,
        _cap: &VaultAdminCap,
        state: &mut SuiSystemState,
        ctx: &mut TxContext,
    ) {
        if (vector::is_empty(&vault.stakes)) { return };

        // 1. Withdraw every delegation into one pooled balance.
        let mut pooled = balance::zero<SUI>();
        while (!vector::is_empty(&vault.stakes)) {
            let s = vector::pop_back(&mut vault.stakes);
            let b = sui_system::request_withdraw_stake_non_entry(state, s, ctx);
            balance::join(&mut pooled, b);
        };

        // 2. Separate rewards from principal. The staked portion equals
        //    total_principal minus whatever is already liquid.
        let staked_principal = vault.total_principal - balance::value(&vault.liquid_principal);
        let pooled_val = balance::value(&pooled);
        let rewards = pooled_val - staked_principal; // staking never returns < principal
        if (rewards > 0) {
            let r = balance::split(&mut pooled, rewards);
            balance::join(&mut vault.pending_rewards, r);
        };
        // pooled now holds exactly `staked_principal` of liquid principal.

        // 3. Set aside principal for users who requested unstake.
        if (vault.pending_unstake_mist > 0) {
            let avail = balance::value(&pooled);
            let set_aside = if (vault.pending_unstake_mist <= avail) vault.pending_unstake_mist else avail;
            let la = balance::split(&mut pooled, set_aside);
            balance::join(&mut vault.liquid_principal, la);
            vault.pending_unstake_mist = vault.pending_unstake_mist - set_aside;
        };

        // 4. Re-stake the remainder (if >= 1 SUI); keep sub-1-SUI dust liquid.
        let remainder = balance::value(&pooled);
        if (remainder >= MIN_STAKE_MIST) {
            let coin = coin::from_balance(pooled, ctx);
            let restaked = sui_system::request_add_stake_non_entry(state, coin, TRITON_VALIDATOR, ctx);
            vector::push_back(&mut vault.stakes, restaked);
        } else {
            balance::join(&mut vault.liquid_principal, pooled);
        };

        event::emit(Harvested { rewards_mist: rewards, total_principal: vault.total_principal });
    }

    /// Claim accumulated rewards as a Coin (crank routes it to the prize pool).
    public fun claim_rewards(
        vault: &mut StakingVault,
        _cap: &VaultAdminCap,
        ctx: &mut TxContext,
    ): Coin<SUI> {
        let amount = balance::value(&vault.pending_rewards);
        let r = balance::split(&mut vault.pending_rewards, amount);
        coin::from_balance(r, ctx)
    }

    /// Merge the new stake into an existing same-epoch delegation, or push it.
    /// `new_stake` is consumed exactly once on every path.
    fun merge_or_push(vault: &mut StakingVault, new_stake: StakedSui) {
        let n = vector::length(&vault.stakes);
        let mut idx = n; // sentinel: not found
        let mut i = 0;
        while (i < n) {
            if (staking_pool::is_equal_staking_metadata(vector::borrow(&vault.stakes, i), &new_stake)) {
                idx = i;
                break
            };
            i = i + 1;
        };
        if (idx < n) {
            staking_pool::join_staked_sui(vector::borrow_mut(&mut vault.stakes, idx), new_stake);
        } else {
            vector::push_back(&mut vault.stakes, new_stake);
        }
    }

    // ── V1/V2 Functions (UNCHANGED) ─────────────────────────────────────────────

    entry fun deposit(
        vault: &mut Vault,
        coin: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&coin);
        assert!(amount >= MIN_STAKE_MIST, E_BELOW_MINIMUM);

        balance::join(&mut vault.total_staked, coin::into_balance(coin));

        let receipt = StakeReceipt {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            principal_mist: amount,
            deposit_ts_ms: clock::timestamp_ms(clock),
            unlock_ts_ms: option::none(),
        };

        let receipt_id = object::id(&receipt);
        event::emit(Deposited {
            staker: tx_context::sender(ctx),
            amount_mist: amount,
            receipt_id,
        });

        transfer::transfer(receipt, tx_context::sender(ctx));
    }

    entry fun request_unstake(
        receipt: &mut StakeReceipt,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(receipt.owner == tx_context::sender(ctx), E_NOT_OWNER);
        assert!(option::is_none(&receipt.unlock_ts_ms), E_ALREADY_UNSTAKING);

        let unlock_at = clock::timestamp_ms(clock) + MS_PER_EPOCH;
        receipt.unlock_ts_ms = option::some(unlock_at);

        event::emit(UnstakeRequested {
            staker: tx_context::sender(ctx),
            receipt_id: object::id(receipt),
            unlock_ts_ms: unlock_at,
        });
    }

    entry fun withdraw(
        vault: &mut Vault,
        receipt: StakeReceipt,
        loyalty: &mut LoyaltyRecord,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(receipt.owner == tx_context::sender(ctx), E_NOT_OWNER);
        let unlock_ts = *option::borrow(&receipt.unlock_ts_ms);
        assert!(clock::timestamp_ms(clock) >= unlock_ts, E_UNLOCK_NOT_READY);

        let StakeReceipt { id, owner: _, principal_mist, deposit_ts_ms: _, unlock_ts_ms: _ } = receipt;
        object::delete(id);

        let payout = balance::split(&mut vault.total_staked, principal_mist);
        let coin = coin::from_balance(payout, ctx);

        loyalty_tracker::reset(loyalty, clock, ctx);

        event::emit(Withdrawn {
            staker: tx_context::sender(ctx),
            amount_mist: principal_mist,
        });

        transfer::public_transfer(coin, tx_context::sender(ctx));
    }

    entry fun migrate_from_legacy(
        vault: &mut Vault,
        principal: Coin<SUI>,
        original_deposit_ts_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&principal);
        assert!(amount >= MIN_STAKE_MIST, E_BELOW_MINIMUM);

        balance::join(&mut vault.total_staked, coin::into_balance(principal));

        let receipt = StakeReceipt {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            principal_mist: amount,
            deposit_ts_ms: original_deposit_ts_ms,
            unlock_ts_ms: option::none(),
        };

        let receipt_id = object::id(&receipt);
        event::emit(Deposited {
            staker: tx_context::sender(ctx),
            amount_mist: amount,
            receipt_id,
        });

        transfer::transfer(receipt, tx_context::sender(ctx));
    }

    entry fun add_yield(
        vault: &mut Vault,
        coin: Coin<SUI>,
        _ctx: &mut TxContext,
    ) {
        balance::join(&mut vault.pending_yield, coin::into_balance(coin));
    }

    public fun harvest_yield(
        vault: &mut Vault,
        _cap: &VaultAdminCap,
        ctx: &mut TxContext,
    ): Coin<SUI> {
        let amount = balance::value(&vault.pending_yield);
        let harvested = balance::split(&mut vault.pending_yield, amount);
        coin::from_balance(harvested, ctx)
    }

    // ── Accessors ──────────────────────────────────────────────────────────────

    public fun total_staked(vault: &Vault): u64 {
        balance::value(&vault.total_staked)
    }

    public fun pending_yield_amount(vault: &Vault): u64 {
        balance::value(&vault.pending_yield)
    }

    public fun receipt_principal(receipt: &StakeReceipt): u64 {
        receipt.principal_mist
    }

    public fun receipt_owner(receipt: &StakeReceipt): address {
        receipt.owner
    }

    public fun receipt_deposit_ts(receipt: &StakeReceipt): u64 {
        receipt.deposit_ts_ms
    }

    public fun receipt_is_unstaking(receipt: &StakeReceipt): bool {
        option::is_some(&receipt.unlock_ts_ms)
    }

    // V5 accessors
    public fun staking_total_principal(vault: &StakingVault): u64 { vault.total_principal }
    public fun staking_pending_rewards(vault: &StakingVault): u64 { balance::value(&vault.pending_rewards) }
    public fun staking_liquid_principal(vault: &StakingVault): u64 { balance::value(&vault.liquid_principal) }
    public fun staking_pending_unstake(vault: &StakingVault): u64 { vault.pending_unstake_mist }
    public fun staking_num_stakes(vault: &StakingVault): u64 { vector::length(&vault.stakes) }
    public fun staking_receipt_principal(receipt: &StakingReceipt): u64 { receipt.principal_mist }
    public fun staking_receipt_owner(receipt: &StakingReceipt): address { receipt.owner }

    // ── Test Helpers ───────────────────────────────────────────────────────────
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
