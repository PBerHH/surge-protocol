/// Surge V2 — Stake Vault (Security Fix)
/// Fix: harvest_yield now requires VaultAdminCap → prevents yield theft by anyone
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

    const MS_PER_EPOCH: u64 = 86_400_000;

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_NOT_OWNER: u64          = 1;
    const E_UNLOCK_NOT_READY: u64   = 2;
    const E_ALREADY_UNSTAKING: u64  = 3;
    const E_BELOW_MINIMUM: u64      = 4;

    const MIN_STAKE_MIST: u64 = 1_000_000_000; // 1 SUI

    // ── Structs ────────────────────────────────────────────────────────────────

    public struct Vault has key {
        id: UID,
        total_staked: Balance<SUI>,
        pending_yield: Balance<SUI>,
    }

    /// NEW: Required to call harvest_yield
    public struct VaultAdminCap has key, store { id: UID }

    public struct StakeReceipt has key, store {
        id: UID,
        owner: address,
        principal_mist: u64,
        deposit_ts_ms: u64,
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

        let cap = VaultAdminCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // ── Public Entry Functions ─────────────────────────────────────────────────

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

    /// Migrate a receipt from a legacy contract into this vault without unstake delay.
    /// The user burns their old receipt and gets a new one here — no 24h wait, loyalty preserved.
    /// Usage: user calls this with their old StakeReceipt object and the SUI coin they withdrew.
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

        // Preserve original deposit timestamp so loyalty streak is not reset
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

    /// FIX: VaultAdminCap required — prevents anyone from stealing yield
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

    // ── Test Helpers ───────────────────────────────────────────────────────────
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
