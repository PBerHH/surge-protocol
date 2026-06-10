// ─────────────────────────────────────────────────────────────────────────────
// Haedal interface STUBS — local compile-time dependency only.
// At runtime, Sui links these calls to the REAL on-chain Haedal package via
// `published-at` in this stub package's Move.toml. Bodies are `abort 0`
// placeholders and are never executed.
//
// ⚠️ MUST be verified against mainnet before publish:
//   sui client ptb --dry-run ... OR
//   curl RPC sui_getNormalizedMoveModule for package
//   0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d
//   modules: hasui, staking, interface
// Signatures below are taken verbatim from Haedal's official
// github.com/haedallsd/haedal-protocol-interface README.
// ─────────────────────────────────────────────────────────────────────────────

module haedal::hasui {
    /// haSUI one-time-witness coin type (lives in the ORIGINAL package
    /// 0xbde4ba4c…; coin type string:
    /// 0xbde4ba4c…::hasui::HASUI)
    public struct HASUI has drop {}
}

module haedal::staking {
    use sui::coin::Coin;
    use sui::sui::SUI;
    use sui_system::sui_system::SuiSystemState;
    use haedal::hasui::HASUI;

    /// Haedal's shared staking pool object.
    /// Mainnet ID: 0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca
    public struct Staking has key { id: sui::object::UID }

    /// haSUI→SUI exchange rate, magnified ×1_000_000. Monotonically increasing.
    public fun get_exchange_rate(_staking: &Staking): u64 { abort 0 }

    /// Stake SUI, haSUI returned to the CALLER (Move-composable — this is the
    /// function Surge v6 uses inside `stake`). validator = @0x0 lets Haedal pick.
    public fun request_stake_coin(
        _wrapper: &mut SuiSystemState,
        _staking: &mut Staking,
        _input: Coin<SUI>,
        _validator: address,
        _ctx: &mut sui::tx_context::TxContext,
    ): Coin<HASUI> { abort 0 }
}

module haedal::interface {
    use sui::coin::Coin;
    use sui::clock::Clock;
    use haedal::hasui::HASUI;

    /// Free delayed unstake: burns haSUI, transfers an UnstakeTicket to the
    /// tx SENDER. Claimable after 1–2 epochs via claim_v2 (sender receives SUI
    /// at the exact appreciated rate).
    public entry fun request_unstake_delay(
        _staking: &mut haedal::staking::Staking,
        _clock: &Clock,
        _input: Coin<HASUI>,
        _ctx: &mut sui::tx_context::TxContext,
    ) { abort 0 }
}
