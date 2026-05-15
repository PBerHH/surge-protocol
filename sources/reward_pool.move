/// Surge V2 — Reward Pool
/// Splits harvested yield into three pools:
///   Spark  20% · Pulse  30% · Surge  50%
/// 2% protocol fee taken before split → sent directly to fee_recipient.
module surge::reward_pool {

    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::transfer;
    use sui::event;

    const FEE_BP: u64   = 200;
    const SPARK_BP: u64 = 2_000;
    const PULSE_BP: u64 = 3_000;
    #[allow(unused_const)]
    const SURGE_BP: u64 = 5_000;
    const BP_DENOM: u64 = 10_000;

    // Fee recipient — all protocol fees go here automatically
    const FEE_RECIPIENT: address = @0x1de8cef32b6324c2ade5659caa86db8e0dc3c1fd7a76dda17ff4c8de330f5f95;

    const E_INSUFFICIENT_BALANCE: u64 = 1;

    public struct RewardPool has key {
        id: UID,
        admin: address,
        spark_pool: Balance<SUI>,
        pulse_pool: Balance<SUI>,
        surge_pool: Balance<SUI>,
    }

    public struct AdminCap has key, store { id: UID }

    public struct YieldDeposited has copy, drop {
        gross_mist: u64,
        fee_mist: u64,
        spark_mist: u64,
        pulse_mist: u64,
        surge_mist: u64,
    }

    public struct PrizeAwarded has copy, drop {
        pool: u8,
        winner: address,
        amount_mist: u64,
    }

    fun init(ctx: &mut TxContext) {
        let admin = tx_context::sender(ctx);
        let pool = RewardPool {
            id: object::new(ctx),
            admin,
            spark_pool: balance::zero<SUI>(),
            pulse_pool: balance::zero<SUI>(),
            surge_pool: balance::zero<SUI>(),
        };
        transfer::share_object(pool);
        let cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(cap, admin);
    }

    /// Accept yield, deduct 2% fee → sent directly to FEE_RECIPIENT, split rest into pools.
    public fun deposit_yield(
        pool: &mut RewardPool,
        yield_coin: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        let gross = coin::value(&yield_coin);
        let mut bal = coin::into_balance(yield_coin);

        let fee   = (gross * FEE_BP)   / BP_DENOM;
        let spark = (gross * SPARK_BP) / BP_DENOM;
        let pulse = (gross * PULSE_BP) / BP_DENOM;
        let surge = gross - fee - spark - pulse;

        // Send fee directly to recipient
        if (fee > 0) {
            let fee_coin = coin::from_balance(balance::split(&mut bal, fee), ctx);
            transfer::public_transfer(fee_coin, FEE_RECIPIENT);
        };

        balance::join(&mut pool.spark_pool, balance::split(&mut bal, spark));
        balance::join(&mut pool.pulse_pool, balance::split(&mut bal, pulse));
        balance::join(&mut pool.surge_pool, balance::split(&mut bal, surge));
        balance::destroy_zero(bal);

        event::emit(YieldDeposited {
            gross_mist: gross,
            fee_mist: fee,
            spark_mist: spark,
            pulse_mist: pulse,
            surge_mist: surge,
        });
    }

    public fun award_spark(pool: &mut RewardPool, amount_mist: u64, winner: address, ctx: &mut TxContext) {
        assert!(balance::value(&pool.spark_pool) >= amount_mist, E_INSUFFICIENT_BALANCE);
        let prize = coin::from_balance(balance::split(&mut pool.spark_pool, amount_mist), ctx);
        event::emit(PrizeAwarded { pool: 0, winner, amount_mist });
        transfer::public_transfer(prize, winner);
    }

    public fun award_pulse(pool: &mut RewardPool, amount_mist: u64, winner: address, ctx: &mut TxContext) {
        assert!(balance::value(&pool.pulse_pool) >= amount_mist, E_INSUFFICIENT_BALANCE);
        let prize = coin::from_balance(balance::split(&mut pool.pulse_pool, amount_mist), ctx);
        event::emit(PrizeAwarded { pool: 1, winner, amount_mist });
        transfer::public_transfer(prize, winner);
    }

    public fun award_surge(pool: &mut RewardPool, amount_mist: u64, winner: address, ctx: &mut TxContext) {
        assert!(balance::value(&pool.surge_pool) >= amount_mist, E_INSUFFICIENT_BALANCE);
        let prize = coin::from_balance(balance::split(&mut pool.surge_pool, amount_mist), ctx);
        event::emit(PrizeAwarded { pool: 2, winner, amount_mist });
        transfer::public_transfer(prize, winner);
    }

    public fun spark_balance(pool: &RewardPool): u64  { balance::value(&pool.spark_pool) }
    public fun pulse_balance(pool: &RewardPool): u64  { balance::value(&pool.pulse_pool) }
    public fun surge_balance(pool: &RewardPool): u64  { balance::value(&pool.surge_pool) }
    public fun treasury_balance(pool: &RewardPool): u64 { 0 } // kept for compatibility

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
}
