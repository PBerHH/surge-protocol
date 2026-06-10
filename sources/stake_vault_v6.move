/// Surge v6 — haSUI Yield Engine
///
/// THE FIX: the vault holds appreciating haSUI instead of native StakedSui.
/// Yield = haSUI rate appreciation (continuous, no warmup, O(1) at any TVL).
/// Harvest can mathematically never touch principal: the contract enforces
///     surplus_ha = ha_balance − ceil(total_principal / rate) − safety_margin
/// on-chain, using Haedal's on-chain exchange rate. The crank only ever
/// handles yield (same trust profile as V5); principal never passes through it.
///
/// No-loss: withdrawals redeem haSUI via Haedal's NATIVE delayed unstake
/// (exact appreciated rate, zero fee, 1–2 epochs). Rate is monotonically
/// increasing, so ceil(principal/rate) haSUI always redeems ≥ principal.
///
/// Mainnet constants (verified from github.com/haedallsd/haedal-protocol-interface):
///   Haedal Staking object: 0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca
///   HASUI coin type pkg:   0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d
module surge::stake_vault_v6 {

    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::transfer;
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui_system::sui_system::SuiSystemState;
    use haedal::hasui::HASUI;
    use haedal::staking::{Self as ha_staking, Staking};
    use haedal::interface as ha_interface;

    // ── Constants ────────────────────────────────────────────────────────────

    const RATE_SCALE: u128 = 1_000_000;        // Haedal rate is ×1e6
    const MIN_STAKE_MIST: u64 = 1_000_000_000; // 1 SUI
    /// Extra haSUI kept locked beyond exact principal coverage (rounding guard).
    const SAFETY_BPS: u128 = 10;               // 0.10%
    /// Don't bother harvesting dust (in haSUI units).
    const MIN_HARVEST_HA: u64 = 100_000_000;   // 0.1 haSUI

    // ── Errors ───────────────────────────────────────────────────────────────

    const E_NOT_OWNER: u64        = 1;
    const E_BELOW_MINIMUM: u64    = 2;
    const E_NOTHING_TO_HARVEST: u64 = 3;
    const E_RATE_INVALID: u64     = 4;
    const E_COVERAGE_BROKEN: u64  = 5;

    // ── Structs ──────────────────────────────────────────────────────────────

    public struct VaultV6 has key {
        id: UID,
        /// ALL user principal, held as appreciating haSUI.
        ha_balance: Balance<HASUI>,
        /// No-loss obligation in SUI mist. Source of truth.
        total_principal: u64,
        /// Harvested yield (SUI) waiting for the crank to route into the
        /// reward_pool (Spark/Pulse/Surge) — same flow as V5.
        pending_rewards: Balance<SUI>,
    }

    /// Crank capability (harvest + reward routing). Mirrors V5's VaultAdminCap.
    public struct VaultV6AdminCap has key, store { id: UID }

    public struct StakeReceiptV6 has key, store {
        id: UID,
        owner: address,
        principal_mist: u64,
        deposit_ts_ms: u64,
    }

    // ── Events (frontend / points-worker query these) ────────────────────────

    public struct StakedV6 has copy, drop {
        owner: address, principal_mist: u64, ha_locked: u64, ts_ms: u64,
    }
    public struct UnstakedV6 has copy, drop {
        owner: address, principal_mist: u64, ha_released: u64, ts_ms: u64,
    }
    public struct HarvestedV6 has copy, drop {
        surplus_ha: u64, rate_scaled: u64, total_principal: u64, ts_ms: u64,
    }
    public struct RewardsDepositedV6 has copy, drop { amount_mist: u64, ts_ms: u64 }

