/// Surge V2 — Draw Manager (Security Fix)
/// Fix: Replaced off-chain vrf_bytes with sui::random::Random → crank cannot predict winners
module surge::draw_manager {

    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::transfer;
    use sui::event;
    use sui::random::{Self, Random, RandomGenerator};
    use surge::reward_pool::{Self, RewardPool, PoolAdminCap};

    // ── Constants ──────────────────────────────────────────────────────────────

    const MS_PER_6H:    u64 = 21_600_000;
    const MS_PER_WEEK:  u64 = 604_800_000;
    const MS_PER_MONTH: u64 = 2_592_000_000;

    const SPARK_WINNERS:  u64 = 3;
    const PULSE_WINNERS:  u64 = 4;
    const SURGE_WINNERS:  u64 = 1;

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_TOO_EARLY:        u64 = 1;
    const E_NO_PARTICIPANTS:  u64 = 2;

    // ── Structs ────────────────────────────────────────────────────────────────

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

    // ── Events ─────────────────────────────────────────────────────────────────

    public struct DrawTriggered has copy, drop {
        draw_type: u8,
        draw_index: u64,
        winner_count: u64,
    }

    public struct TicketsRegistered has copy, drop {
        draw_type: u8,
        staker: address,
        ticket_count: u64,
    }

    // ── Init ───────────────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let admin = tx_context::sender(ctx);
        let state = DrawState {
            id: object::new(ctx),
            admin,
            next_spark_ms:  1747317600000,
            next_pulse_ms:  0,
            next_surge_ms:  0,
            spark_tickets:  vector[],
            pulse_tickets:  vector[],
            surge_tickets:  vector[],
            spark_draw_count: 0,
            pulse_draw_count: 0,
            surge_draw_count: 0,
        };
        transfer::share_object(state);

        let cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(cap, admin);
    }

    // ── Ticket Registration ────────────────────────────────────────────────────

    entry fun register_spark_tickets(
        state: &mut DrawState,
        staker: address,
        count: u64,
        _cap: &AdminCap,
        _ctx: &mut TxContext,
    ) {
        let mut i = 0;
        while (i < count) {
            vector::push_back(&mut state.spark_tickets, staker);
            i = i + 1;
        };
        event::emit(TicketsRegistered { draw_type: 0, staker, ticket_count: count });
    }

    entry fun register_pulse_tickets(
        state: &mut DrawState,
        staker: address,
        count: u64,
        _cap: &AdminCap,
        _ctx: &mut TxContext,
    ) {
        let mut i = 0;
        while (i < count) {
            vector::push_back(&mut state.pulse_tickets, staker);
            i = i + 1;
        };
        event::emit(TicketsRegistered { draw_type: 1, staker, ticket_count: count });
    }

    entry fun register_surge_tickets(
        state: &mut DrawState,
        staker: address,
        count: u64,
        _cap: &AdminCap,
        _ctx: &mut TxContext,
    ) {
        let mut i = 0;
        while (i < count) {
            vector::push_back(&mut state.surge_tickets, staker);
            i = i + 1;
        };
        event::emit(TicketsRegistered { draw_type: 2, staker, ticket_count: count });
    }

    // ── Draw Execution ─────────────────────────────────────────────────────────

    /// FIX: Uses sui::random::Random instead of vrf_bytes — on-chain verifiable, crank cannot predict
    entry fun trigger_spark(
        state: &mut DrawState,
        pool: &mut RewardPool,
        pool_cap: &PoolAdminCap,
        rng: &Random,
        clock: &Clock,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(now >= state.next_spark_ms, E_TOO_EARLY);

        let total_tickets = vector::length(&state.spark_tickets);
        assert!(total_tickets > 0, E_NO_PARTICIPANTS);

        let prize_per_winner = reward_pool::spark_balance(pool) / SPARK_WINNERS;
        let mut gen = random::new_generator(rng, ctx);
        let mut winners_drawn: u64 = 0;

        while (winners_drawn < SPARK_WINNERS) {
            let idx = random::generate_u64_in_range(&mut gen, 0, total_tickets - 1);
            let winner = *vector::borrow(&state.spark_tickets, idx);
            reward_pool::award_spark(pool, prize_per_winner, winner, pool_cap, ctx);
            winners_drawn = winners_drawn + 1;
        };

        state.spark_draw_count = state.spark_draw_count + 1;
        state.next_spark_ms = now + MS_PER_6H;
        state.spark_tickets = vector[];

        event::emit(DrawTriggered {
            draw_type: 0,
            draw_index: state.spark_draw_count,
            winner_count: SPARK_WINNERS,
        });
    }

    entry fun trigger_pulse(
        state: &mut DrawState,
        pool: &mut RewardPool,
        pool_cap: &PoolAdminCap,
        rng: &Random,
        clock: &Clock,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(now >= state.next_pulse_ms, E_TOO_EARLY);

        let total_tickets = vector::length(&state.pulse_tickets);
        assert!(total_tickets > 0, E_NO_PARTICIPANTS);

        let prize_per_winner = reward_pool::pulse_balance(pool) / PULSE_WINNERS;
        let mut gen = random::new_generator(rng, ctx);
        let mut winners_drawn: u64 = 0;

        while (winners_drawn < PULSE_WINNERS) {
            let idx = random::generate_u64_in_range(&mut gen, 0, total_tickets - 1);
            let winner = *vector::borrow(&state.pulse_tickets, idx);
            reward_pool::award_pulse(pool, prize_per_winner, winner, pool_cap, ctx);
            winners_drawn = winners_drawn + 1;
        };

        state.pulse_draw_count = state.pulse_draw_count + 1;
        state.next_pulse_ms = now + MS_PER_WEEK;
        state.pulse_tickets = vector[];

        event::emit(DrawTriggered {
            draw_type: 1,
            draw_index: state.pulse_draw_count,
            winner_count: PULSE_WINNERS,
        });
    }

    entry fun trigger_surge(
        state: &mut DrawState,
        pool: &mut RewardPool,
        pool_cap: &PoolAdminCap,
        rng: &Random,
        clock: &Clock,
        _cap: &AdminCap,
        ctx: &mut TxContext,
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

        event::emit(DrawTriggered {
            draw_type: 2,
            draw_index: state.surge_draw_count,
            winner_count: SURGE_WINNERS,
        });
    }

    // ── Accessors ──────────────────────────────────────────────────────────────

    public fun next_spark_ms(state: &DrawState): u64  { state.next_spark_ms }
    public fun next_pulse_ms(state: &DrawState): u64  { state.next_pulse_ms }
    public fun next_surge_ms(state: &DrawState): u64  { state.next_surge_ms }
    public fun spark_ticket_count(state: &DrawState): u64 { vector::length(&state.spark_tickets) }
    public fun pulse_ticket_count(state: &DrawState): u64 { vector::length(&state.pulse_tickets) }
    public fun surge_ticket_count(state: &DrawState): u64 { vector::length(&state.surge_tickets) }

    // ── Test Helpers ───────────────────────────────────────────────────────────
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
