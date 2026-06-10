/// Surge v6 — unit tests for the haSUI vault accounting & invariants.
///
/// What these prove (the audit-relevant properties):
///   1. NO-LOSS: at any rate ≥ 1.0, the haSUI released for an unstake always
///      redeems to ≥ the user's principal (ceil rounding never undershoots).
///   2. COVERAGE: harvest can never release haSUI below principal coverage,
///      even right after a rate jump; below-threshold harvests abort.
///   3. LIFECYCLE: stake → rate appreciation → harvest → everyone unstakes →
///      all principal covered, vault drains to ~0 (only safety-margin dust).
///
/// Real Haedal calls are stubbed; the live integration is validated on
/// testnet against Haedal's deployed testnet package.
#[test_only]
module surge::stake_vault_v6_tests {

    use sui::balance;
    use sui::tx_context;
    use haedal::hasui::HASUI;
    use surge::stake_vault_v6 as v6;

    const RATE_1_0: u128 = 1_000_000;  // 1.000000 (launch-day haSUI)
    const RATE_1_05: u128 = 1_050_000; // 1.05 — roughly current mainnet haSUI
    const SUI: u64 = 1_000_000_000;    // 1 SUI in mist

    fun ha(amount: u64): balance::Balance<HASUI> {
        balance::create_for_testing<HASUI>(amount)
    }

    // ── 1. Rounding / no-loss math ───────────────────────────────────────────

    #[test]
    fun ceil_never_undershoots_principal() {
        // For many (principal, rate) pairs: released_ha * rate / 1e6 >= principal.
        let principals = vector[1 * SUI, 7 * SUI, 10 * SUI + 1, 50 * SUI + 333, 123_456_789_123];
        let rates = vector[RATE_1_0, 1_000_001, 1_037_421, RATE_1_05, 2_000_000];
        let mut i = 0;
        while (i < vector::length(&principals)) {
            let p = *vector::borrow(&principals, i);
            let mut j = 0;
            while (j < vector::length(&rates)) {
                let r = *vector::borrow(&rates, j);
                let need = v6::test_ha_for_sui_ceil(p, r);
                // value redeemed = need * r / 1e6 (floor) must be >= p
                let redeemed = ((need as u128) * r) / 1_000_000;
                assert!(redeemed >= (p as u128), 100);
                // and never more than 1 mist-ha overshoot worth of waste
                let exact = ((p as u128) * 1_000_000 + r - 1) / r;
                assert!((need as u128) == exact, 101);
                j = j + 1;
            };
            i = i + 1;
        };
    }

    #[test]
    fun required_ha_includes_margin() {
        let exact = v6::test_ha_for_sui_ceil(100 * SUI, RATE_1_05);
        let req = v6::test_required_ha(100 * SUI, RATE_1_05);
        // margin = 10 bps → req ≈ exact * 1.001, and strictly greater
        assert!(req > exact, 200);
        assert!((req as u128) <= (exact as u128) * 10_011 / 10_000, 201);
    }

    // ── 2. Harvest coverage invariant ────────────────────────────────────────

    #[test]
    fun harvest_releases_only_surplus() {
        let mut ctx = tx_context::dummy();
        let mut v = v6::test_new_vault(&mut ctx);

        // 100 SUI staked at rate 1.0 → 100 ha locked, principal 100 SUI.
        v6::test_stake(&mut v, ha(100 * SUI), 100 * SUI);

        // Rate appreciates to 1.05 → coverage needs ~95.24 ha → ~4.75 ha surplus.
        let surplus = v6::test_harvest(&mut v, RATE_1_05);
        let s = balance::value(&surplus);
        // surplus ≈ 100e9 − required(100 SUI @1.05); sanity bounds:
        assert!(s > 4 * SUI && s < 5 * SUI, 300);
        // Coverage after harvest still intact:
        assert!(v6::ha_held(&v) >= v6::test_ha_for_sui_ceil(100 * SUI, RATE_1_05), 301);

        balance::destroy_for_testing(surplus);
        v6::test_destroy_vault(v);
    }

