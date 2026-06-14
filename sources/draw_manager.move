/// Surge V3 — Draw Manager
/// FIX #1 (audit HIGH): tickets derived ON-CHAIN from the staker's REAL, TOTAL stake.
///
///   Spark (1 per wallet): user passes one receipt (proves >= 1 SUI staked) -> 1 ticket.
///   Pulse / Surge (sqrt-scaled): user aggregates ALL their receipts via a hot-potato
///     session, so tickets are computed from sqrt(TOTAL stake) ONCE. This prevents the
///     split-stake gaming attack (sqrt(1)*100 >> sqrt(100)) and counts every receipt.
///   Old AdminCap register_* functions are DEPRECATED (abort) — a compromised crank can
///     no longer inject arbitrary tickets.
///
///   Sui object ownership guarantees the stake is real: you can only pass receipts you own.
///   Dedup: per-period via dynamic-field tables (no struct change -> compatible upgrade).
///
/// FRONTEND: build a PTB  start_session -> add_receipt(r1) -> add_receipt(r2) ... ->
///   finish_pulse / finish_surge.  Ensure the user owns a LoyaltyRecord (create via
///   loyalty_tracker::new_record in a PTB on first stake; stake_vault does NOT auto-create it).
///
/// TESTNET DRAFT — compile + test on testnet before any mainnet upgrade.
/// Verify on testnet: does ticket_engine::pulse_tickets/surge_tickets RETURN 0 below the
///   gate, or ABORT? (affects whether sub-gate finish_* is a no-op or a revert.)
module surge::draw_manager {

    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::transfer;
    use sui::event;
    use sui::random::{Self, Random, RandomGenerator};
    use sui::table::{Self, Table};
    use sui::dynamic_field as df;
    use surge::reward_pool::{Self, RewardPool, PoolAdminCap};
    use surge::stake_vault::{Self, StakingReceipt};
    use surge::ticket_engine;
    use surge::loyalty_tracker::{Self, LoyaltyRecord};

    // ── Constants ──────────────────────────────────────────────────────────────

    const MS_PER_6H:    u64 = 21_600_000;
    const MS_PER_WEEK:  u64 = 604_800_000;
    const MS_PER_MONTH: u64 = 2_592_000_000;

    const SPARK_WINNERS:  u64 = 3;
    const PULSE_WINNERS:  u64 = 4;
    const SURGE_WINNERS:  u64 = 1;

    const MIST_PER_SUI: u64 = 1_000_000_000;

    // dynamic-field keys: staker -> draw index at last registration (per draw type)
    const DF_SPARK_REG: u8 = 10;
    const DF_PULSE_REG: u8 = 11;
    const DF_SURGE_REG: u8 = 12;

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_TOO_EARLY:          u64 = 1;
    const E_NO_PARTICIPANTS:    u64 = 2;
    const E_ALREADY_REGISTERED: u64 = 3;
    const E_DEPRECATED:         u64 = 4;
    const E_NOT_OWNER:          u64 = 5;
    const E_DUPLICATE_RECEIPT:  u64 = 6;

    // ── Structs (DrawState UNCHANGED — compatible upgrade) ───────────────────────

    public struct DrawState has key {
        id: UID,
        admin: address,
        next_spark_ms:  u64,
        next_pulse_ms:  u64,
        next_surge_ms:  u64,
        spark_tickets:  vector<address>,
        pulse_tickets:  vector<address>,
        surge_tickets:  vector<address>,
        spark_draw_count:  u64,
        pulse_draw_count:  u64,
        surge_draw_count:  u64,
    }

    public struct AdminCap has key, store { id: UID }

    /// Hot potato: accumulates a staker's TOTAL stake across receipts.
    /// No abilities -> cannot be dropped/stored; MUST be consumed by finish_pulse/finish_surge.
    public struct RegSession {
        staker: address,
        total_mist: u64,
        receipt_ids: vector<ID>,
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    public struct DrawTriggered has copy, drop { draw_type: u8, draw_index: u64, winner_count: u64 }
    public struct TicketsRegistered has copy, drop { draw_type: u8, staker: address, ticket_count: u64 }

    // ── Init ───────────────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let admin = tx_context::sender(ctx);
        let state = DrawState {
            id: object::new(ctx),
            admin,
            next_spark_ms: 1747317600000,
            next_pulse_ms: 0,
            next_surge_ms: 0,
            spark_tickets: vector[],
            pulse_tickets: vector[],
            surge_tickets: vector[],
            spark_draw_count: 0,
            pulse_draw_count: 0,
            surge_draw_count: 0,
        };
        transfer::share_object(state);
        transfer::transfer(AdminCap { id: object::new(ctx) }, admin);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────────