    // ── Init ─────────────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        transfer::share_object(VaultV6 {
            id: object::new(ctx),
            ha_balance: balance::zero<HASUI>(),
            total_principal: 0,
            pending_rewards: balance::zero<SUI>(),
        });
        transfer::transfer(
            VaultV6AdminCap { id: object::new(ctx) },
            tx_context::sender(ctx),
        );
    }

    // ── Internal: rate & coverage math ───────────────────────────────────────

    fun rate_scaled(staking: &Staking): u128 {
        let r = (ha_staking::get_exchange_rate(staking) as u128);
        // rate is haSUI:SUI ≥ 1.0 → scaled value ≥ 1e6. Anything else is broken.
        assert!(r >= RATE_SCALE, E_RATE_INVALID);
        r
    }

    /// haSUI needed to cover `sui_mist` at `rate`, rounded UP (never undershoot).
    /// ha = sui / rate  →  ha = sui * 1e6 / rate_scaled, ceil.
    fun ha_for_sui_ceil(sui_mist: u64, rate: u128): u64 {
        let num = (sui_mist as u128) * RATE_SCALE;
        (((num + rate - 1) / rate) as u64)
    }

    /// haSUI that must STAY locked: exact coverage + safety margin (bps).
    fun required_ha(total_principal: u64, rate: u128): u64 {
        let exact = (ha_for_sui_ceil(total_principal, rate) as u128);
        (((exact * (10_000 + SAFETY_BPS) + 9_999) / 10_000) as u64)
    }

    // ── stake ────────────────────────────────────────────────────────────────

    /// User stakes SUI. Atomically converted to haSUI inside this call —
    /// no warmup, yield accrues from this transaction onward. O(1).
    /// validator @0x0 = Haedal auto-selects.
    public entry fun stake(
        vault: &mut VaultV6,
        wrapper: &mut SuiSystemState,
        staking: &mut Staking,
        input: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&input);
        assert!(amount >= MIN_STAKE_MIST, E_BELOW_MINIMUM);

        let ha: Coin<HASUI> =
            ha_staking::request_stake_coin(wrapper, staking, input, @0x0, ctx);
        let ha_amount = coin::value(&ha);
        balance::join(&mut vault.ha_balance, coin::into_balance(ha));
        vault.total_principal = vault.total_principal + amount;

        let sender = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock);
        transfer::transfer(
            StakeReceiptV6 {
                id: object::new(ctx),
                owner: sender,
                principal_mist: amount,
                deposit_ts_ms: now,
            },
            sender,
        );
        event::emit(StakedV6 {
            owner: sender, principal_mist: amount, ha_locked: ha_amount, ts_ms: now,
        });
        // TODO(integration): wire loyalty_tracker + ticket eligibility exactly
        // as V5 stake() does (gates 1/10/50 unchanged — driven off receipts/events).
    }

    // ── unstake (no-loss exit) ───────────────────────────────────────────────

    /// Burns the receipt, releases exactly the haSUI needed to cover the
    /// principal at the CURRENT rate, and starts Haedal's native delayed
    /// unstake. The UnstakeTicket goes to the USER (Haedal transfers it to the
    /// tx sender); after 1–2 epochs the user claims via Haedal's claim_v2 and
    /// receives ≥ principal (rate only rises). Fee-free, exact, no slippage.
    public entry fun request_unstake(
        vault: &mut VaultV6,
        staking: &mut Staking,
        receipt: StakeReceiptV6,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(receipt.owner == sender, E_NOT_OWNER);
        let StakeReceiptV6 { id, owner: _, principal_mist, deposit_ts_ms: _ } = receipt;
        object::delete(id);

        let rate = rate_scaled(staking);
        let need_ha = ha_for_sui_ceil(principal_mist, rate);

        let ha_out = coin::from_balance(
            balance::split(&mut vault.ha_balance, need_ha), ctx);
        ha_interface::request_unstake_delay(staking, clock, ha_out, ctx);

        vault.total_principal = vault.total_principal - principal_mist;

        event::emit(UnstakedV6 {
            owner: sender,
            principal_mist,
            ha_released: need_ha,
            ts_ms: clock::timestamp_ms(clock),
        });
    }

    // ── harvest (crank, yield only — principal mathematically untouchable) ──

    /// Releases ONLY the surplus haSUI above on-chain-verified principal
    /// coverage and starts its native redemption. Ticket → crank wallet;
    /// after 1–2 epochs the crank claims SUI and returns it via
    /// deposit_rewards(). Even a fully compromised crank key can never reach
    /// principal through this function.
    public entry fun harvest(
        vault: &mut VaultV6,
        staking: &mut Staking,
        _cap: &VaultV6AdminCap,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let rate = rate_scaled(staking);
        let required = required_ha(vault.total_principal, rate);
        let held = balance::value(&vault.ha_balance);
        assert!(held > required, E_NOTHING_TO_HARVEST);

        let surplus = held - required;
        assert!(surplus >= MIN_HARVEST_HA, E_NOTHING_TO_HARVEST);

        let ha_out = coin::from_balance(
            balance::split(&mut vault.ha_balance, surplus), ctx);
        ha_interface::request_unstake_delay(staking, clock, ha_out, ctx);

        // Post-condition: coverage still intact.
        assert!(
            balance::value(&vault.ha_balance) >= ha_for_sui_ceil(vault.total_principal, rate),
            E_COVERAGE_BROKEN
        );

        event::emit(HarvestedV6 {
            surplus_ha: surplus,
            rate_scaled: (rate as u64),
            total_principal: vault.total_principal,
            ts_ms: clock::timestamp_ms(clock),
        });
    }

    /// Crank returns claimed harvest SUI. From here it is routed into the
    /// reward_pool exactly like V5 (withdraw_rewards below).
    public entry fun deposit_rewards(
        vault: &mut VaultV6,
        _cap: &VaultV6AdminCap,
        input: Coin<SUI>,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        let amount = coin::value(&input);
        balance::join(&mut vault.pending_rewards, coin::into_balance(input));
        event::emit(RewardsDepositedV6 { amount_mist: amount, ts_ms: clock::timestamp_ms(clock) });
    }

    /// Crank pulls pending rewards to fund Spark/Pulse/Surge pools (V5 flow).
    public fun withdraw_rewards(
        vault: &mut VaultV6,
        _cap: &VaultV6AdminCap,
        amount: u64,
        ctx: &mut TxContext,
    ): Coin<SUI> {
        coin::from_balance(balance::split(&mut vault.pending_rewards, amount), ctx)
    }

    // ── Views ────────────────────────────────────────────────────────────────

    public fun total_principal(v: &VaultV6): u64 { v.total_principal }
    public fun ha_held(v: &VaultV6): u64 { balance::value(&v.ha_balance) }
    public fun pending_rewards_value(v: &VaultV6): u64 { balance::value(&v.pending_rewards) }
    public fun receipt_principal(r: &StakeReceiptV6): u64 { r.principal_mist }
    public fun receipt_owner(r: &StakeReceiptV6): address { r.owner }

    // ── Test-only (accounting & invariants testable without live Haedal; the
    //    real Haedal calls are exercised in the testnet integration test) ─────

    #[test_only]
    public fun test_new_vault(ctx: &mut TxContext): VaultV6 {
        VaultV6 {
            id: object::new(ctx),
            ha_balance: balance::zero<HASUI>(),
            total_principal: 0,
            pending_rewards: balance::zero<SUI>(),
        }
    }

    #[test_only]
    public fun test_destroy_vault(v: VaultV6) {
        let VaultV6 { id, ha_balance, total_principal: _, pending_rewards } = v;
        object::delete(id);
        balance::destroy_for_testing(ha_balance);
        balance::destroy_for_testing(pending_rewards);
    }

    /// Simulate stake: deposit pre-minted haSUI + record principal.
    #[test_only]
    public fun test_stake(v: &mut VaultV6, ha: Balance<HASUI>, principal_mist: u64) {
        balance::join(&mut v.ha_balance, ha);
        v.total_principal = v.total_principal + principal_mist;
    }

    /// Simulate unstake at a given rate: returns the haSUI released for the user.
    #[test_only]
    public fun test_unstake(v: &mut VaultV6, principal_mist: u64, rate: u128): Balance<HASUI> {
        let need = ha_for_sui_ceil(principal_mist, rate);
        v.total_principal = v.total_principal - principal_mist;
        balance::split(&mut v.ha_balance, need)
    }

    /// Simulate harvest at a given rate: returns surplus haSUI, enforcing the
    /// same coverage assertions as the real harvest().
    #[test_only]
    public fun test_harvest(v: &mut VaultV6, rate: u128): Balance<HASUI> {
        let required = required_ha(v.total_principal, rate);
        let held = balance::value(&v.ha_balance);
        assert!(held > required, E_NOTHING_TO_HARVEST);
        let surplus = held - required;
        assert!(surplus >= MIN_HARVEST_HA, E_NOTHING_TO_HARVEST);
        let out = balance::split(&mut v.ha_balance, surplus);
        assert!(
            balance::value(&v.ha_balance) >= ha_for_sui_ceil(v.total_principal, rate),
            E_COVERAGE_BROKEN
        );
        out
    }

    #[test_only]
    public fun test_ha_for_sui_ceil(sui_mist: u64, rate: u128): u64 {
        ha_for_sui_ceil(sui_mist, rate)
    }

    #[test_only]
    public fun test_required_ha(principal: u64, rate: u128): u64 {
        required_ha(principal, rate)
    }
}
