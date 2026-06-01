/// Surge V2 — Loyalty Tracker
/// Time-weighted multiplier 1.0x → 2.0x over 365 days.
/// Streak bonus +0.3x max. Reset on full withdrawal.
module surge::loyalty_tracker {

    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::clock::{Self, Clock};

    // ── Constants ──────────────────────────────────────────────────────────────

    const MS_PER_DAY: u64 = 86_400_000;

    /// Multiplier tiers (stored as basis points: 1.0x = 10_000)
    const TIER_0_BP: u64 = 10_000; //   0– 29 days  → 1.0x
    const TIER_1_BP: u64 = 12_000; //  30– 89 days  → 1.2x
    const TIER_2_BP: u64 = 15_000; //  90–179 days  → 1.5x
    const TIER_3_BP: u64 = 18_000; // 180–364 days  → 1.8x
    const TIER_4_BP: u64 = 20_000; // 365+   days   → 2.0x (hard cap)

    const STREAK_BONUS_BP: u64 = 3_000; // max +0.3x for 30-day streak
    const MAX_MULTIPLIER_BP: u64 = 20_000; // absolute ceiling 2.0x

    // ── Errors ─────────────────────────────────────────────────────────────────

    const E_NOT_OWNER: u64 = 1;

    // ── Structs ────────────────────────────────────────────────────────────────

    /// Per-staker loyalty record, owned by the staker.
    public struct LoyaltyRecord has key, store {
        id: UID,
        owner: address,
        /// Timestamp (ms) of the first deposit that started this streak.
        stake_start_ms: u64,
        /// Timestamp of the last continuous-stake checkpoint (for streak).
        last_checkpoint_ms: u64,
        /// Consecutive days staked without interruption (capped at 30).
        streak_days: u64,
    }

    // ── Public Functions ───────────────────────────────────────────────────────

    /// Create a new LoyaltyRecord for a staker on first deposit.
    public fun new_record(clock: &Clock, ctx: &mut TxContext): LoyaltyRecord {
        let now = clock::timestamp_ms(clock);
        LoyaltyRecord {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            stake_start_ms: now,
            last_checkpoint_ms: now,
            streak_days: 0,
        }
    }

    /// Convenience entry: create and transfer LoyaltyRecord to sender in one call
    entry fun create_record(clock: &Clock, ctx: &mut TxContext) {
        let record = new_record(clock, ctx);
        transfer::transfer(record, tx_context::sender(ctx));
    }

    /// Called once per epoch by the crank to advance the streak.
    public fun tick(record: &mut LoyaltyRecord, clock: &Clock, ctx: &TxContext) {
        assert!(record.owner == tx_context::sender(ctx), E_NOT_OWNER);
        let now = clock::timestamp_ms(clock);
        let elapsed = now - record.last_checkpoint_ms;
        if (elapsed >= MS_PER_DAY) {
            let days = elapsed / MS_PER_DAY;
            record.streak_days = record.streak_days + days;
            if (record.streak_days > 30) {
                record.streak_days = 30;
            };
            record.last_checkpoint_ms = now;
        }
    }

    /// Reset loyalty on full withdrawal.
    public fun reset(record: &mut LoyaltyRecord, clock: &Clock, ctx: &TxContext) {
        assert!(record.owner == tx_context::sender(ctx), E_NOT_OWNER);
        let now = clock::timestamp_ms(clock);
        record.stake_start_ms = now;
        record.last_checkpoint_ms = now;
        record.streak_days = 0;
    }

    /// Returns the effective multiplier in basis points (10_000 = 1.0x).
    public fun multiplier_bp(record: &LoyaltyRecord, clock: &Clock): u64 {
        let now = clock::timestamp_ms(clock);
        let days_staked = (now - record.stake_start_ms) / MS_PER_DAY;

        let base_bp = if (days_staked >= 365) {
            TIER_4_BP
        } else if (days_staked >= 180) {
            TIER_3_BP
        } else if (days_staked >= 90) {
            TIER_2_BP
        } else if (days_staked >= 30) {
            TIER_1_BP
        } else {
            TIER_0_BP
        };

        // Streak bonus: scales linearly 0 → STREAK_BONUS_BP over 30 days
        let streak_bp = (record.streak_days * STREAK_BONUS_BP) / 30;
        let total = base_bp + streak_bp;

        if (total > MAX_MULTIPLIER_BP) { MAX_MULTIPLIER_BP } else { total }
    }

    /// Convenience: return days staked.
    public fun days_staked(record: &LoyaltyRecord, clock: &Clock): u64 {
        let now = clock::timestamp_ms(clock);
        (now - record.stake_start_ms) / MS_PER_DAY
    }

    public fun owner(record: &LoyaltyRecord): address { record.owner }
    public fun streak_days(record: &LoyaltyRecord): u64 { record.streak_days }
}