    /// Mark `staker` registered for `period` under `key`; abort if already this period.
    fun mark_registered(state: &mut DrawState, key: u8, staker: address, period: u64, ctx: &mut TxContext) {
        if (!df::exists(&state.id, key)) {
            df::add(&mut state.id, key, table::new<address, u64>(ctx));
        };
        let reg: &mut Table<address, u64> = df::borrow_mut(&mut state.id, key);
        if (table::contains(reg, staker)) {
            let last = *table::borrow(reg, staker);
            assert!(last != period, E_ALREADY_REGISTERED);
            *table::borrow_mut(reg, staker) = period;
        } else {
            table::add(reg, staker, period);
        };
    }

    fun push_n(v: &mut vector<address>, who: address, n: u64) {
        let mut i = 0;
        while (i < n) { vector::push_back(v, who); i = i + 1; };
    }

    // ── Spark registration (1 per wallet — single receipt is enough) ─────────────

    entry fun register_spark_v2(
        state: &mut DrawState,
        receipt: &StakingReceipt,
        record: &LoyaltyRecord,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let staker = tx_context::sender(ctx);
        let stake_sui = stake_vault::staking_receipt_principal(receipt) / MIST_PER_SUI;
        let count = ticket_engine::spark_tickets(stake_sui, record, clock);
        if (count == 0) { return };
        let period = state.spark_draw_count;
        mark_registered(state, DF_SPARK_REG, staker, period, ctx);
        push_n(&mut state.spark_tickets, staker, count);
        event::emit(TicketsRegistered { draw_type: 0, staker, ticket_count: count });
    }

    // ── Pulse / Surge registration (aggregate TOTAL stake via hot-potato session) ─

    /// Begin aggregating the caller's receipts. Consume with finish_pulse or finish_surge.
    public fun start_session(ctx: &TxContext): RegSession {
        RegSession { staker: tx_context::sender(ctx), total_mist: 0, receipt_ids: vector[] }
    }

    /// Add one of the caller's OWN receipts to the session (each receipt counts once).
    public fun add_receipt(session: &mut RegSession, receipt: &StakingReceipt, ctx: &TxContext) {
        assert!(session.staker == tx_context::sender(ctx), E_NOT_OWNER);
        let rid = object::id(receipt);
        assert!(!vector::contains(&session.receipt_ids, &rid), E_DUPLICATE_RECEIPT);
        vector::push_back(&mut session.receipt_ids, rid);
        session.total_mist = session.total_mist + stake_vault::staking_receipt_principal(receipt);
    }

    public fun finish_pulse(
        state: &mut DrawState,
        session: RegSession,
        record: &LoyaltyRecord,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let RegSession { staker, total_mist, receipt_ids: _ } = session;
        assert!(staker == tx_context::sender(ctx), E_NOT_OWNER);
        let stake_sui = total_mist / MIST_PER_SUI;
        let count = ticket_engine::pulse_tickets(stake_sui, record, clock);
        if (count == 0) { return };
        let period = state.pulse_draw_count;
        mark_registered(state, DF_PULSE_REG, staker, period, ctx);
        push_n(&mut state.pulse_tickets, staker, count);
        event::emit(TicketsRegistered { draw_type: 1, staker, ticket_count: count });
    }

    public fun finish_surge(
        state: &mut DrawState,
        session: RegSession,
        record: &LoyaltyRecord,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let RegSession { staker, total_mist, receipt_ids: _ } = session;
        assert!(staker == tx_context::sender(ctx), E_NOT_OWNER);
        let stake_sui = total_mist / MIST_PER_SUI;
        let count = ticket_engine::surge_tickets(stake_sui, record, clock);
        if (count == 0) { return };
        let period = state.surge_draw_count;
        mark_registered(state, DF_SURGE_REG, staker, period, ctx);
        push_n(&mut state.surge_tickets, staker, count);
        event::emit(TicketsRegistered { draw_type: 2, staker, ticket_count: count });
    }

    // ── DEPRECATED registration (old off-chain-trust path; bodies abort) ─────────

    entry fun register_spark_tickets(_s: &mut DrawState, _a: address, _c: u64, _cap: &AdminCap, _ctx: &mut TxContext) { abort E_DEPRECATED }
    entry fun register_pulse_tickets(_s: &mut DrawState, _a: address, _c: u64, _cap: &AdminCap, _ctx: &mut TxContext) { abort E_DEPRECATED }
    entry fun register_surge_tickets(_s: &mut DrawState, _a: address, _c: u64, _cap: &AdminCap, _ctx: &mut TxContext) { abort E_DEPRECATED }

    // ── Draw Execution (unchanged here; permissionless trigger = Fix #2) ─────────

