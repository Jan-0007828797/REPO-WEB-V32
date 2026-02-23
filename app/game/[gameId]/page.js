"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSocket } from "../../../lib/socket";
import { loadPlayerId } from "../../../lib/storage";
import { playClock, stopClock, playRing, stopRing } from "../../../lib/audio";
import { BottomBar, Modal } from "../../ui";

function badgeFor(kind){
  if(kind==="ML") return { emoji:"🟩", label:"MARKET LEADER" };
  if(kind==="AUCTION") return { emoji:"🟨", label:"DRAŽBA – OBÁLKA" };
  if(kind==="CRYPTO") return { emoji:"🟦", label:"KRYPTOTRANSAKCE" };
  if(kind==="SETTLE") return { emoji:"🟥", label:"AUDIT" };
  return { emoji:"", label:"" };
}

function StepIcons({ phase, bizStep }){
  if(phase!=="BIZ"){
    return null;
  }
  const steps = [
    { key:"TRENDS", label:"Trendy", icon:"🗺️" },
    { key:"ML_BID", label:"Market Leader", icon:"👑" },
    { key:"MOVE", label:"Investice", icon:"📍" },
    { key:"AUCTION_ENVELOPE", label:"Dražba", icon:"✉️" },
  ];
  return (
    <div className="stepRow">
      {steps.map(s=>{
        const active = s.key===bizStep;
        return (
          <div key={s.key} className={"stepChip"+(active?" active":"")}>
            <span className="stepIcon">{s.icon}</span>
            <span className="stepText">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function PrivacyCard({ kind, mode, amountText, onReveal, onHide, onClose }){
  const b = badgeFor(kind);
  if(mode==="edit") return null;
  return (
    <div className="privacyWrap">
      <div className="privacyCard">
        <div className="privacyBadge">
          <span className="privacyEmoji">{b.emoji}</span>
          <span className="privacyLabel">{b.label}</span>
          <button className="privacyClose" onClick={onClose} aria-label="Zavřít">✕</button>
        </div>

        {mode==="hidden" ? (
          <>
            <div className="privacyHidden">🔒</div>
            <button className="primaryBtn big" onClick={onReveal}>ODKRÝT</button>
          </>
        ) : (
          <>
            <div className="privacyAmount">{amountText}</div>
            <button className="ghostBtn big" onClick={onHide}>SKRÝT</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function GamePage(){
  const { gameId } = useParams();
  const router = useRouter();
  const playerId = useMemo(()=> (typeof window==="undefined" ? "" : loadPlayerId()), []);
  const [gs, setGs] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(null);
  const [trendModal, setTrendModal] = useState(null); // {name, icon, desc}

  // local privacy modes
  const [mlPrivacy, setMlPrivacy] = useState("edit");       // edit|hidden|reveal
  const [aucPrivacy, setAucPrivacy] = useState("edit");
  const [cryptoPrivacy, setCryptoPrivacy] = useState("edit");
  const [settlePrivacy, setSettlePrivacy] = useState("edit");

  // overlay visibility (so GM controls stay usable and players can dismiss overlays)
  const [mlOverlayOpen, setMlOverlayOpen] = useState(true);
  const [aucOverlayOpen, setAucOverlayOpen] = useState(true);
  const [cryptoOverlayOpen, setCryptoOverlayOpen] = useState(true);
  const [settleOverlayOpen, setSettleOverlayOpen] = useState(true);

  // inputs
  const [mlBid, setMlBid] = useState("");
  const [aucBid, setAucBid] = useState("");
  const [useLobby, setUseLobby] = useState(false);
  const [aucFinalBid, setAucFinalBid] = useState("");

  const [cryptoD, setCryptoD] = useState({ BTC:0, ETH:0, LTC:0, SIA:0 });

  useEffect(()=>{
    const s = getSocket();
    s.emit("watch_game", { gameId }, (res)=>{
      if(!res?.ok) setErr(res?.error || "Nelze načíst hru.");
    });
    const onState = (state)=>{
      if(state?.gameId!==gameId) return;
      setGs(state);
    };
    s.on("game_state", onState);
    return ()=> s.off("game_state", onState);
  }, [gameId]);

  const me = gs?.players?.find(p=>p.playerId===playerId) || null;
  const isGM = me?.role==="GM";

  // Sound logic: clock during interactive steps (except Trends)
  useEffect(()=>{
    stopRing();
    const phase = gs?.phase;
    const bizStep = gs?.bizStep;
    if(!phase) { stopClock(); return; }

    const shouldClock =
      (phase==="BIZ" && bizStep && bizStep!=="TRENDS") ||
      (phase==="CRYPTO") ||
      (phase==="SETTLE");

    if(shouldClock) playClock(); else stopClock();

    // lobbyist ringing for users who used lobbyist and need final bid
    if(phase==="BIZ" && bizStep==="AUCTION_ENVELOPE"){
      const entry = gs?.biz?.auction?.entries?.[playerId];
      const active = !!gs?.biz?.auction?.lobbyistPhaseActive;
      if(active && entry?.usedLobbyist && !entry?.finalCommitted){
        playRing();
      }else{
        stopRing();
      }
    }
  }, [gs, playerId]);

  // Reset local states on step changes (so UX is clean)
  useEffect(()=>{
    const phase = gs?.phase;
    const step = gs?.bizStep;
    if(phase==="BIZ" && step==="ML_BID"){
      const committed = !!gs?.biz?.mlBids?.[playerId]?.committed;
      setMlPrivacy(committed ? "hidden" : "edit");
      setMlOverlayOpen(true);
    }
    if(phase==="BIZ" && step==="AUCTION_ENVELOPE"){
      const committed = !!gs?.biz?.auction?.entries?.[playerId]?.committed;
      setAucPrivacy(committed ? "hidden" : "edit");
      setAucOverlayOpen(true);
    }
    if(phase==="CRYPTO"){
      const committed = !!gs?.crypto?.entries?.[playerId]?.committed;
      setCryptoPrivacy(committed ? "hidden" : "edit");
      setCryptoOverlayOpen(true);
    }
    if(phase==="SETTLE"){
      const committed = !!gs?.settle?.entries?.[playerId]?.committed;
      setSettlePrivacy(committed ? "hidden" : "edit");
      setSettleOverlayOpen(true);
    }
  }, [gs?.phase, gs?.bizStep, gs?.year]);

  const s = useMemo(()=> getSocket(), []);

  function gmNext(){ s.emit("gm_next", { gameId, playerId }, (res)=>{ if(!res?.ok) setErr(res?.error||""); }); }
  function gmBack(){ s.emit("gm_back", { gameId, playerId }, (res)=>{ if(!res?.ok) setErr(res?.error||""); }); }

  function commitML(amount){
    s.emit("commit_ml_bid", { gameId, playerId, amountUsd: amount }, (res)=>{
      if(!res?.ok) return setErr(res?.error||"Chyba");
      setMlPrivacy("hidden"); // auto hide after commit
      setMlOverlayOpen(true);
    });
  }

  function commitAuction(bid, usedLobbyist){
    s.emit("commit_auction_bid", { gameId, playerId, bidUsd: bid, usedLobbyist }, (res)=>{
      if(!res?.ok) return setErr(res?.error||"Chyba");
      setAucPrivacy("hidden"); // auto hide after commit
      setAucOverlayOpen(true);
    });
  }

  function openLobbyWindow(){
    s.emit("gm_open_lobbyist_window", { gameId, playerId }, (res)=>{
      if(!res?.ok) setErr(res?.error||"");
    });
  }

  function commitFinalAuction(finalBid){
    s.emit("commit_auction_final_bid", { gameId, playerId, finalBidUsd: finalBid }, (res)=>{
      if(!res?.ok) return setErr(res?.error||"Chyba");
      setAucPrivacy("hidden");
      setAucOverlayOpen(true);
    });
  }

  function pickMarket(marketId){
    s.emit("pick_market", { gameId, playerId, marketId }, (res)=>{
      if(!res?.ok) setErr(res?.error || "Nelze vybrat trh");
    });
  }

  function commitCrypto(){
    s.emit("commit_crypto", { gameId, playerId, deltas: cryptoD }, (res)=>{
      if(!res?.ok) return setErr(res?.error||"Chyba");
      setCryptoPrivacy("hidden");
      setCryptoOverlayOpen(true);
    });
  }

  function commitSettle(){
    s.emit("commit_settlement_ready", { gameId, playerId }, (res)=>{
      if(!res?.ok) return setErr(res?.error||"Chyba");
      setSettlePrivacy("hidden");
      setSettleOverlayOpen(true);
    });
  }

  // derived display amounts
  const mlAmount = gs?.biz?.mlBids?.[playerId]?.amountUsd;
  const aucEntry = gs?.biz?.auction?.entries?.[playerId] || null;
  const aucShownBid = (aucEntry?.usedLobbyist && aucEntry?.finalCommitted) ? aucEntry?.finalBidUsd : aucEntry?.bidUsd;
  const cryptoDelta = gs?.crypto?.entries?.[playerId]?.deltaUsd;
  const settleAmount = gs?.settle?.entries?.[playerId]?.settlementUsd;

  const headerPhase =
    gs?.phase==="BIZ" ? "Byznysová fáze" :
    gs?.phase==="CRYPTO" ? "Krypto fáze" :
    gs?.phase==="SETTLE" ? "Audit" :
    gs?.status==="LOBBY" ? "Lobby" :
    gs?.status==="GAME_OVER" ? "Konec hry" : "";

  const markets = gs?.catalog?.markets || [];
  const locks = gs?.biz?.marketLocks || {};
  const myMove = gs?.biz?.move?.[playerId];

  // Tabs content data
  const myInv = gs?.inventory?.[playerId] || { investments:[], miningFarms:[], experts:[] };
  const myReveals = gs?.reveals?.[playerId] || { globalYearsRevealed:[], cryptoYearsRevealed:[] };

  if(err){
    // keep minimal
  }

  return (
    <div className="screen">
      <div className="topHeader">
        <div className="brand">KRYPTOPOLY</div>
        <div className="subBrand">{headerPhase}{gs?.year?` • Rok ${gs.year}`:""}</div>
        <StepIcons phase={gs?.phase} bizStep={gs?.bizStep} />
      </div>

      {err ? <div className="toast" onClick={()=>setErr("")}>{err}</div> : null}

      <div className="content">
        {!gs ? (
          <div className="card"><div className="muted">Načítám hru…</div></div>
        ) : gs.status==="GAME_OVER" ? (
          <div className="card center">
            <div style={{fontSize:28, fontWeight:900}}>Konec hry</div>
            <div className="muted">Díky za testování.</div>
          </div>
        ) : gs.phase==="BIZ" && gs.bizStep==="TRENDS" ? (
          <TrendsPreviewCard
            gs={gs}
            onOpen={()=>setTab("trends")}
          />
        ) : gs.phase==="BIZ" && gs.bizStep==="ML_BID" ? (
          <div className="card">
            <div className="title">Market Leader</div>
            <div className="muted">Zadej nabídku (USD) nebo zvol „Nechci“. Po potvrzení se displej skryje.</div>
            <div className="formRow">
              <input className="inputBig" inputMode="numeric" placeholder="0" value={mlBid} onChange={(e)=>setMlBid(e.target.value.replace(/[^\d]/g,""))} />
              <button className="primaryBtn" onClick={()=>commitML(mlBid===""?0:Number(mlBid))}>Potvrdit</button>
            </div>
            <button className="ghostBtn full" onClick={()=>commitML(null)}>Nechci být ML</button>
          </div>
        ) : gs.phase==="BIZ" && gs.bizStep==="MOVE" ? (
          <div className="card">
            <div className="title">Investice (pohyb)</div>
            <div className="muted">Klikni na trh. Trh zmizí ostatním. Volba je definitivní.</div>
            <div className="gridMarkets">
              {markets.map(m=>{
                const lockedBy = locks[m.marketId];
                const locked = !!lockedBy && lockedBy!==playerId;
                const mine = myMove?.marketId===m.marketId;
                return (
                  <button key={m.marketId} className={"marketBtn"+(locked?" locked":"")+(mine?" mine":"")} disabled={locked || !!myMove?.committed} onClick={()=>pickMarket(m.marketId)}>
                    <div className="marketTop">
                      <span className="marketId">{m.marketId}</span>
                      <span className="marketType">{m.type}</span>
                    </div>
                    <div className="marketSub">{m.continent}</div>
                    {mine ? <div className="pill">MOJE</div> : locked ? <div className="pill dim">OBS.</div> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : gs.phase==="BIZ" && gs.bizStep==="AUCTION_ENVELOPE" ? (
          <div className="card">
            <div className="titleRow">
              <div className="title">Dražba – obálka</div>
              {isGM ? <button className="ghostBtn" onClick={openLobbyWindow}>Otevřít lobbistu</button> : null}
            </div>
            <div className="muted">Zadej nabídku (USD) nebo neúčast. Pokud máš lobbistu, můžeš získat „poslední šanci“.</div>

            {!aucEntry?.committed ? (
              <>
                <div className="formRow">
                  <input className="inputBig" inputMode="numeric" placeholder="0" value={aucBid} onChange={(e)=>setAucBid(e.target.value.replace(/[^\d]/g,""))} />
                  <button className="primaryBtn" onClick={()=>commitAuction(aucBid===""?0:Number(aucBid), useLobby)}>Potvrdit</button>
                </div>
                <div className="formRow">
                  <label className="checkRow">
                    <input type="checkbox" checked={useLobby} onChange={(e)=>setUseLobby(e.target.checked)} />
                    <span>Použít lobbistu (pokud ho mám)</span>
                  </label>
                </div>
                <button className="ghostBtn full" onClick={()=>commitAuction(null, false)}>Nechci dražit</button>
              </>
            ) : (
              <>
                {gs.biz.auction.lobbyistPhaseActive && aucEntry?.usedLobbyist && !aucEntry?.finalCommitted ? (
                  <div className="cardInner">
                    <div className="muted"><b>Poslední šance</b> – vidíš nabídky ostatních (mimo aplikaci si je ukážete). Zadej finální nabídku.</div>
                    <div className="formRow">
                      <input className="inputBig" inputMode="numeric" placeholder="0" value={aucFinalBid} onChange={(e)=>setAucFinalBid(e.target.value.replace(/[^\d]/g,""))} />
                      <button className="primaryBtn" onClick={()=>commitFinalAuction(aucFinalBid===""?0:Number(aucFinalBid))}>Odeslat</button>
                    </div>
                  </div>
                ) : (
                  <div className="muted">Obálka odeslána. (Telefon je skrytý – můžeš odkryt ručně.)</div>
                )}
              </>
            )}
          </div>
        ) : gs.phase==="CRYPTO" ? (
          <div className="card">
            <div className="title">Kryptoburza</div>
            <div className="muted">Naklikej změny (ks). Pak potvrď. Aplikace ukáže dopad v USD.</div>
            <div className="cryptoList">
              {["BTC","ETH","LTC","SIA"].map(sym=>{
                const rate = gs.crypto?.rates?.[sym] || 0;
                const val = cryptoD[sym] || 0;
                return (
                  <div key={sym} className="cryptoRow">
                    <div className="cryptoMeta">
                      <div className="cryptoSym">{sym}</div>
                      <div className="muted">{rate} USD/ks</div>
                    </div>
                    <div className="cryptoCtrls">
                      <button className="ghostBtn" onClick={()=>setCryptoD({...cryptoD, [sym]: val-1})}>−</button>
                      <div className="cryptoVal">{val}</div>
                      <button className="ghostBtn" onClick={()=>setCryptoD({...cryptoD, [sym]: val+1})}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="primaryBtn full" onClick={commitCrypto}>Potvrdit transakci</button>
            <button className="ghostBtn full" onClick={()=>{ setCryptoD({BTC:0,ETH:0,LTC:0,SIA:0}); commitCrypto(); }}>Neobchoduji</button>
          </div>
        ) : gs.phase==="SETTLE" ? (
          <div className="card">
            <div className="titleRow">
              <div className="title">Audit</div>
              <button className="ghostBtn" onClick={()=>setTab("accounting")}>Detail</button>
            </div>
            <div className="muted">Aplikace zobrazí částku pro vyrovnání. Ukazovací režim ukáže jen jedno číslo.</div>
            <button className="primaryBtn full" onClick={commitSettle}>Potvrdit připraven</button>
          </div>
        ) : (
          <div className="card">
            <div className="muted">Čekám na GM…</div>
          </div>
        )}

        {isGM && gs?.status==="IN_PROGRESS" ? (
          <div className="gmBar">
            <button className="ghostBtn" onClick={gmBack}>← Zpět</button>
            <button className="primaryBtn" onClick={gmNext}>Další krok →</button>
          </div>
        ) : null}
      </div>

      <BottomBar onTab={setTab} />


      {trendModal ? (
        <Modal variant="top" title={`${trendModal.icon||"🌐"} ${trendModal.name||"Trend"}`} onClose={()=>setTrendModal(null)}>
          <div className="modalText">
            {trendModal.desc ? trendModal.desc : "Detail trendu není k dispozici."}
          </div>

          {(() => {
            const inv = gs?.inventory?.[playerId] || { experts: [] };
            const lawyerLeft = (inv.experts||[]).filter(e=>e.functionKey==="LAWYER_TRENDS" && !e.used).length;
            const allowed = !!trendModal?.lawyer?.allowed;
            const req = trendModal?.lawyer?.phase;
            const phase = gs?.phase;
            const biz = gs?.bizStep;

            const canNow =
              allowed && (
                (req==="BIZ_TRENDS_ONLY" && phase==="BIZ" && biz==="TRENDS") ||
                (req==="BIZ_MOVE_ONLY" && phase==="BIZ" && biz==="MOVE") ||
                (req==="AUDIT_ANYTIME_BEFORE_CLOSE" && phase==="SETTLE")
              );

            const y = String(gs?.year||1);
            const protectedNow = !!gs?.lawyer?.protections?.[playerId]?.[y]?.[trendModal.key];

            function useLawyer(){
              const s = getSocket();
              s.emit("use_lawyer_on_trend", { gameId, playerId, trendKey: trendModal.key }, (res)=>{
                // no toast system in MVP; simple feedback
                if(!res?.ok) alert(res?.error || "Chyba");
              });
            }

            const phaseHint =
              req==="BIZ_TRENDS_ONLY" ? "Právníka lze použít pouze ve fázi Trendy." :
              req==="BIZ_MOVE_ONLY" ? "Právníka lze použít pouze ve fázi Investice (pohyb)." :
              req==="AUDIT_ANYTIME_BEFORE_CLOSE" ? "Právníka lze použít kdykoliv před uzavřením Auditu." :
              "Právníka nelze použít.";

            return (
              <div className="lawyerBox">
                <div className="secTitle" style={{marginTop:12}}>Právník</div>

                {!allowed ? (
                  <div className="muted">Na tento trend nelze použít Právníka.</div>
                ) : protectedNow ? (
                  <div className="pill" style={{display:"inline-flex"}}>✅ Ochráněno (tento rok)</div>
                ) : lawyerLeft<1 ? (
                  <div className="muted">Právník není k dispozici.</div>
                ) : (
                  <>
                    <div className="muted">{phaseHint}</div>
                    <button className={"primaryBtn full"+(canNow? "":" disabled")} disabled={!canNow} onClick={useLawyer}>
                      Použít právníka
                    </button>
                  </>
                )}
              </div>
            );
          })()}
        </Modal>
      ) : null}
      {/* privacy overlays */}
      <PrivacyCard
        kind="ML"
        mode={(mlOverlayOpen && gs?.phase==="BIZ" && gs?.bizStep==="ML_BID" && gs?.biz?.mlBids?.[playerId]?.committed) ? mlPrivacy : "edit"}
        amountText={(mlAmount==null) ? "NECHCI" : `${mlAmount} USD`}
        onReveal={()=>setMlPrivacy("reveal")}
        onHide={()=>setMlPrivacy("hidden")}
        onClose={()=>setMlOverlayOpen(false)}
      />
      <PrivacyCard
        kind="AUCTION"
        mode={(aucOverlayOpen && gs?.phase==="BIZ" && gs?.bizStep==="AUCTION_ENVELOPE" && gs?.biz?.auction?.entries?.[playerId]?.committed) ? aucPrivacy : "edit"}
        amountText={(aucShownBid==null) ? "NECHCI" : `${aucShownBid} USD`}
        onReveal={()=>setAucPrivacy("reveal")}
        onHide={()=>setAucPrivacy("hidden")}
        onClose={()=>setAucOverlayOpen(false)}
      />
      <PrivacyCard
        kind="CRYPTO"
        mode={(cryptoOverlayOpen && gs?.phase==="CRYPTO" && gs?.crypto?.entries?.[playerId]?.committed) ? cryptoPrivacy : "edit"}
        amountText={`${cryptoDelta>0?"+":""}${cryptoDelta||0} USD`}
        onReveal={()=>setCryptoPrivacy("reveal")}
        onHide={()=>setCryptoPrivacy("hidden")}
        onClose={()=>setCryptoOverlayOpen(false)}
      />
      <PrivacyCard
        kind="SETTLE"
        mode={(settleOverlayOpen && gs?.phase==="SETTLE" && gs?.settle?.entries?.[playerId]?.committed) ? settlePrivacy : "edit"}
        amountText={`${settleAmount>=0?"+":""}${settleAmount??0} USD`}
        onReveal={()=>setSettlePrivacy("reveal")}
        onHide={()=>setSettlePrivacy("hidden")}
        onClose={()=>setSettleOverlayOpen(false)}
      />

      {/* Tabs */}
      {tab==="trends" ? (
        <Modal title="Trendy" onClose={()=>setTab(null)}>
          <TrendsPanel gs={gs} playerId={playerId} onOpenTrend={(t)=>setTrendModal(t)} onRevealGlobal={()=>s.emit("reveal_global_next_year",{gameId,playerId},()=>{})} onRevealCrypto={()=>s.emit("reveal_crypto_next_year",{gameId,playerId},()=>{})} />
        </Modal>
      ) : null}

      {tab==="assets" ? (
        <Modal title="Aktiva" onClose={()=>setTab(null)}>
          <AssetsPanel inv={myInv} />
        </Modal>
      ) : null}

      {tab==="experts" ? (
        <Modal title="Experti" onClose={()=>setTab(null)}>
          <ExpertsPanel inv={myInv} />
        </Modal>
      ) : null}

      {tab==="accounting" ? (
        <Modal title="Účetnictví" onClose={()=>setTab(null)}>
          <AccountingPanel gs={gs} playerId={playerId} />
        </Modal>
      ) : null}

      {tab==="status" ? (
        <Modal title="Stav hry" onClose={()=>setTab(null)}>
          <pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(gs, null, 2)}</pre>
        </Modal>
      ) : null}
    </div>
  );
}

function TrendsPanel({ gs, playerId, onOpenTrend, onRevealGlobal, onRevealCrypto }){
  if(!gs?.trends) return <div className="muted">Trendy nejsou načtené.</div>;
  const yearsTotal = gs.config?.yearsTotal || 4;
  const currentYear = gs.year || 1;
  const byYear = gs.trends.byYear || {};
  const reveals = gs.reveals?.[playerId] || { globalYearsRevealed:[], cryptoYearsRevealed:[] };
  const gSet = new Set(reveals.globalYearsRevealed||[]);
  const cSet = new Set(reveals.cryptoYearsRevealed||[]);
  const inv = gs.inventory?.[playerId] || { experts:[] };
  const analystLeft = inv.experts.filter(e=>e.functionKey==="ANALYST" && !e.used).length;
  const guruLeft = inv.experts.filter(e=>e.functionKey==="CRYPTOGURU" && !e.used).length;

  return (
    <div>
      <div className="muted" style={{marginBottom:10}}>
        Scrolluj doprava. Aktuální rok je odkrytý. Budoucí roky jsou rubem (❓). Odkrytí je jen pro tebe.
      </div>

      <div className="revealBar">
        <div className="revealChip">Analytik: <b>{analystLeft}</b></div>
        <button className={"primaryBtn"+(analystLeft<1?" disabled":"")} disabled={analystLeft<1} onClick={onRevealGlobal}>Odkryj globální</button>
        <div style={{width:12}}></div>
        <div className="revealChip">Kryptoguru: <b>{guruLeft}</b></div>
        <button className={"primaryBtn"+(guruLeft<1?" disabled":"")} disabled={guruLeft<1} onClick={onRevealCrypto}>Odkryj krypto</button>
      </div>

      <div className="yearsScroller">
        {Array.from({length:yearsTotal}, (_,i)=>i+1).map(y=>{
          const data = byYear[String(y)];
          const isCurrentOrPast = y<=currentYear;
          const gRevealed = isCurrentOrPast || gSet.has(y);
          const cRevealed = isCurrentOrPast || cSet.has(y);

          return (
            <div key={y} className="yearCol">
              <div className="yearTitle">Rok {y}</div>

              <div className="secTitle">Globální</div>
              <div className="cardRow">
                {data?.globals?.map((t)=>(
                  <TrendCard key={t.trendId} revealed={gRevealed} title={t.name} icon={t.icon||"🌐"} clickable={gRevealed} onClick={()=> onOpenTrend && onOpenTrend(t)} />
                ))}
              </div>

              <div className="secTitle">Krypto</div>
              <div className="cardRow">
                <CryptoTrendCard revealed={cRevealed} crypto={data?.crypto} />
              </div>

              <div className="secTitle">Regionální</div>
              <div className="regionalGrid">
                {Object.values(data?.regional||{}).map((t)=>(
                  <div key={t.trendId} className="regionalToken">
                    <span>📍</span>
                    <span className="muted">{t.continent}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendsPreviewCard({ gs, onOpen, onOpenTrend }){
  const y = gs?.year || 1;
  const data = gs?.trends?.byYear?.[String(y)];
  return (
    <div className="card">
      <div className="titleRow">
        <div>
          <div className="title">Trendy • Rok {y}</div>
          <div className="muted">nové aktivní trendy</div>
        </div>
        <button className="ghostBtn" onClick={onOpen}>Všechny trendy</button>
      </div>

      <div className="trendPreview">
        <div className="trendPreviewBlock">
          <div className="secTitle">Globální</div>
          <div className="previewRow">
            {(data?.globals||[]).map(t=>(
              <div key={t.trendId} className="previewCard clickable" onClick={()=>onOpenTrend && onOpenTrend(t)} role="button" tabIndex={0}>
                <div className="previewIcon">{t.icon||"🌐"}</div>
                <div className="previewName">{t.name}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="trendPreviewBlock">
          <div className="secTitle">Krypto</div>
          <div className="previewRow">
            <CryptoTrendPreview crypto={data?.crypto} />
          </div>
        </div>

        <div className="trendPreviewBlock">
          <div className="secTitle">Regionální</div>
          <div className="regionalMini">
            {Object.values(data?.regional||{}).map(t=>(
              <div key={t.trendId} className="regionalDot">
                <span>📍</span>
                <span>{t.continent}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


function arrowForCoeff(k){
  if(k>1) return { sym:"⬆️", cls:"up", label:"roste" };
  if(k<1) return { sym:"⬇️", cls:"down", label:"klesá" };
  return { sym:"➡️", cls:"flat", label:"beze změny" };
}

function CryptoTrendCard({ revealed, crypto }){
  if(!revealed){
    return (
      <div className="trendCard wide back">
        <div className="trendBack">❓</div>
      </div>
    );
  }
  const coeff = crypto?.coeff || {};
  const coins = ["BTC","ETH","LTC","SIA"];
  return (
    <div className="trendCard wide cryptoCard">
      <div className="trendTop">
        <div className="trendIcon">₿</div>
        <div className="trendTitle">{crypto?.name || "Kryptotrend"}</div>
      </div>
      <div className="cryptoGrid">
        {coins.map(c=>{
          const k = Number(coeff[c] ?? 1);
          const a = arrowForCoeff(k);
          return (
            <div key={c} className={"cryptoRow "+a.cls}>
              <div className="coin">{c}</div>
              <div className="arrow">{a.sym}</div>
              <div className="coef">×{k}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CryptoTrendPreview({ crypto }){
  const coeff = crypto?.coeff || {};
  const coins = ["BTC","ETH","LTC","SIA"];
  return (
    <div className="previewCard wide cryptoPreview">
      <div className="previewName">{crypto?.name || "Kryptotrend"}</div>
      <div className="cryptoMiniGrid">
        {coins.map(c=>{
          const k = Number(coeff[c] ?? 1);
          const a = arrowForCoeff(k);
          return (
            <div key={c} className={"cryptoMini "+a.cls}>
              <span className="coin">{c}</span>
              <span className="arrow">{a.sym}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendCard({ revealed, title, icon, wide, onClick, clickable }){
  return (
    <div className={"trendCard"+(wide?" wide":"")+(revealed?"":" back")+(clickable?" clickable":"")} onClick={revealed && clickable ? onClick : undefined} role={revealed && clickable ? "button" : undefined} tabIndex={revealed && clickable ? 0 : undefined}>
      {revealed ? (
        <>
          <div className="trendIcon">{icon}</div>
          <div className="trendName">{title}</div>
        </>
      ) : (
        <>
          <div className="trendIcon">❓</div>
          <div className="trendName muted">Skryté</div>
        </>
      )}
    </div>
  );
}

function AssetsPanel({ inv }){
  return (
    <div>
      <div className="secTitle">Tradiční investice</div>
      <div className="list">
        {inv.investments.length? inv.investments.map(c=>(
          <div key={c.cardId} className="listItem">
            <div><b>{c.cardId}</b> • {c.name}</div>
            <div className="muted">{c.continent} • {c.type} • +{c.usdProduction} USD/rok</div>
          </div>
        )) : <div className="muted">Zatím žádné.</div>}
      </div>

      <div className="secTitle" style={{marginTop:16}}>Mining farmy</div>
      <div className="list">
        {inv.miningFarms.length? inv.miningFarms.map(c=>(
          <div key={c.cardId} className="listItem">
            <div><b>{c.cardId}</b> • {c.name}</div>
            <div className="muted">{c.crypto} • +{c.cryptoProduction} ks/rok • elektřina {c.electricityUSD} USD</div>
          </div>
        )) : <div className="muted">Zatím žádné.</div>}
      </div>
    </div>
  );
}

function ExpertsPanel({ inv }){
  return (
    <div className="list">
      {inv.experts.length? inv.experts.map(e=>(
        <div key={e.cardId} className="listItem">
          <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
            <div><b>{e.cardId}</b> • {e.functionLabel}</div>
            <div className={"pill"+(e.used?" dim":"")}>{e.used?"použito":"k dispozici"}</div>
          </div>
          <div className="muted">{e.functionDesc}</div>
        </div>
      )) : <div className="muted">Zatím žádné.</div>}
    </div>
  );
}

function AccountingPanel({ gs, playerId }){
  const entry = gs?.settle?.entries?.[playerId];
  if(!entry) return <div className="muted">Vyúčtování ještě není vypočítané. Ve fázi Vyúčtování klikni „Potvrdit připraven“.</div>;
  return (
    <div>
      <div className="bigNumber">{entry.settlementUsd>=0?"+":""}{entry.settlementUsd} USD</div>
      <div className="secTitle">Rozpad</div>
      <div className="list">
        {(entry.breakdown||[]).map((b, idx)=>(
          <div key={idx} className="listItem">
            <div>{b.label}</div>
            <div style={{fontWeight:800}}>{b.usd>=0?"+":""}{b.usd} USD</div>
          </div>
        ))}
      </div>
    </div>
  );
}
