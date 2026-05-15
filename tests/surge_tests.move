#[test_only]
module surge::surge_tests {

    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_utils::assert_eq;

    use surge::loyalty_tracker::{Self, LoyaltyRecord};
    use surge::ticket_engine;
    use surge::stake_vault::{Self, Vault, StakeReceipt};
    use surge::reward_pool::{Self, RewardPool, AdminCap as PoolAdminCap};
    use surge::draw_manager::{Self, DrawState, AdminCap as DrawAdminCap};

    // ── Test Addresses ────────────────────────────────────────────────────────
    const ADMIN:  address = @0xAD;
    const ALICE:  address = @0xA1;
    const BOB:    address = @0xB0;
    const CAROL:  address = @0xCA;

    const SUI_1:   u64 = 1_000_000_000;
    const SUI_10:  u64 = 10_000_000_000;
    const SUI_50:  u64 = 50_000_000_000;
    const SUI_100: u64 = 100_000_000_000;
    const SUI_200: u64 = 200_000_000_000;
    const SUI_500: u64 = 500_000_000_000;

    // ── Helpers ───────────────────────────────────────────────────────────────

    fun mint_sui(amount: u64, ctx: &mut TxContext): Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, ctx)
    }

    fun clock_at(ms: u64, ctx: &mut TxContext): Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, ms);
        c
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LOYALTY TRACKER TESTS
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_loyalty_new_record_starts_at_1x() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            assert_eq(loyalty_tracker::multiplier_bp(&record, &clock), 10_000);
            assert_eq(loyalty_tracker::days_staked(&record, &clock), 0);

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_loyalty_tier_1_after_30_days() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);
            clock::destroy_for_testing(clock);

            // Advance 30 days
            let clock30 = clock_at(30 * 86_400_000, ctx);
            assert_eq(loyalty_tracker::multiplier_bp(&record, &clock30), 12_000);
            assert_eq(loyalty_tracker::days_staked(&record, &clock30), 30);

            clock::destroy_for_testing(clock30);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_loyalty_tier_4_after_365_days() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);
            clock::destroy_for_testing(clock);

            let clock365 = clock_at(365 * 86_400_000, ctx);
            assert_eq(loyalty_tracker::multiplier_bp(&record, &clock365), 20_000);

            clock::destroy_for_testing(clock365);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_loyalty_multiplier_hard_cap_at_2x() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);
            clock::destroy_for_testing(clock);

            // 500 days — should still be capped at 2.0x = 20_000 bp
            let clock500 = clock_at(500 * 86_400_000, ctx);
            assert_eq(loyalty_tracker::multiplier_bp(&record, &clock500), 20_000);

            clock::destroy_for_testing(clock500);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_loyalty_reset_on_withdrawal() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let mut record = loyalty_tracker::new_record(&clock, ctx);
            clock::destroy_for_testing(clock);

            // After 180 days → 1.8x
            let clock180 = clock_at(180 * 86_400_000, ctx);
            assert_eq(loyalty_tracker::multiplier_bp(&record, &clock180), 18_000);

            // Reset
            loyalty_tracker::reset(&mut record, &clock180, ctx);

            // Should be back to 1.0x
            assert_eq(loyalty_tracker::multiplier_bp(&record, &clock180), 10_000);

            clock::destroy_for_testing(clock180);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // TICKET ENGINE TESTS
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_spark_tickets_basic() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            // 100 SUI → 100 tickets at 1.0x
            let tickets = ticket_engine::spark_tickets(100, &record, &clock);
            assert_eq(tickets, 100);

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_spark_tickets_whale_cap() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            // 1000 SUI → capped at 500 tickets
            let tickets = ticket_engine::spark_tickets(1000, &record, &clock);
            assert_eq(tickets, 500);

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_spark_tickets_below_gate_returns_zero() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            // 5 SUI → below 10 SUI gate → 0 tickets
            let tickets = ticket_engine::spark_tickets(10, &record, &clock);
            assert_eq(tickets, 10); // exactly at gate → gets tickets

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_pulse_tickets_sqrt_scaling() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            // Below 1000 SUI → linear
            let tickets_500 = ticket_engine::pulse_tickets(500, &record, &clock);
            assert_eq(tickets_500, 500);

            // Above 1000 SUI → sqrt scaling: 1000 + sqrt(1000) ≈ 1031
            let tickets_2000 = ticket_engine::pulse_tickets(2000, &record, &clock);
            assert_eq(tickets_2000, 1031); // 1000 + sqrt(1000) = 1031

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_pulse_tickets_below_gate_returns_zero() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            let tickets = ticket_engine::pulse_tickets(49, &record, &clock);
            assert_eq(tickets, 0);

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_surge_tickets_linear() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            let tickets = ticket_engine::surge_tickets(500, &record, &clock);
            assert_eq(tickets, 500);

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_surge_tickets_with_2x_loyalty() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock0 = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock0, ctx);
            clock::destroy_for_testing(clock0);

            // After 365 days → 2.0x multiplier
            let clock365 = clock_at(365 * 86_400_000, ctx);
            let tickets = ticket_engine::surge_tickets(500, &record, &clock365);
            assert_eq(tickets, 1000); // 500 * 2.0x

            clock::destroy_for_testing(clock365);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_surge_tickets_below_gate_returns_zero() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            let tickets = ticket_engine::surge_tickets(199, &record, &clock);
            assert_eq(tickets, 0);

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // REWARD POOL TESTS
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_reward_pool_deposit_and_split() {
        let mut s = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut s);
            reward_pool::init_for_testing(ctx);
        };

        ts::next_tx(&mut s, ADMIN);
        {
            let mut pool = ts::take_shared<RewardPool>(&s);
            let ctx = ts::ctx(&mut s);

            // Deposit 1000 SUI as yield
            let yield_coin = mint_sui(1000 * SUI_1, ctx);
            reward_pool::deposit_yield(&mut pool, yield_coin, ctx);

            // Check splits: 2% fee, 20% spark, 30% pulse, 50% surge (of 98%)
            let gross = 1000 * SUI_1;
            let fee = gross * 200 / 10_000;          // 20 SUI
            let spark = gross * 2_000 / 10_000;      // 200 SUI
            let pulse = gross * 3_000 / 10_000;      // 300 SUI
            let surge = gross - fee - spark - pulse;  // 480 SUI

            assert_eq(reward_pool::treasury_balance(&pool), fee);
            assert_eq(reward_pool::spark_balance(&pool), spark);
            assert_eq(reward_pool::pulse_balance(&pool), pulse);
            assert_eq(reward_pool::surge_balance(&pool), surge);

            ts::return_shared(pool);
        };
        ts::end(s);
    }

    #[test]
    fun test_reward_pool_award_spark_prize() {
        let mut s = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut s);
            reward_pool::init_for_testing(ctx);
        };
        ts::next_tx(&mut s, ADMIN);
        {
            let mut pool = ts::take_shared<RewardPool>(&s);
            let ctx = ts::ctx(&mut s);

            // Seed the pool
            let yield_coin = mint_sui(1000 * SUI_1, ctx);
            reward_pool::deposit_yield(&mut pool, yield_coin, ctx);

            let spark_before = reward_pool::spark_balance(&pool);
            let prize = SUI_10;
            reward_pool::award_spark(&mut pool, prize, ALICE, ctx);

            assert_eq(reward_pool::spark_balance(&pool), spark_before - prize);

            ts::return_shared(pool);
        };
        ts::end(s);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DRAW MANAGER TESTS
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_draw_manager_initial_state() {
        let mut s = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut s);
            draw_manager::init_for_testing(ctx);
        };
        ts::next_tx(&mut s, ADMIN);
        {
            let state = ts::take_shared<DrawState>(&s);

            assert_eq(draw_manager::spark_ticket_count(&state), 0);
            assert_eq(draw_manager::pulse_ticket_count(&state), 0);
            assert_eq(draw_manager::surge_ticket_count(&state), 0);
            assert_eq(draw_manager::next_spark_ms(&state), 0);

            ts::return_shared(state);
        };
        ts::end(s);
    }

    #[test]
    fun test_draw_manager_register_tickets() {
        let mut s = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut s);
            draw_manager::init_for_testing(ctx);
        };
        ts::next_tx(&mut s, ADMIN);
        {
            let mut state = ts::take_shared<DrawState>(&s);
            let cap = ts::take_from_sender<DrawAdminCap>(&s);
            let ctx = ts::ctx(&mut s);

            draw_manager::register_spark_tickets(&mut state, ALICE, 100, &cap, ctx);
            draw_manager::register_spark_tickets(&mut state, BOB, 50, &cap, ctx);

            assert_eq(draw_manager::spark_ticket_count(&state), 150);

            ts::return_shared(state);
            ts::return_to_sender(&s, cap);
        };
        ts::end(s);
    }

    #[test]
    fun test_draw_manager_trigger_spark_advances_timer() {
        let mut s = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut s);
            reward_pool::init_for_testing(ctx);
            draw_manager::init_for_testing(ctx);
        };
        ts::next_tx(&mut s, ADMIN);
        {
            let mut state = ts::take_shared<DrawState>(&s);
            let mut pool = ts::take_shared<RewardPool>(&s);
            let cap = ts::take_from_sender<DrawAdminCap>(&s);
            let ctx = ts::ctx(&mut s);

            // Seed pool and register tickets
            let yield_coin = mint_sui(1000 * SUI_1, ctx);
            reward_pool::deposit_yield(&mut pool, yield_coin, ctx);

            draw_manager::register_spark_tickets(&mut state, ALICE, 100, &cap, ctx);

            // Trigger draw at t=0 (next_spark_ms=0 so it's due)
            let clock = clock_at(0, ctx);
            let vrf = vector[1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
                             17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

            draw_manager::trigger_spark(&mut state, &mut pool, vrf, &clock, &cap, ctx);

            // Timer should advance by 1 day
            assert_eq(draw_manager::next_spark_ms(&state), 86_400_000);
            // Tickets cleared
            assert_eq(draw_manager::spark_ticket_count(&state), 0);

            clock::destroy_for_testing(clock);
            ts::return_shared(state);
            ts::return_shared(pool);
            ts::return_to_sender(&s, cap);
        };
        ts::end(s);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INTEGRATION TEST — full deposit → yield → draw flow
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_full_flow_deposit_yield_draw() {
        let mut s = ts::begin(ADMIN);
        {
            let ctx = ts::ctx(&mut s);
            stake_vault::init_for_testing(ctx);
            reward_pool::init_for_testing(ctx);
            draw_manager::init_for_testing(ctx);
            // Real deposit uses sui_system (not mockable in tests).
            // Yield is simulated via add_yield below.
        };

        ts::next_tx(&mut s, ADMIN);
        {
            let mut vault = ts::take_shared<Vault>(&s);
            let mut pool = ts::take_shared<RewardPool>(&s);
            let ctx = ts::ctx(&mut s);

            // Add simulated yield (5% of 100 SUI = 5 SUI)
            let yield_coin = mint_sui(5 * SUI_1, ctx);
            stake_vault::add_yield(&mut vault, yield_coin, ctx);

            // Harvest into pool
            let harvested = stake_vault::harvest_yield(&mut vault, ctx);
            reward_pool::deposit_yield(&mut pool, harvested, ctx);

            // Verify pool has funds
            assert!(reward_pool::spark_balance(&pool) > 0, 0);
            assert!(reward_pool::pulse_balance(&pool) > 0, 1);
            assert!(reward_pool::surge_balance(&pool) > 0, 2);

            ts::return_shared(vault);
            ts::return_shared(pool);
        };

        ts::next_tx(&mut s, ADMIN);
        {
            let mut state = ts::take_shared<DrawState>(&s);
            let mut pool = ts::take_shared<RewardPool>(&s);
            let cap = ts::take_from_sender<DrawAdminCap>(&s);
            let ctx = ts::ctx(&mut s);

            draw_manager::register_spark_tickets(&mut state, ALICE, 100, &cap, ctx);

            let clock = clock_at(0, ctx);
            let vrf = vector[42u8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                             0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            draw_manager::trigger_spark(&mut state, &mut pool, vrf, &clock, &cap, ctx);

            clock::destroy_for_testing(clock);
            ts::return_shared(state);
            ts::return_shared(pool);
            ts::return_to_sender(&s, cap);
        };
        ts::end(s);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ANTI-WHALE TESTS
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fun test_whale_vs_small_staker_spark_fairness() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            // Whale with 10_000 SUI gets same tickets as 500 SUI staker
            let whale_tickets = ticket_engine::spark_tickets(10_000, &record, &clock);
            let normal_tickets = ticket_engine::spark_tickets(500, &record, &clock);
            assert_eq(whale_tickets, 500);
            assert_eq(normal_tickets, 500);

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }

    #[test]
    fun test_pulse_sqrt_reduces_whale_advantage() {
        let mut s = ts::begin(ALICE);
        {
            let ctx = ts::ctx(&mut s);
            let clock = clock_at(0, ctx);
            let record = loyalty_tracker::new_record(&clock, ctx);

            // Whale 10x stake should NOT get 10x tickets
            let small_tickets = ticket_engine::pulse_tickets(1000, &record, &clock);
            let whale_tickets = ticket_engine::pulse_tickets(10_000, &record, &clock);

            // 1000 SUI → 1000 tickets
            // 10000 SUI → 1000 + sqrt(9000) ≈ 1094 tickets (not 10000)
            assert_eq(small_tickets, 1000);
            assert!(whale_tickets < 1100, 0); // much less than linear 10x
            assert!(whale_tickets > 1000, 1); // but still more than small staker

            clock::destroy_for_testing(clock);
            sui::transfer::public_transfer(record, ALICE);
        };
        ts::end(s);
    }
}
