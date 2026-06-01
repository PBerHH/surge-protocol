/// Surge V6 — Ticket Engine
/// New draw design:
///   Spark:  1 ticket per wallet (equal odds, no multiplier) — min 1 SUI
///   Pulse:  √stake tickets × loyalty — min 10 SUI
///   Surge:  √stake tickets × loyalty — min 50 SUI
///
/// Equal-odds Spark = every staker has the same daily chance regardless of size.
/// √stake for Pulse/Surge = proportional but anti-whale (1000 SUI → 31 tickets,
/// not 100× more than 10 SUI staker who gets 3 tickets).
module surge::ticket_engine {

    use surge::loyalty_tracker::{Self, LoyaltyRecord};
    use sui::clock::Clock;

    // ── Constants ──────────────────────────────────────────────────────────────

    const SPARK_CAP: u64        = 1;   // equal odds: always 1 ticket
    const PULSE_LINEAR_CAP: u64 = 0;   // unused (kept for accessor compatibility)
    const MIN_STAKE_SUI: u64    = 1;   // 1 SUI minimum

    // Gates (in whole SUI)
    const GATE_SPARK: u64  = 1;   // any stake qualifies
    const GATE_PULSE: u64  = 10;  // 10 SUI to enter weekly draw
    const GATE_SURGE: u64  = 50;  // 50 SUI to enter monthly draw

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_BELOW_MINIMUM: u64 = 1;

    // ── Public Functions ───────────────────────────────────────────────────────

    /// Spark — equal odds: exactly 1 ticket per wallet, no loyalty multiplier.
    /// Every staker (≥ 1 SUI) has the same daily chance regardless of stake size.
    public fun spark_tickets(
        stake_sui: u64,
        _record: &LoyaltyRecord,
        _clock: &Clock,
    ): u64 {
        assert!(stake_sui >= MIN_STAKE_SUI, E_BELOW_MINIMUM);
        if (stake_sui < GATE_SPARK) { return 0 };
        1
    }

    /// Pulse — √stake tickets × loyalty multiplier, minimum 10 SUI.
    /// Anti-whale: 10 SUI → 3 tickets, 100 SUI → 10, 1 000 SUI → 31, 10 000 SUI → 100.
    public fun pulse_tickets(
        stake_sui: u64,
        record: &LoyaltyRecord,
        clock: &Clock,
    ): u64 {
        assert!(stake_sui >= MIN_STAKE_SUI, E_BELOW_MINIMUM);
        if (stake_sui < GATE_PULSE) { return 0 };
        let raw = isqrt(stake_sui);
        let tickets = apply_multiplier(raw, loyalty_tracker::multiplier_bp(record, clock));
        if (tickets == 0) { 1 } else { tickets }
    }

    /// Surge — √stake tickets × loyalty multiplier, minimum 50 SUI.
    /// Same anti-whale formula as Pulse.
    public fun surge_tickets(
        stake_sui: u64,
        record: &LoyaltyRecord,
        clock: &Clock,
    ): u64 {
        assert!(stake_sui >= MIN_STAKE_SUI, E_BELOW_MINIMUM);
        if (stake_sui < GATE_SURGE) { return 0 };
        let raw = isqrt(stake_sui);
        let tickets = apply_multiplier(raw, loyalty_tracker::multiplier_bp(record, clock));
        if (tickets == 0) { 1 } else { tickets }
    }

    // ── Internal Helpers ───────────────────────────────────────────────────────

    fun apply_multiplier(raw: u64, multiplier_bp: u64): u64 {
        (raw * multiplier_bp) / 10_000
    }

    /// Integer square root via Newton's method.
    fun isqrt(n: u64): u64 {
        if (n == 0) { return 0 };
        let mut x = n;
        let mut y = (x + 1) / 2;
        while (y < x) {
            x = y;
            y = (x + n / x) / 2;
        };
        x
    }

    // ── Accessors ──────────────────────────────────────────────────────────────

    public fun min_stake(): u64  { MIN_STAKE_SUI }
    public fun gate_spark(): u64 { GATE_SPARK }
    public fun gate_pulse(): u64 { GATE_PULSE }
    public fun gate_surge(): u64 { GATE_SURGE }
    public fun spark_cap(): u64  { SPARK_CAP }
}
