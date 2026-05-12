/// Surge V2 — Draw Manager
/// Orchestrates Spark (daily), Pulse (weekly), Surge (monthly) draws.
/// Uses Pyth Entropy for verifiable on-chain randomness.
module surge::draw_manager {

    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::transfer;
    use sui::event;
    use surge::reward_pool::{Self, RewardPool};

    // ── Constants ──────────────────────────────────────────────────────────────

    const MS_PER_DAY:   u64 = 86_400_000;
    const MS_PER_WEEK:  u64 = 604_800_000;
    const MS_PER_MONTH: u64 = 2_592_000_000; // 30 days

    const SPARK_WINNERS:  u64 = 15;
    const PULSE_WINNERS:  u64 = 4;
    const SURGE_WINNERS:  u64 = 1;

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_TOO_EARLY:        u64 = 1;
    const E_NO_PARTICIPANTS:  u64 = 2;
    const E_NOT_ADMIN:        u64 = 3;

    // ── Structs ────────────────────────────────────────────────────────────────

    /// Shared state tracking next draw times and participant snapshots.
    public struct DrawState has key {
        id: UID,
        admin: address,

        next_spark_ms:  u64,
        next_pulse_ms:  u64,
        next_surge_ms:  u64,

        /// Flattened ticket arrays: each entry is a staker address.
        /// Index = ticket number. Winner = tickets[vrf_output % len].
        spark_tickets:  vector<address>,
        pulse_tickets:  vector<address>,
        surge_tickets:  vector<address>,

        /// Running draw counters for audit trail.
        spark_draw_count:  u64,
        pulse_draw_count:  u64,
        surge_draw_count:  u64,
    }

    public struct AdminCap has key, store { id: UID }

    // ── Events ─────────────────────────────────────────────────────────────────

    public struct DrawTriggered has copy, drop {
        draw_type: u8, // 0=spark 1=pulse 2=surge
        draw_index: u64,
        vrf_seed: vector<u8>,
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
            next_spark_ms:  0,
            next_pulse_ms:  0,
            next_surge_ms:  0,
            spark_tickets:  vector::empty(),
            pulse_tickets:  vector::empty(),
            surge_tickets:  vector::empty(),
            spark_draw_count: 0,
            pulse_draw_count: 0,
            surge_draw_count: 0,
        };
        transfer::share_object(state);