    entry fun trigger_spark(
        state: &mut DrawState, pool: &mut RewardPool, pool_cap: &PoolAdminCap,
        rng: &Random, clock: &Clock, _cap: &AdminCap, ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(now >= state.next_spark_ms, E_TOO_EARLY);
        let total_tickets = vector::length(&state.spark_tickets);
        assert!(total_tickets > 0, E_NO_PARTICIPANTS);
        let prize_per_winner = reward_pool::spark_balance(pool) / SPARK_WINNERS;
        let mut gen = random::new_generator(rng, ctx);
        let mut w: u64 = 0;
        while (w < SPARK_WINNERS) {
            let idx = random::generate_u64_in_range(&mut gen, 0, total_tickets - 1);
            let winner = *vector::borrow(&state.spark_tickets, idx);
            reward_pool::award_spark(pool, prize_per_winner, winner, pool_cap, ctx);
            w = w + 1;
        };
        state.spark_draw_count = state.spark_draw_count + 1;
        state.next_spark_ms = now + MS_PER_6H;
        state.spark_tickets = vector[];
        event::emit(DrawTriggered { draw_type: 0, draw_index: state.spark_draw_count, winner_count: SPARK_WINNERS });
    }

    entry fun trigger_pulse(
        state: &mut DrawState, pool: &mut RewardPool, pool_cap: &PoolAdminCap,
        rng: &Random, clock: &Clock, _cap: &AdminCap, ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(now >= state.next_pulse_ms, E_TOO_EARLY);
        let total_tickets = vector::length(&state.pulse_tickets);
        assert!(total_tickets > 0, E_NO_PARTICIPANTS);
        let prize_per_winner = reward_pool::pulse_balance(pool) / PULSE_WINNERS;
        let mut gen = random::new_generator(rng, ctx);
        let mut w: u64 = 0;
        while (w < PULSE_WINNERS) {
            let idx = random::generate_u64_in_range(&mut gen, 0, total_tickets - 1);
            let winner = *vector::borrow(&state.pulse_tickets, idx);
            reward_pool::award_pulse(pool, prize_per_winner, winner, pool_cap, ctx);
            w = w + 1;
        };
        state.pulse_draw_count = state.pulse_draw_count + 1;
        state.next_pulse_ms = now + MS_PER_WEEK;
        state.pulse_tickets = vector[];
        event::emit(DrawTriggered { draw_type: 1, draw_index: state.pulse_draw_count, winner_count: PULSE_WINNERS });
    }

    entry fun trigger_surge(
        state: &mut DrawState, pool: &mut RewardPool, pool_cap: &PoolAdminCap,
        rng: &Random, clock: &Clock, _cap: &AdminCap, ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(now >= state.next_surge_ms, E_TOO_EARLY);
        let total_tickets = vector::length(&state.surge_tickets);
        assert!(total_tickets > 0, E_NO_PARTICIPANTS);
        let jackpot = reward_pool::surge_balance(pool);
        let mut gen = random::new_generator(rng, ctx);
        let idx = random::generate_u64_in_range(&mut gen, 0, total_tickets - 1);
        let winner = *vector::borrow(&state.surge_tickets, idx);
        reward_pool::award_surge(pool, jackpot, winner, pool_cap, ctx);
        state.surge_draw_count = state.surge_draw_count + 1;
        state.next_surge_ms = now + MS_PER_MONTH;
        state.surge_tickets = vector[];
        event::emit(DrawTriggered { draw_type: 2, draw_index: state.surge_draw_count, winner_count: SURGE_WINNERS });
    }

    // ── Accessors ──────────────────────────────────────────────────────────────

    public fun next_spark_ms(s: &DrawState): u64 { s.next_spark_ms }
    public fun next_pulse_ms(s: &DrawState): u64 { s.next_pulse_ms }
    public fun next_surge_ms(s: &DrawState): u64 { s.next_surge_ms }
    public fun spark_ticket_count(s: &DrawState): u64 { vector::length(&s.spark_tickets) }
    public fun pulse_ticket_count(s: &DrawState): u64 { vector::length(&s.pulse_tickets) }
    public fun surge_ticket_count(s: &DrawState): u64 { vector::length(&s.surge_tickets) }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }

    // ── Tests (run with: sui move test) ──────────────────────────────────────────
    // Validate Fix #1's NEW logic without real staking/network. Requires the
    // #[test_only] stake_vault::new_receipt_for_testing constructor.

    #[test_only] use sui::test_scenario as ts;
    #[test_only] use sui::test_utils;

    #[test_only] const ALICE: address = @0xA11CE;
    #[test_only] const TWELVE_SUI: u64 = 12_000_000_000;

