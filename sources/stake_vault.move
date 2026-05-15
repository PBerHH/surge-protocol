/// Surge V2 — Stake Vault
/// Holds staker principals. Enforces 1-epoch unstaking delay.
/// Yield is harvested each epoch and forwarded to the RewardPool.
module surge::stake_vault {

    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::transfer;
    use sui::clock::{Self, Clock};
    use sui::event;
    use surge::loyalty_tracker::{Self, LoyaltyRecord};

    // ── Constants ──────────────────────────────────────────────────────────────

    const MS_PER_EPOCH: u64 = 86_400_000; // ~24 h on Sui testnet

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_NOT_OWNER: u64          = 1;
    const E_UNLOCK_NOT_READY: u64   = 2;
    const E_ALREADY_UNSTAKING: u64  = 3;
    const E_BELOW_MINIMUM: u64      = 4;

    const MIN_STAKE_MIST: u64 = 10_000_000_000; // 10 SUI in MIST

    // ── Structs ────────────────────────────────────────────────────────────────

    /// Shared vault holding all staked principal.
    public struct Vault has key {
        id: UID,
        total_staked: Balance<SUI>,
        /// Simulated yield accumulator (on testnet we add yield manually).
        pending_yield: Balance<SUI>,
    }

    /// Per-staker deposit receipt, owned by the staker.
    public struct StakeReceipt has key, store {
        id: UID,
        owner: address,
        /// Amount deposited in MIST.
        principal_mist: u64,
        /// Epoch timestamp (ms) when deposit was made.
        deposit_ts_ms: u64,
        /// If Some, the timestamp after which withdrawal is allowed.
        unlock_ts_ms: Option<u64>,
    }

    // ── Events ─────────────────────────────────────────────────────────────────

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

    // ── Init ───────────────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let vault = Vault {
            id: object::new(ctx),
            total_staked: balance::zero<SUI>(),
            pending_yield: balance::zero<SUI>(),
        };
        transfer::share_object(vault);
    }

    // ── Public Entry Functions ─────────────────────────────────────────────────

    /// Deposit SUI and receive a StakeReceipt.
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

    /// Request unstaking — starts the 1-epoch delay.
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

    /// Withdraw principal after unlock period.
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

        // Reset loyalty on full withdrawal
        loyalty_tracker::reset(loyalty, clock, ctx);

        event::emit(Withdrawn {
            staker: tx_context::sender(ctx),
            amount_mist: principal_mist,
        });

        transfer::public_transfer(coin, tx_context::sender(ctx));
    }

    /// Add simulated yield (testnet helper — on mainnet replaced by real validator rewards).
    entry fun add_yield(
        vault: &mut Vault,
        coin: Coin<SUI>,
        _ctx: &mut TxContext,
    ) {
        balance::join(&mut vault.pending_yield, coin::into_balance(coin));
    }

    /// Harvest pending yield into a Coin for the RewardPool.
    public fun harvest_yield(vault: &mut Vault, ctx: &mut TxContext): Coin<SUI> {
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

    // ── Test Helpers ───────────────────────────────────────────────────────────
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