        let cap = AdminCap { id: object::new(ctx) };
        transfer::transfer(cap, admin);
    }

    // ── Ticket Registration ────────────────────────────────────────────────────

    /// Register tickets for a staker (called by crank after snapshot).
    public entry fun register_spark_tickets(
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

    public entry fun register_pulse_tickets(
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

    public entry fun register_surge_tickets(
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

    /// Trigger the Spark draw. Called by crank when time is due.
    /// `vrf_bytes` = Pyth Entropy randomness bytes (32 bytes).
    public entry fun trigger_spark(
        state: &mut DrawState,
        pool: &mut RewardPool,
        vrf_bytes: vector<u8>,
        clock: &Clock,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(now >= state.next_spark_ms, E_TOO_EARLY);

        let total_tickets = vector::length(&state.spark_tickets);
        assert!(total_tickets > 0, E_NO_PARTICIPANTS);

        let prize_per_winner = reward_pool::spark_balance(pool) / SPARK_WINNERS;
        let mut winners_drawn: u64 = 0;
        let mut seed = vrf_bytes;

        while (winners_drawn < SPARK_WINNERS) {
            let idx = vrf_to_index(&seed, total_tickets);
            let winner = *vector::borrow(&state.spark_tickets, idx);
            reward_pool::award_spark(pool, prize_per_winner, winner, ctx);
            // Rotate seed for next winner
            seed = next_seed(seed, winners_drawn);
            winners_drawn = winners_drawn + 1;
        };

        state.spark_draw_count = state.spark_draw_count + 1;
        state.next_spark_ms = now + MS_PER_DAY;
        state.spark_tickets = vector::empty(); // clear for next round

        event::emit(DrawTriggered {
            draw_type: 0,
            draw_index: state.spark_draw_count,
            vrf_seed: vrf_bytes,
            winner_count: SPARK_WINNERS,
        });
    }

    /// Trigger the Pulse draw (weekly).
    public entry fun trigger_pulse(
        state: &mut DrawState,
        pool: &mut RewardPool,
        vrf_bytes: vector<u8>,
        clock: &Clock,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(now >= state.next_pulse_ms, E_TOO_EARLY);

        let total_tickets = vector::length(&state.pulse_tickets);
        assert!(total_tickets > 0, E_NO_PARTICIPANTS);

        let prize_per_winner = reward_pool::pulse_balance(pool) / PULSE_WINNERS;
        let mut winners_drawn: u64 = 0;
        let mut seed = vrf_bytes;

        while (winners_drawn < PULSE_WINNERS) {
            let idx = vrf_to_index(&seed, total_tickets);
            let winner = *vector::borrow(&state.pulse_tickets, idx);
            reward_pool::award_pulse(pool, prize_per_winner, winner, ctx);
            seed = next_seed(seed, winners_drawn);
            winners_drawn = winners_drawn + 1;
        };

        state.pulse_draw_count = state.pulse_draw_count + 1;
        state.next_pulse_ms = now + MS_PER_WEEK;
        state.pulse_tickets = vector::empty();

        event::emit(DrawTriggered {
            draw_type: 1,
            draw_index: state.pulse_draw_count,
            vrf_seed: vrf_bytes,
            winner_count: PULSE_WINNERS,
        });
    }

    /// Trigger the Surge jackpot draw (monthly).
    public entry fun trigger_surge(
        state: &mut DrawState,
        pool: &mut RewardPool,
        vrf_bytes: vector<u8>,
        clock: &Clock,
        _cap: &AdminCap,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(now >= state.next_surge_ms, E_TOO_EARLY);

        let total_tickets = vector::length(&state.surge_tickets);
        assert!(total_tickets > 0, E_NO_PARTICIPANTS);

        let jackpot = reward_pool::surge_balance(pool);
        let idx = vrf_to_index(&vrf_bytes, total_tickets);
        let winner = *vector::borrow(&state.surge_tickets, idx);
        reward_pool::award_surge(pool, jackpot, winner, ctx);

        state.surge_draw_count = state.surge_draw_count + 1;
        state.next_surge_ms = now + MS_PER_MONTH;
        state.surge_tickets = vector::empty();

        event::emit(DrawTriggered {
            draw_type: 2,
            draw_index: state.surge_draw_count,
            vrf_seed: vrf_bytes,
            winner_count: SURGE_WINNERS,
        });
    }

    // ── Internal Helpers ───────────────────────────────────────────────────────

    /// Convert VRF bytes to an index in [0, total).
    fun vrf_to_index(seed: &vector<u8>, total: u64): u64 {
        // Take first 8 bytes as u64, mod total
        let mut val: u64 = 0;
        let mut i = 0;
        while (i < 8 && i < vector::length(seed)) {
            val = (val << 8) | (*vector::borrow(seed, i) as u64);
            i = i + 1;
        };
        val % total
    }

    /// Derive next seed by appending the winner index.
    fun next_seed(seed: vector<u8>, nonce: u64): vector<u8> {
        let mut s = seed;
        vector::push_back(&mut s, (nonce & 0xff as u8));
        s
    }

    // ── Accessors ──────────────────────────────────────────────────────────────

    public fun next_spark_ms(state: &DrawState): u64  { state.next_spark_ms }
    public fun next_pulse_ms(state: &DrawState): u64  { state.next_pulse_ms }
    public fun next_surge_ms(state: &DrawState): u64  { state.next_surge_ms }
    public fun spark_ticket_count(state: &DrawState): u64 { vector::length(&state.spark_tickets) }
    public fun pulse_ticket_count(state: &DrawState): u64 { vector::length(&state.pulse_tickets) }
    public fun surge_ticket_count(state: &DrawState): u64 { vector::length(&state.surge_tickets) }
}