    /// TEST A — on-chain derivation: a spark registration yields exactly 1 ticket.
    #[test]
    fun test_spark_registration() {
        let mut sc = ts::begin(ALICE);
        init_for_testing(ts::ctx(&mut sc));
        ts::next_tx(&mut sc, ALICE);

        let mut state = ts::take_shared<DrawState>(&sc);
        let clk = clock::create_for_testing(ts::ctx(&mut sc));
        let record = loyalty_tracker::new_record(&clk, ts::ctx(&mut sc));
        let receipt = stake_vault::new_receipt_for_testing(ALICE, TWELVE_SUI, ts::ctx(&mut sc));

        register_spark_v2(&mut state, &receipt, &record, &clk, ts::ctx(&mut sc));
        assert!(spark_ticket_count(&state) == 1, 0);

        test_utils::destroy(receipt);
        test_utils::destroy(record);
        clock::destroy_for_testing(clk);
        ts::return_shared(state);
        ts::end(sc);
    }

    /// TEST B — dedup: a second spark registration in the same period aborts.
    #[test]
    #[expected_failure(abort_code = E_ALREADY_REGISTERED)]
    fun test_spark_dedup_aborts() {
        let mut sc = ts::begin(ALICE);
        init_for_testing(ts::ctx(&mut sc));
        ts::next_tx(&mut sc, ALICE);

        let mut state = ts::take_shared<DrawState>(&sc);
        let clk = clock::create_for_testing(ts::ctx(&mut sc));
        let record = loyalty_tracker::new_record(&clk, ts::ctx(&mut sc));
        let receipt = stake_vault::new_receipt_for_testing(ALICE, TWELVE_SUI, ts::ctx(&mut sc));

        register_spark_v2(&mut state, &receipt, &record, &clk, ts::ctx(&mut sc));
        register_spark_v2(&mut state, &receipt, &record, &clk, ts::ctx(&mut sc)); // aborts

        test_utils::destroy(receipt);
        test_utils::destroy(record);
        clock::destroy_for_testing(clk);
        ts::return_shared(state);
        ts::end(sc);
    }

    /// TEST C — aggregation: pulse tickets are derived from the TOTAL of all receipts.
    #[test]
    fun test_pulse_aggregation_uses_total() {
        let mut sc = ts::begin(ALICE);
        init_for_testing(ts::ctx(&mut sc));
        ts::next_tx(&mut sc, ALICE);

        let mut state = ts::take_shared<DrawState>(&sc);
        let clk = clock::create_for_testing(ts::ctx(&mut sc));
        let record = loyalty_tracker::new_record(&clk, ts::ctx(&mut sc));
        let r1 = stake_vault::new_receipt_for_testing(ALICE, TWELVE_SUI, ts::ctx(&mut sc));
        let r2 = stake_vault::new_receipt_for_testing(ALICE, TWELVE_SUI, ts::ctx(&mut sc));

        // expected = ticket_engine applied to the combined 24 SUI (sqrt of TOTAL, once)
        let expected = ticket_engine::pulse_tickets(24, &record, &clk);

        let mut sess = start_session(ts::ctx(&mut sc));
        add_receipt(&mut sess, &r1, ts::ctx(&mut sc));
        add_receipt(&mut sess, &r2, ts::ctx(&mut sc));
        finish_pulse(&mut state, sess, &record, &clk, ts::ctx(&mut sc));

        // proves finish_pulse used the 24-SUI total, not one receipt or per-receipt sqrt
        assert!(pulse_ticket_count(&state) == expected, 0);

        test_utils::destroy(r1);
        test_utils::destroy(r2);
        test_utils::destroy(record);
        clock::destroy_for_testing(clk);
        ts::return_shared(state);
        ts::end(sc);
    }

    /// TEST D — replay guard: adding the same receipt twice in one session aborts.
    #[test]
    #[expected_failure(abort_code = E_DUPLICATE_RECEIPT)]
    fun test_duplicate_receipt_aborts() {
        let mut sc = ts::begin(ALICE);
        let clk = clock::create_for_testing(ts::ctx(&mut sc));
        let r1 = stake_vault::new_receipt_for_testing(ALICE, TWELVE_SUI, ts::ctx(&mut sc));

        let mut sess = start_session(ts::ctx(&mut sc));
        add_receipt(&mut sess, &r1, ts::ctx(&mut sc));
        add_receipt(&mut sess, &r1, ts::ctx(&mut sc)); // aborts

        let RegSession { staker: _, total_mist: _, receipt_ids: _ } = sess;
        test_utils::destroy(r1);
        clock::destroy_for_testing(clk);
        ts::end(sc);
    }
}
