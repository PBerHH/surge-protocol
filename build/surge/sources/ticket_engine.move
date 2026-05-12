/// Surge V2 — Ticket Engine
/// Anti-whale ticket formulas for all three draw types.
///   Spark:  min(stake_SUI, 500)          × loyalty_bp / 10_000
///   Pulse:  sqrt-scaled above 1 000 SUI  × loyalty_bp / 10_000
///   Surge:  stake_SUI (linear, no cap)   × loyalty_bp / 10_000
module surge::ticket_engine {

    use surge::loyalty_tracker::{Self, LoyaltyRecord};
    use sui::clock::Clock;

    // ── Constants ──────────────────────────────────────────────────────────────

    const SPARK_CAP: u64        = 500;    // hard cap at 500 tickets
    const PULSE_LINEAR_CAP: u64 = 1_000;  // linear below 1 000 SUI, sqrt above
    const MIN_STAKE_SUI: u64    = 10;     // absolute minimum

    // Unlock gates (in SUI)
    const GATE_SPARK: u64  = 10;
    const GATE_PULSE: u64  = 50;
    const GATE_SURGE: u64  = 200;

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_BELOW_MINIMUM: u64 = 1;

    // ── Public Functions ───────────────────────────────────────────────────────

    /// Spark tickets for a given stake amount (in whole SUI).
    public fun spark_tickets(
        stake_sui: u64,
        record: &LoyaltyRecord,
        clock: &Clock,
    ): u64 {
        assert!(stake_sui >= MIN_STAKE_SUI, E_BELOW_MINIMUM);
        if (stake_sui < GATE_SPARK) { return 0 };

        let raw = if (stake_sui > SPARK_CAP) { SPARK_CAP } else { stake_sui };
        apply_multiplier(raw, loyalty_tracker::multiplier_bp(record, clock))
    }

    /// Pulse tickets — linear up to 1 000 SUI, sqrt-scaled above.
    public fun pulse_tickets(
        stake_sui: u64,
        record: &LoyaltyRecord,
        clock: &Clock,
    ): u64 {
        assert!(stake_sui >= MIN_STAKE_SUI, E_BELOW_MINIMUM);
        if (stake_sui < GATE_PULSE) { return 0 };

        let raw = if (stake_sui <= PULSE_LINEAR_CAP) {
            stake_sui
        } else {
            // 1 000 + sqrt(stake - 1 000)  — integer sqrt via Newton's method
            PULSE_LINEAR_CAP + isqrt(stake_sui - PULSE_LINEAR_CAP)
        };
        apply_multiplier(raw, loyalty_tracker::multiplier_bp(record, clock))
    }

    /// Surge tickets — fully linear, no cap.
    public fun surge_tickets(
        stake_sui: u64,
        record: &LoyaltyRecord,
        clock: &Clock,
    ): u64 {
        assert!(stake_sui >= MIN_STAKE_SUI, E_BELOW_MINIMUM);
        if (stake_sui < GATE_SURGE) { return 0 };

        apply_multiplier(stake_sui, loyalty_tracker::multiplier_bp(record, clock))
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