    #[test]
    #[expected_failure(abort_code = 3, location = surge::stake_vault_v6)]
    fun harvest_aborts_without_yield() {
        let mut ctx = tx_context::dummy();
        let mut v = v6::test_new_vault(&mut ctx);
        v6::test_stake(&mut v, ha(100 * SUI), 100 * SUI);
        // Rate 1.0 → zero surplus → must abort E_NOTHING_TO_HARVEST.
        let out = v6::test_harvest(&mut v, RATE_1_0);
        balance::destroy_for_testing(out);
        v6::test_destroy_vault(v);
    }

    #[test]
    #[expected_failure(abort_code = 3, location = surge::stake_vault_v6)]
    fun harvest_aborts_on_dust() {
        let mut ctx = tx_context::dummy();
        let mut v = v6::test_new_vault(&mut ctx);
        v6::test_stake(&mut v, ha(100 * SUI), 100 * SUI);
        // Tiny appreciation → surplus < MIN_HARVEST_HA (0.1 ha) → abort.
        let out = v6::test_harvest(&mut v, 1_000_500); // rate 1.0005
        balance::destroy_for_testing(out);
        v6::test_destroy_vault(v);
    }

    // ── 3. Full lifecycle ────────────────────────────────────────────────────

    #[test]
    fun lifecycle_three_stakers_appreciation_harvest_full_exit() {
        let mut ctx = tx_context::dummy();
        let mut v = v6::test_new_vault(&mut ctx);

        // Three stakers at rate 1.0: 1 / 10 / 50 SUI (the three gates).
        v6::test_stake(&mut v, ha(1 * SUI), 1 * SUI);
        v6::test_stake(&mut v, ha(10 * SUI), 10 * SUI);
        v6::test_stake(&mut v, ha(50 * SUI), 50 * SUI);
        assert!(v6::total_principal(&v) == 61 * SUI, 400);

        // Appreciation to 1.05, crank harvests the prize-pool funding.
        let yield_ha = v6::test_harvest(&mut v, RATE_1_05);
        assert!(balance::value(&yield_ha) > 0, 401);

        // Everyone exits at the SAME rate — all principal must be covered.
        let u1 = v6::test_unstake(&mut v, 1 * SUI, RATE_1_05);
        let u2 = v6::test_unstake(&mut v, 10 * SUI, RATE_1_05);
        let u3 = v6::test_unstake(&mut v, 50 * SUI, RATE_1_05);
        assert!(v6::total_principal(&v) == 0, 402);

        // Each released ha redeems to >= principal:
        assert!(((balance::value(&u1) as u128) * RATE_1_05) / 1_000_000 >= (1 * SUI as u128), 403);
        assert!(((balance::value(&u2) as u128) * RATE_1_05) / 1_000_000 >= (10 * SUI as u128), 404);
        assert!(((balance::value(&u3) as u128) * RATE_1_05) / 1_000_000 >= (50 * SUI as u128), 405);

        // Vault left with only the safety-margin dust (< 0.2% of TVL).
        assert!((v6::ha_held(&v) as u128) < (61u128 * (SUI as u128)) * 20 / 10_000, 406);

        balance::destroy_for_testing(yield_ha);
        balance::destroy_for_testing(u1);
        balance::destroy_for_testing(u2);
        balance::destroy_for_testing(u3);
        v6::test_destroy_vault(v);
    }

    // ── 4. Stress: unstake immediately after harvest at same rate ────────────

    #[test]
    fun unstake_right_after_harvest_still_covered() {
        let mut ctx = tx_context::dummy();
        let mut v = v6::test_new_vault(&mut ctx);
        v6::test_stake(&mut v, ha(1000 * SUI), 1000 * SUI);

        let yield_ha = v6::test_harvest(&mut v, RATE_1_05);

        // Worst case: full exit at the very rate harvest used.
        let out = v6::test_unstake(&mut v, 1000 * SUI, RATE_1_05);
        assert!(((balance::value(&out) as u128) * RATE_1_05) / 1_000_000 >= (1000 * SUI as u128), 500);

        balance::destroy_for_testing(yield_ha);
        balance::destroy_for_testing(out);
        v6::test_destroy_vault(v);
    }
}
