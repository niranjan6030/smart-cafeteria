export default function PageStyles() {
  return (
    <style>{`
        @keyframes popIn { from { transform: scale(.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .cc-fade-in-up { animation: fadeInUp .5s cubic-bezier(0.22, 1, 0.36, 1) backwards; }
        /* Scroll-triggered reveal: cc-fade-in-up children of a .cc-reveal-group stay paused at
           their opacity:0 starting frame (animation-fill-mode: backwards holds it there) until
           the group picks up .is-visible from RevealOnScroll's IntersectionObserver. The hero
           section is never wrapped in .cc-reveal-group, so its own entrance is unaffected and
           still plays immediately on load. */
        .cc-reveal-group .cc-fade-in-up, .cc-reveal-group.cc-fade-in-up { animation-play-state: paused; }
        .cc-reveal-group.is-visible .cc-fade-in-up, .cc-reveal-group.is-visible.cc-fade-in-up { animation-play-state: running; }
        @media (prefers-reduced-motion: reduce) {
          .cc-fade-in-up { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
        .cc-no-scrollbar::-webkit-scrollbar { display: none; }
        .cc-no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .cc-card-shadow { box-shadow: 0 18px 55px rgba(11, 37, 69, .14); transition: box-shadow .35s ease, transform .35s ease; }
        .cc-card-shadow:hover { box-shadow: 0 24px 65px rgba(11, 37, 69, .2); }
        .cc-food-overlay { background: linear-gradient(180deg, rgba(0,0,0,0) 10%, rgba(11,37,69,.5) 48%, rgba(11,37,69,.92) 100%); }
        .cc-gold-gradient {
          background: linear-gradient(135deg, #F6B48F 0%, var(--color-primary) 45%, #B24A1E 100%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 2px rgba(0,0,0,.08);
        }

        /* ─── Tab content crossfade — swaps Menu/Meal Passes/Wallet without an instant snap ─── */
        @keyframes ccTabFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .cc-tab-fade { animation: ccTabFade .32s ease-out; }

        /* ─── Skeleton shimmer for menu/stall cards while Firestore data streams in ─── */
        @keyframes ccShimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
        .cc-skeleton {
          background: linear-gradient(90deg, rgba(74,53,37,.10) 25%, rgba(74,53,37,.20) 37%, rgba(74,53,37,.10) 63%);
          background-size: 800px 100%;
          animation: ccShimmer 1.6s linear infinite;
        }

        /* ─── Add-to-cart micro feedback: roll-in on the qty digit ─── */
        @keyframes ccQtyRollIn { from { opacity: 0; transform: translateY(6px) scale(.7); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .cc-qty-roll-in { animation: ccQtyRollIn .22s cubic-bezier(.34,1.56,.64,1); }

        .cc-snap-x { scroll-snap-type: x mandatory; }

        /* ─── Dark/light switch — Uiverse.io by alexruix, recolored navy/gold. The knob shares
            the track's own background so it "disappears" into it, leaving only the inset-shadow
            crescent visible — a gold moon on a navy track, growing fuller when dark mode is on. ── */
        .cc-toggle { --cc-toggle-bg: #2E2016; position: relative; display: inline-block; width: 2.75em; height: 1.55em; flex-shrink: 0; }
        .cc-toggle input { opacity: 0; width: 0; height: 0; }
        .cc-toggle-slider { position: absolute; inset: 0; cursor: pointer; background-color: var(--cc-toggle-bg); border-radius: 30px; transition: .4s; }
        .cc-toggle-slider:before {
          position: absolute; content: ""; height: 1.1em; width: 1.1em; border-radius: 50%;
          left: 8%; bottom: 12%; background: var(--cc-toggle-bg);
          box-shadow: inset 6px -3px 0 0 #E06A3B; transition: .4s;
        }
        .cc-toggle input:checked + .cc-toggle-slider { background-color: #573F2E; }
        .cc-toggle input:checked + .cc-toggle-slider:before { transform: translateX(115%); box-shadow: inset 10px -3px 0 10px #E06A3B; }
        .cc-toggle input:focus-visible + .cc-toggle-slider { outline: 2px solid #E06A3B; outline-offset: 2px; }
      `}</style>
  );
}
