/// Surge V2 — Stake Vault (Mainnet with Real Native Staking)
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
    use sui_system::staking_pool::StakedSui;
    use surge::loyalty_tracker::{Self, LoyaltyRecord};

    const MS_PER_EPOCH: u64 = 86_400_000;
    const VALIDATOR: address = @0xa608b66f7ae2201286f7dd07a8b073cde7955b35056629636a6c9b3f5275f384;

    const E_NOT_OWNER: u64         = 1;
    const E_UNLOCK_NOT_READY: u64  = 2;
    const E_ALREADY_UNSTAKING: u64 = 3;
    const E_BELOW_MINIMUM: u64     = 4;

    const MIN_STAKE_MIST: u64 = 1_000_000_000; // 1 SUI

    public struct Vault has key {
        id: UID,
        total_staked: u64,
        pending_yield: Balance<SUI>,
    }

    public struct StakeReceipt has key, store {
        id: UID,
        owner: address,
        principal_mist: u64,
        deposit_ts_ms: u64,
        unlock_ts_ms: Option<u64>,
        staked_sui: StakedSui,
    }

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

    fun init(ctx: &mut TxContext) {
        let vault = Vault {
            id: object::new(ctx),
            total_staked: 0,
            pending_yield: balance::zero<SUI>(),
        };
        transfer::share_object(vault);
    }

    entry fun deposit(
        vault: &mut Vault,
        system: &mut SuiSystemState,
        coin: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&coin);
        assert!(amount >= MIN_STAKE_MIST, E_BELOW_MINIMUM);

        let staked_sui = sui_system::request_add_stake_non_entry(
            system, coin, VALIDATOR, ctx,
        );

        vault.total_staked = vault.total_staked + amount;

        let receipt = StakeReceipt {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            principal_mist: amount,
            deposit_ts_ms: clock::timestamp_ms(clock),
            unlock_ts_ms: option::none(),
            staked_sui,
        };

        let receipt_id = object::id(&receipt);
        event::emit(Deposited { staker: tx_context::sender(ctx), amount_mist: amount, receipt_id });
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
        system: &mut SuiSystemState,
        receipt: StakeReceipt,
        loyalty: &mut LoyaltyRecord,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(receipt.owner == tx_context::sender(ctx), E_NOT_OWNER);
        let unlock_ts = *option::borrow(&receipt.unlock_ts_ms);
        assert!(clock::timestamp_ms(clock) >= unlock_ts, E_UNLOCK_NOT_READY);

        let StakeReceipt { id, owner: _, principal_mist, deposit_ts_ms: _, unlock_ts_ms: _, staked_sui } = receipt;
        object::delete(id);

        // request_withdraw_stake_non_entry returns Balance<SUI>
        let withdrawn_bal = sui_system::request_withdraw_stake_non_entry(system, staked_sui, ctx);
        let total = balance::value(&withdrawn_bal);

        if (total > principal_mist) {
            let rewards = total - principal_mist;
            let mut bal = withdrawn_bal;
            let reward_bal = balance::split(&mut bal, rewards);
            balance::join(&mut vault.pending_yield, reward_bal);
            let principal_coin = coin::from_balance(bal, ctx);
            vault.total_staked = if (vault.total_staked >= principal_mist) { vault.total_staked - principal_mist } else { 0 };
            loyalty_tracker::reset(loyalty, clock, ctx);
            event::emit(Withdrawn { staker: tx_context::sender(ctx), amount_mist: principal_mist });
            transfer::public_transfer(principal_coin, tx_context::sender(ctx));
        } else {
            let principal_coin = coin::from_balance(withdrawn_bal, ctx);
            vault.total_staked = if (vault.total_staked >= principal_mist) { vault.total_staked - principal_mist } else { 0 };
            loyalty_tracker::reset(loyalty, clock, ctx);
            event::emit(Withdrawn { staker: tx_context::sender(ctx), amount_mist: total });
            transfer::public_transfer(principal_coin, tx_context::sender(ctx));
        }
    }

    public fun harvest_yield(vault: &mut Vault, ctx: &mut TxContext): Coin<SUI> {
        let amount = balance::value(&vault.pending_yield);
        let harvested = balance::split(&mut vault.pending_yield, amount);
        coin::from_balance(harvested, ctx)
    }

    entry fun add_yield(vault: &mut Vault, coin: Coin<SUI>, _ctx: &mut TxContext) {
        balance::join(&mut vault.pending_yield, coin::into_balance(coin));
    }

    public fun total_staked(vault: &Vault): u64 { vault.total_staked }
    public fun pending_yield_amount(vault: &Vault): u64 { balance::value(&vault.pending_yield) }
    public fun receipt_principal(receipt: &StakeReceipt): u64 { receipt.principal_mist }
    public fun receipt_owner(receipt: &StakeReceipt): address { receipt.owner }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
}
