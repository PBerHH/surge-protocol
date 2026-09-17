# Brag Plan: Surge Protocol

## What is this app?
No-loss prize-linked staking on Sui — stake SUI, your principal never leaves the vault, and the real staking yield (via Haedal haSUI) funds recurring on-chain lottery draws instead of going to you as boring interest.

## The angle
The whole pitch is one sharp contradiction: it's a lottery where you can't lose your money. Lean into that line exactly as the product states it — "Your principal is safe. Only the yield wins prizes." — then prove it by showing the actual mechanics: real staked totals, real prize pools, real countdown timers, a real winner getting paid with confetti. No metaphor needed; the product already frames itself as "a savings account where instead of interest, you get lottery tickets."

## Hook (first 2-3 seconds)
The site's real hero headline, exactly as it renders: "Your principal is safe." beat, then the gradient-gold-to-purple payoff line "Only the yield wins prizes." — same typography treatment (Bebas Neue caps, gold→purple gradient on the second line) as production.

## Key moments (the middle)
- The live stat bar counting up: Total Staked (SUI) and Prize Pool (SUI), same two-tile layout as the real hero — numbers ticking upward, not static.
- The stake panel: "100" typed into the deposit field, then the three ticket rows (⚡ Spark / 🔄 Pulse / 🌊 Surge) activating one by one in their real colors (gold, teal, purple) as the amount crosses each gate (1 / 10 / 50 SUI).
- The three draw cards (Spark/Pulse/Surge) with live color-coded countdowns, one flipping to the real urgent "Ready ✓" / FOMO-pulse state.
- A winner payout: a truncated wallet address, "+X.XXXX SUI" in Surge's teal, and the site's actual confetti burst (its real palette: #F5C842 gold, #3ABFAA teal, #C67FE8 purple, #E8A027 amber, #FF6B35 orange).

## Outro / punchline
Gradient "SURGE" wordmark (Bebas Neue, gold→gold gradient exactly as the nav logo renders) with tagline "Prize-linked staking on Sui." and surgeonsui.com. No hard sell — the confetti already made the case.

## User flow worth showing
Connect wallet → deposit SUI, watch ticket tiers light up as the amount crosses 1/10/50 SUI gates → a draw goes "Ready" and pays out live with confetti. This is the actual product loop (stake_vault_v6 stake → draw_manager random draw → reward_pool payout) and is the centerpiece; the landing-page hero is used only as the frame (hook + stat bar), not the substance.

## Tone
- Preset: default
- Creative direction: confident, premium, a little playful — a real DeFi product that's also honestly fun about being a lottery. Not a joke, not a trailer.
- Interpretation: clean high-contrast reveals on the dark gold/black palette, snappy but readable holds, the confetti moment is the one place energy peaks — everything else stays controlled and premium, matching a live financial product.

## Format: landscape — 1920x1080
## Duration: 20s

## Visual identity (from the project)
- Background: `#080600` (bg), panels `#0F0C00` / `#181300`
- Accent: gold `#E8A027`, spark gold `#F5C842`, pulse teal `#3ABFAA`, surge purple `#C67FE8`, FOMO orange `#FF6B35`
- Text: `#EDE8D8` primary, `#807060` secondary, `#3A3020` tertiary
- Display font: Bebas Neue (headline, logo, draw names)
- Body font: DM Sans (body copy), DM Mono (all numbers, stats, countdowns, labels)
- Strongest visual element: the gold→purple gradient-text hero line, and the three color-coded draw cards with live countdowns

## Share copy (draft)
Your principal never leaves the vault. Only the yield rolls the dice. 🌊 Surge — prize-linked staking on Sui.

## Audio direction
- Role: warm confident bed with motion-matched accents; confetti/payout moment is the one expressive peak
- Music: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (120 BPM, upbeat/confident "business moves" energy fits the gold/premium DeFi feel better than a moody cinematic bed)
- Music treatment: start at 0s under the hook, hold steady through the middle, let it build slightly into the winner/confetti beat, short fade on the outro logo card
- Music cue guidance: preset read from `cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.md`. Strong cues at 16.02s, 17.02s, 17.52s, 18.02s, 18.52s, 20.02s cluster right where the winner/confetti scene and outro land (~15-20s) — target the confetti burst and wordmark reveal to the nearest of these. Beat grid before that (3-15s, ~0.5s spacing) is available for the sequential ticket-activation and draw-card reveals but should snap every-other-beat (~1s) since those are readable text/number moments, not just accents.
- Audio-reactive treatment: subtle — the gradient hero text and draw-card glow may breathe gently with the beat; no waveform bars, no heavy pumping
- SFX posture: moderate — a soft key-tick on the typed "100", a distinct chip/pop per ticket activation, a tick per countdown digit change, a bright coin/confetti hit on the payout, one clean logo-hit on the outro
- Audio-coupled moments: ticket rows activating one by one (chip sound per row), draw-card countdown digits changing, the confetti/payout moment, the outro wordmark landing
- Restraint rule: never let SFX or beat-sync fight the numbers being readable — every count-up and ticket label gets its full hold before the next beat-driven event fires

## Storyboard

### Scene 1 — Hook — 3s
Full-bleed dark background (`#080600`). Real hero headline appears: "Your principal is safe." in `#EDE8D8` Bebas Neue caps, then a beat later "Only the yield wins prizes." in the gold→purple gradient, exactly as production renders `.hero-title em`.
Sequential/interaction: yes — line 1 settles (~1s), then line 2 arrives (~2s hold)
Audio intent: confident, clean open — no swell, just the beat starting under the type
Audio-coupled idea: a soft type-in tick as line 2 arrives
Music: upbeat "business moves" bed starts
Transition mood: clean → Scene 2

### Scene 2 — Reveal: the real numbers — 3s
The two-tile hero stat bar from production: "Total Staked" and "Prize Pool," each counting up to a real-looking SUI figure (e.g. Total Staked ticks up to a five-figure number, Prize Pool in purple `#C67FE8` ticks up beside it), same layout/border treatment as the live site.
Sequential/interaction: yes — the two tiles count up together, digits rolling
Audio intent: light momentum, numbers feel real and moving
Audio-coupled idea: soft tick per digit roll on the count-up
Music: steady beat, no build yet
Transition mood: clean → Scene 3

### Scene 3 — Key moment: stake the SUI — 4.5s
The real Deposit panel: "100" types into the stake input, then the three ticket rows light up one at a time in their real colors — ⚡ Spark (gold) first, 🔄 Pulse (teal) next, 🌊 Surge (purple) last — each flipping from dim "min X SUI" to active "N tickets."
Sequential/interaction: yes — typed digits, then 3 ticket rows activating in strict order with a beat between each
Audio intent: playful build, each ticket activation feels like a small win
Audio-coupled idea: key-tick on typing, a distinct chip/pop per ticket row snapped to the beat grid (~1s spacing, every-other-beat)
Music: beat continues, slight energy climb
Transition mood: soft wipe → Scene 4

### Scene 4 — Key moment: draws are live — 4.5s
The three real draw cards (Spark/Pulse/Surge) side by side with their actual color accents, prize amounts, and live countdowns ticking down. One card (Spark) flips into its real urgent FOMO-pulse state as its countdown crosses under an hour.
Sequential/interaction: yes — countdown digits actively ticking on all three; Spark's card pulses into its urgent color at the end of the scene
Audio intent: anticipation, something's about to hit
Audio-coupled idea: soft tick per countdown digit change; a slightly brighter accent when Spark flips to urgent
Music: approaching the strong-cue cluster (~16-18s)
Transition mood: dramatic wipe → Scene 5

### Scene 5 — Punchline: winner paid, then wordmark — 5s
Spark card flips to "Ready ✓," a winner row appears — truncated wallet address, "+X.XXXX SUI" in teal — and the site's real confetti burst fires in its actual five-color palette. Confetti settles into the gold "SURGE" wordmark (same gradient as the live nav logo) with tagline "Prize-linked staking on Sui." and surgeonsui.com beneath.
Sequential/interaction: yes — Ready state → winner row → confetti burst → settle into logo card
Audio intent: the one real payoff of the video — bright and satisfying, then a clean, confident close
Audio-coupled idea: coin/confetti hit snapped to a strong cue (~17-18s), one clean logo-hit on the wordmark landing near the 20.02s cue
Music: brief build into the confetti hit, then fades cleanly under the outro card
Transition mood: dramatic → end

**Music mood for this video:** upbeat / confident ("business moves" bed, 120 BPM)
**Audio summary:** A steady, confident beat carries the hook and the real numbers, builds subtly through the stake and draw-card scenes, and pays off with a bright confetti/coin hit exactly where the track's strong cues land (~16-20s), fading cleanly under the wordmark outro.
