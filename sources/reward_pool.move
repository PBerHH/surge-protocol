/// Surge V2 — Reward Pool
/// Splits harvested yield into three pools:
///   Spark  20% · Pulse  30% · Surge  50%
/// 2% protocol fee taken before split → Treasury.
module surge::reward_pool {

    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::transfer;
    use sui::event;

    // ── Constants ──────────────────────────────────────────────────────────────

    const FEE_BP: u64   = 200;   // 2% protocol fee
    const SPARK_BP: u64 = 2_000; // 20% of post-fee yield
    const PULSE_BP: u64 = 3_000; // 30%
    #[allow(unused_const)]
    const SURGE_BP: u64 = 5_000; // 50% — remainder after fee+spark+pulse
    const BP_DENOM: u64 = 10_000;

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_INSUFFICIENT_BALANCE: u64 = 1;
    // ── Structs ────────────────────────────────────────────────────────────────

    /// Shared object — one per deployment.
    public struct RewardPool has key {
        id: UID,
        admin: address,
        treasury: Balance<SUI>,
        spark_pool: Balance<SUI>,
        pulse_pool: Balance<SUI>,
        surge_pool: Balance<SUI>,
    }

    public struct AdminCap has key, store { id: UID }

    // ── Events ─────────────────────────────────────────────────────────────────

    public struct YieldDeposited has copy, drop {
        gross_mist: u64,
        fee_mist: u64,
        spark_mist: u64,
        pulse_mist: u64,
        surge_mist: u64,
    }

    public struct PrizeAwarded has copy, drop {
        pool: u8, // 0=spark 1=pulse 2=surge
        winner: address,
        amount_mist: u64,
    }

    // ── Init ───────────────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let admin = tx_context::sender(ctx);
        let pool = RewardPool {
            id: object::new(ctx),
            admin,
            treasury: balance::zero<SUI>(),
            spark_pool: balance::zero<SUI>(),
            pulse_pool: balance::zero<SUI>(),
            surge_pool: balance::zero<SUI>(),
        };
        transfer::share_object(pool);

        let cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(cap, admin);
    }

    // ── Public Functions ───────────────────────────────────────────────────────

    /// Accept yield from vault, deduct fee, split into pools.
    public fun deposit_yield(
        pool: &mut RewardPool,
        yield_coin: Coin<SUI>,
        _ctx: &mut TxContext,
    ) {
        let gross = coin::value(&yield_coin);
        let mut bal = coin::into_balance(yield_coin);

        let fee    = (gross * FEE_BP)   / BP_DENOM;
        let spark  = (gross * SPARK_BP) / BP_DENOM;
        let pulse  = (gross * PULSE_BP) / BP_DENOM;
        // Surge gets the remainder to avoid rounding dust
        let surge  = gross - fee - spark - pulse;

        balance::join(&mut pool.treasury,    balance::split(&mut bal, fee));
        balance::join(&mut pool.spark_pool,  balance::split(&mut bal, spark));
        balance::join(&mut pool.pulse_pool,  balance::split(&mut bal, pulse));
        balance::join(&mut pool.surge_pool,  balance::split(&mut bal, surge));

        // Destroy the now-empty balance
        balance::destroy_zero(bal);

        event::emit(YieldDeposited {
            gross_mist: gross,
            fee_mist: fee,
            spark_mist: spark,
            pulse_mist: pulse,
            surge_mist: surge,
        });
    }

    /// Pay out a Spark prize to a winner address.
    public fun award_spark(
        pool: &mut RewardPool,
        amount_mist: u64,
        winner: address,
        ctx: &mut TxContext,
    ) {
        assert!(balance::value(&pool.spark_pool) >= amount_mist, E_INSUFFICIENT_BALANCE);
        let prize = coin::from_balance(
            balance::split(&mut pool.spark_pool, amount_mist), ctx
        );
        event::emit(PrizeAwarded { pool: 0, winner, amount_mist });
        transfer::public_transfer(prize, winner);
    }

    /// Pay out a Pulse prize.
    public fun award_pulse(
        pool: &mut RewardPool,
        amount_mist: u64,
        winner: address,
        ctx: &mut TxContext,
    ) {
        assert!(balance::value(&pool.pulse_pool) >= amount_mist, E_INSUFFICIENT_BALANCE);
        let prize = coin::from_balance(
            balance::split(&mut pool.pulse_pool, amount_mist), ctx
        );
        event::emit(PrizeAwarded { pool: 1, winner, amount_mist });
        transfer::public_transfer(prize, winner);
    }

    /// Pay out the Surge jackpot.
    public fun award_surge(
        pool: &mut RewardPool,
        amount_mist: u64,
        winner: address,
        ctx: &mut TxContext,
    ) {
        assert!(balance::value(&pool.surge_pool) >= amount_mist, E_INSUFFICIENT_BALANCE);
        let prize = coin::from_balance(
            balance::split(&mut pool.surge_pool, amount_mist), ctx
        );
        event::emit(PrizeAwarded { pool: 2, winner, amount_mist });
        transfer::public_transfer(prize, winner);
    }

    /// Admin: withdraw accumulated treasury fees.
    entry fun withdraw_treasury(
        pool: &mut RewardPool,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let amount = balance::value(&pool.treasury);
        let coin = coin::from_balance(
            balance::split(&mut pool.treasury, amount), ctx
        );
        transfer::public_transfer(coin, pool.admin);
    }

    // ── Accessors ──────────────────────────────────────────────────────────────

    public fun spark_balance(pool: &RewardPool): u64  { balance::value(&pool.spark_pool) }
    public fun pulse_balance(pool: &RewardPool): u64  { balance::value(&pool.pulse_pool) }
    public fun surge_balance(pool: &RewardPool): u64  { balance::value(&pool.surge_pool) }
    public fun treasury_balance(pool: &RewardPool): u64 { balance::value(&pool.treasury) }

    // ── Test Helpers ───────────────────────────────────────────────────────────
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
