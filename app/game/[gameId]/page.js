"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { getSocket } from "../../../lib/socket";
import { loadPlayerId } from "../../../lib/storage";
import { playClock, stopClock, playRing, stopRing } from "../../../lib/audio";
import { BottomBar, Modal } from "../../ui";

function SuperTopModal({ title, onClose, children }){
  // Same behavior/markup as Modal, but guaranteed above other modals.
  useEffect(()=>{ const onKey=(e)=>{ if(e.key==="Escape") onClose?.(); }; window.addEventListener("keydown", onKey); return ()=>window.removeEventListener("keydown", onKey); },[onClose]);
  return (
    <div className="modalBackdrop top superTop" onMouseDown={(e)=>{ if(e.target===e.currentTarget) onClose?.(); }}>
      <div className="modal">
        <div className="modalHeader">
          <div style={{fontWeight:900,fontSize:18}}>{title}</div>
          <button className="iconBtn" onClick={onClose}>✕</button>
        </div>
        <div style={{height:1,background:"rgba(255,255,255,.10)",margin:"12px 0"}}></div>
        {children}
      </div>
    </div>
  );
}

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
    { key:"ACQUIRE", label:"Akvizice", icon:"📷" },
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

function pickBackCamera(devices = []) {
  const byLabel = devices.find((d) => /back|rear|environment/i.test(d.label || ""));
  if (byLabel) return byLabel;
  return devices[devices.length - 1] || null;
}

export default function GamePage(){
  const { gameId } = useParams();
  const router = useRouter();
  const playerId = useMemo(()=> (typeof window==="undefined" ? "" : loadPlayerId()), []);
  // Socket must be initialized before any hooks that reference it (dependency arrays are evaluated during render).
  const s = useMemo(()=> getSocket(), []);
  const [gs, setGs] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(null);
  const [trendModal, setTrendModal] = useState(null); // {name, icon, desc}
  const [regionalModal, setRegionalModal] = useState(null); // {continent, name, icon, desc}

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

  // Acquisition (scan) UI
  const [scanOn, setScanOn] = useState(false);
  const [scanErr, setScanErr] = useState("");
  const [scanPreview, setScanPreview] = useState(null); // {card}
  const videoRef = useRef(null);
  const codeReader = useMemo(()=> new BrowserMultiFormatReader(), []);

  useEffect(()=>{

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

    // Acquisition step: default scanner OFF, clear preview
    if(phase==="BIZ" && step==="ACQUIRE"){
      setScanOn(false);
      setScanErr("");
      setScanPreview(null);
    }
  }, [gs?.phase, gs?.bizStep, gs?.year]);

  // Acquisition scanner lifecycle
  useEffect(()=>{
    const phase = gs?.phase;
    const step = gs?.bizStep;
    if(!(phase==="BIZ" && step==="ACQUIRE" && scanOn)){
      try{ codeReader.reset(); }catch{}
      return;
    }
    let active = true;
    setScanErr("");
    (async ()=>{
      try{
        // Prefer back camera
        try{
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
          stream.getTracks().forEach(t=>t.stop());
        }catch{}

        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if(!devices?.length) throw new Error("Kamera nenalezena");
        const back = pickBackCamera(devices);
        const deviceId = back?.deviceId || devices[0].deviceId;

        await codeReader.decodeFromVideoDevice(deviceId, videoRef.current, (result)=>{
          if(!active) return;
          if(result){
            const raw = String(result.getText()||"").trim();
            if(!raw) return;
            // Pause scanning while we confirm
            try{ codeReader.reset(); }catch{}
            active = false;
            // Ask server for preview (does NOT claim)
            s.emit("scan_preview", { gameId, playerId, cardQr: raw }, (res)=>{
              if(!res?.ok){
                setScanErr(res?.error || "Neznámá karta");
                // Resume scanning
                setScanOn(false);
                setTimeout(()=>{ setScanOn(true); }, 250);
                return;
              }
              setScanPreview({ card: res.card });
            });
          }
        });
      }catch(e){
        setScanErr(String(e?.message||e));
      }
    })();
    return ()=>{ active = false; try{ codeReader.reset(); }catch{} };
  }, [gs?.phase, gs?.bizStep, scanOn, codeReader, s, gameId, playerId]);


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

  function acceptScannedCard(cardId){
    s.emit("claim_card", { gameId, playerId, cardId }, (res)=>{
      if(!res?.ok) setErr(res?.error||"Chyba");
      setScanPreview(null);
      // Resume scanning if still in ACQUIRE
      setScanOn(false);
      setTimeout(()=>{ setScanOn(true); }, 250);
    });
  }

  function rejectScannedCard(){
    setScanPreview(null);
    setScanOn(false);
    setTimeout(()=>{ setScanOn(true); }, 250);
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
        <div className="topHeaderRow">
          <div>
            <div className="brand">KRYPTOPOLY</div>
            <div className="subBrand">{headerPhase}</div>
          </div>
          {gs?.year ? <div className="yearPill">Rok {gs.year}</div> : null}
        </div>
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
            onOpenTrend={(t)=>setTrendModal(t)}
            onOpenRegional={(t)=>setRegionalModal(t)}
          />
        ) : gs.phase==="BIZ" && gs.bizStep==="ML_BID" ? (
          <div className="card phaseCard">
            <div className="phaseHeader">
              <div className="phaseLeft">
                <div className="phaseIcon">👑</div>
                <div>
                  <div className="phaseTitle">Market Leader</div>
                  <div className="phaseSub">Zadej nabídku v USD. Po potvrzení se displej automaticky skryje.</div>
                </div>
              </div>
            </div>

            {/* golden rule: keep button styling (classes) identical; only change layout */}
            <div className="formRow stackConfirm">
              <input className="inputBig" inputMode="numeric" placeholder="0" value={mlBid} onChange={(e)=>setMlBid(e.target.value.replace(/[^\d]/g,""))} />
              <button className="primaryBtn" onClick={()=>commitML(mlBid===""?0:Number(mlBid))}>Potvrdit</button>
            </div>
            <div className="ctaRow">
              <button className="ghostBtn" onClick={()=>commitML(null)}>Nechci být ML</button>
            </div>
          </div>
        ) : gs.phase==="BIZ" && gs.bizStep==="MOVE" ? (
          <div className="card phaseCard">
            <div className="phaseHeader">
              <div className="phaseLeft">
                <div className="phaseIcon">📍</div>
                <div>
                  <div className="phaseTitle">Investice (pohyb)</div>
                  <div className="phaseSub">Vyber trh. Jakmile klikneš, trh zmizí ostatním. Volba je definitivní.</div>
                </div>
              </div>
            </div>
            {(() => {
              const year = Number(gs?.year || 1);
              const isFarm = (m) => {
                const t = String(m?.type || "").toLowerCase();
                const n = String(m?.name || "").toLowerCase();
                const id = String(m?.marketId || "").toLowerCase();
                return t.includes("farm") || n.includes("farma") || id.startsWith("f");
              };
              const kindOf = (m) => {
                const t = `${m?.type || ""} ${m?.name || ""}`.toLowerCase();
                if (isFarm(m)) return "farm";
                if (t.includes("průmys") || t.includes("prumys") || t.includes("industry")) return "industry";
                if (t.includes("těž") || t.includes("tez") || t.includes("mining") || t.includes("těža") ) return "mining";
                if (t.includes("země") || t.includes("zeme") || t.includes("agri") || t.includes("agriculture")) return "agri";
                return "other";
              };
              const continentLabel = (c) => {
                const x = String(c || "");
                if (x === "N_AMERICA") return "Sev. Amerika";
                if (x === "S_AMERICA") return "Již. Amerika";
                if (x === "EUROPE") return "Evropa";
                if (x === "AFRICA") return "Afrika";
                if (x === "ASIA") return "Asie";
                if (x === "OCEANIA") return "Austrálie";
                return x;
              };

              const continentOrder = ["N_AMERICA", "S_AMERICA", "EUROPE", "AFRICA", "ASIA", "OCEANIA"];
              const nonFarm = markets.filter((m) => !isFarm(m));
              const farms = markets.filter((m) => isFarm(m));

              const rows = continentOrder
                .map((cont) => {
                  const ms = nonFarm.filter((m) => m.continent === cont);
                  if (!ms.length) return null;
                  const sortKey = (m) => {
                    const k = kindOf(m);
                    return k === "industry" ? 0 : k === "mining" ? 1 : k === "agri" ? 2 : 9;
                  };
                  const picked = [...ms].sort((a, b) => sortKey(a) - sortKey(b)).slice(0, 2);
                  return { cont, markets: picked };
                })
                .filter(Boolean);

              const renderBtn = (m) => {
                const lockedBy = locks[m.marketId];
                const locked = !!lockedBy && lockedBy !== playerId;
                const mine = myMove?.marketId === m.marketId;
                const cls = kindOf(m);
                return (
                  <button
                    key={m.marketId}
                    className={"marketCell " + cls + (locked ? " locked" : "") + (mine ? " mine" : "")}
                    disabled={locked || !!myMove?.committed}
                    onClick={() => pickMarket(m.marketId)}
                    title={m.name || m.marketId}
                  >
                    <div className="marketCellTop">
                      <span className="marketCellTitle">{m.name || m.marketId}</span>
                      <span className="marketCellTag">{m.type}</span>
                    </div>
                    <div className="marketCellMeta">{m.marketId}</div>
                    {mine ? <div className="pill">MOJE</div> : locked ? <div className="pill dim">OBS.</div> : null}
                  </button>
                );
              };

              return (
                <div className="marketTable">
                  {rows.map((r) => (
                    <div key={r.cont} className="marketRow">
                      <div className="marketRowLabel">{continentLabel(r.cont)}</div>
                      <div className="marketRowCells">
                        {r.markets.map(renderBtn)}
                      </div>
                    </div>
                  ))}

                  {year >= 2 ? (
                    <div className="marketRow">
                      <div className="marketRowLabel">Farma</div>
                      <div className="marketRowCells farms">
                        {[0, 1, 2].map((i) => {
                          const m = farms[i];
                          if (!m) return <div key={i} className="marketCell placeholder">Farma {i + 1}</div>;
                          const mm = { ...m, name: `Farma ${i + 1}` };
                          return renderBtn(mm);
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </div>
        ) : gs.phase==="BIZ" && gs.bizStep==="AUCTION_ENVELOPE" ? (
          <div className="card phaseCard">
            <div className="phaseHeader">
              <div className="phaseLeft">
                <div className="phaseIcon">✉️</div>
                <div>
                  <div className="phaseTitle">Dražba – obálka</div>
                  <div className="phaseSub">Zadej nabídku v USD, nebo zvol neúčast. Pokud máš lobbistu, můžeš získat „poslední šanci“.</div>
                </div>
              </div>
              {isGM ? <button className="ghostBtn" onClick={openLobbyWindow}>Lobbista</button> : null}
            </div>

            {!aucEntry?.committed ? (
              <>
                {/* golden rule: keep button styling (classes) identical; only change layout */}
                <div className="formRow stackConfirm">
                  <input className="inputBig" inputMode="numeric" placeholder="0" value={aucBid} onChange={(e)=>setAucBid(e.target.value.replace(/[^\d]/g,""))} />
                  <button className="primaryBtn" onClick={()=>commitAuction(aucBid===""?0:Number(aucBid), useLobby)}>Potvrdit</button>
                </div>
                <div className="formRow">
                  <label className="checkRow">
                    <input type="checkbox" checked={useLobby} onChange={(e)=>setUseLobby(e.target.checked)} />
                    <span>Použít lobbistu (pokud ho mám)</span>
                  </label>
                </div>
                <button className="ghostBtn" onClick={()=>commitAuction(null, false)}>Nechci dražit</button>
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
        ) : gs.phase==="BIZ" && gs.bizStep==="ACQUIRE" ? (
          <div className="card phaseCard">
            <div className="phaseHeader">
              <div className="phaseLeft">
                <div className="phaseIcon">📷</div>
                <div>
                  <div className="phaseTitle">Získej svou investici</div>
                  <div className="phaseSub">Naskenuj QR na kartě a potvrď, že je tvoje. Můžeš skenovat více karet.</div>
                </div>
              </div>
              <button className={"primaryBtn"} onClick={()=>{ setScanErr(""); setScanOn(v=>!v); }}>
                {scanOn ? "Vypnout skener" : "Zapnout skener"}
              </button>
            </div>

            {scanOn ? (
              <>
                {scanErr ? <div className="notice">{scanErr}</div> : null}
                <div className="scanFrame">
                  <video ref={videoRef} className="scanVideo" />
                  <div className="scanHint">Zaměř QR kód</div>
                </div>
                <div className="muted" style={{marginTop:10}}>Tip: přibliž/oddal telefon, ať je QR ostrý.</div>
              </>
            ) : (
              <div className="scanIdle">
                <div className="scanIdleIcon">📷</div>
                <div className="scanIdleText">Skener je vypnutý. Zapni ho a naskenuj své karty.</div>
              </div>
            )}
          </div>
        ) : gs.phase==="CRYPTO" ? (
          <div className="card phaseCard">
            <div className="phaseHeader">
              <div className="phaseLeft">
                <div className="phaseIcon">₿</div>
                <div>
                  <div className="phaseTitle">Kryptofáze</div>
                  <div className="phaseSub">Naklikej změny v kusech. Pak potvrď. Ukazovací režim skryje detaily.</div>
                </div>
              </div>
            </div>
            <div className="cryptoList">
              {["BTC","ETH","LTC","SIA"].map(sym=>{
                const rate = gs.crypto?.rates?.[sym] || 0;
                const val = cryptoD[sym] || 0;
                const owned = me?.wallet?.crypto?.[sym] ?? 0;
                const lineUsd = -val * rate; // positive = gain (sell), negative = cost (buy)
                return (
                  <div key={sym} className="cryptoRow">
                    <div className="cryptoMeta">
                      <div className="cryptoSym">{sym}</div>
                      <div className="muted">{rate} USD/ks • Vlastním: <b>{owned}</b></div>
                    </div>
                    <div className="cryptoCtrls">
                      <button
                        className="ghostBtn"
                        onClick={()=>{
                          const next = val-1;
                          // selling (negative) cannot exceed owned
                          if(next < 0 && Math.abs(next) > owned) return;
                          setCryptoD({...cryptoD, [sym]: next});
                        }}
                      >−</button>
                      <div className="cryptoVal">{val}</div>
                      <button
                        className="ghostBtn"
                        onClick={()=>{
                          const next = val+1;
                          setCryptoD({...cryptoD, [sym]: next});
                        }}
                      >+</button>
                    </div>
                    <div className={"cryptoLineUsd "+(lineUsd>0?"pos":lineUsd<0?"neg":"neu")}>
                      {lineUsd>0?`+${lineUsd} USD`:lineUsd<0?`${lineUsd} USD`:`0 USD`}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="cryptoTotal">
              {(()=>{
                const total = ["BTC","ETH","LTC","SIA"].reduce((acc,sym)=> acc + (-(cryptoD[sym]||0) * (gs.crypto?.rates?.[sym]||0)), 0);
                const cls = total>0?"pos":total<0?"neg":"neu";
                const txt = total>0?`+${total} USD`:total<0?`${total} USD`:`0 USD`;
                return <div className={"cryptoTotalVal "+cls}>Celkem: {txt}</div>;
              })()}
            </div>
            <button className="primaryBtn full" onClick={commitCrypto}>Potvrdit transakci</button>
            <button className="ghostBtn full" onClick={()=>{ setCryptoD({BTC:0,ETH:0,LTC:0,SIA:0}); commitCrypto(); }}>Neobchoduji</button>
          </div>
        ) : gs.phase==="SETTLE" ? (
          <div className="card phaseCard">
            <div className="phaseHeader">
              <div className="phaseLeft">
                <div className="phaseIcon">🧾</div>
                <div>
                  <div className="phaseTitle">Audit</div>
                  <div className="phaseSub">Aplikace zobrazí částku k vyrovnání. Ukazovací režim ukáže jen jedno číslo.</div>
                </div>
              </div>
              <button className="ghostBtn" onClick={()=>setTab("accounting")}>Účetnictví</button>
            </div>

            <div className="auditHero">
              <div className="auditHeroTitle">Připrav se na uzavření roku</div>
              <div className="auditHeroHint">Až GM potvrdí krok, ukáže se částka pro vyrovnání. Pak fyzicky zaplatíš / obdržíš USD.</div>
            </div>

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

      {/* Acquisition: scanned card confirmation (always top) */}
      {scanPreview?.card ? (
        <SuperTopModal
          title={scanPreview.card.kind==="INVESTMENT" ? "Tradiční investice" : scanPreview.card.kind==="MINING_FARM" ? "Mining farma" : "Expert"}
          onClose={()=>{ setScanPreview(null); setScanOn(false); }}
        >
          <div style={{display:"grid",gap:10}}>
            <div className="cardInner">
              <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:900,fontSize:18}}>{scanPreview.card.name}</div>
                  <div className="muted">ID: {scanPreview.card.cardId}</div>
                </div>
                <div className="pill">{scanPreview.card.kind.replace("_"," ")}</div>
              </div>
              {scanPreview.card.kind==="INVESTMENT" ? (
                <div className="muted" style={{marginTop:8}}>
                  Kontinent: <b>{scanPreview.card.continent}</b> • Trh: <b>{scanPreview.card.market}</b> • Typ: <b>{scanPreview.card.type}</b>
                  <br/>Základní produkce: <b>+{scanPreview.card.usdProduction} USD</b>
                </div>
              ) : scanPreview.card.kind==="MINING_FARM" ? (
                <div className="muted" style={{marginTop:8}}>
                  Krypto: <b>{scanPreview.card.crypto}</b> • Produkce: <b>+{scanPreview.card.cryptoProduction} ks/rok</b>
                  <br/>Elektřina: <b>-{scanPreview.card.electricityUSD} USD</b>
                </div>
              ) : (
                <div className="muted" style={{marginTop:8}}>
                  Funkce: <b>{scanPreview.card.functionLabel}</b>
                  <br/>{scanPreview.card.functionDesc}
                </div>
              )}
            </div>

            <div className="ctaRow">
              <button className="primaryBtn full" onClick={()=>acceptScannedCard(scanPreview.card.cardId)}>✅ Ano, to je moje</button>
              <button className="ghostBtn full" onClick={rejectScannedCard}>✖ Ne, chyba</button>
            </div>
          </div>
        </SuperTopModal>
      ) : null}


      {/* NOTE: trend/regional detail overlays are rendered at the very end (superTop) so they always stay above other modals. */}
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
          <TrendsPanel gs={gs} playerId={playerId} onOpenTrend={(t)=>setTrendModal(t)} onOpenRegional={(t)=>setRegionalModal(t)} onRevealGlobal={()=>s.emit("reveal_global_next_year",{gameId,playerId},()=>{})} onRevealCrypto={()=>s.emit("reveal_crypto_next_year",{gameId,playerId},()=>{})} />
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
          <AccountingPanel gs={gs} playerId={playerId} gameId={gameId} />
        </Modal>
      ) : null}

      {tab==="status" ? (
        <Modal title="Stav hry" onClose={()=>setTab(null)}>
          <pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(gs, null, 2)}</pre>
        </Modal>
      ) : null}

      {trendModal ? (
        <SuperTopModal title={`${trendModal.icon||"🌐"} ${trendModal.name||"Trend"}`} onClose={()=>setTrendModal(null)}>
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
        </SuperTopModal>
      ) : null}

      {regionalModal ? (
        <SuperTopModal title={`${regionalModal.icon||"📍"} ${regionalModal.continent||"Kontinent"}`} onClose={()=>setRegionalModal(null)}>
          <div className="secTitle">{regionalModal.name||"Regionální trend"}</div>
          <div className="modalText" style={{marginTop:6}}>{regionalModal.desc || "Detail není k dispozici."}</div>
        </SuperTopModal>
      ) : null}
    </div>
  );
}

function TrendsPanel({ gs, playerId, onOpenTrend, onOpenRegional, onRevealGlobal, onRevealCrypto }){
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
              <div>
                {Object.values(data?.regional||{}).map((t)=>(
                  <div key={t.trendId} className="regRow">
                    <div className="regMeta">
                      <div className="regName">{t.continent}</div>
                      <div className="regCont muted">{t.name}</div>
                    </div>
                    <button className="regSymBtn" onClick={()=>onOpenRegional && onOpenRegional(t)} aria-label="Detail regionálního trendu">
                      <span className="regSymIcon">{t.icon || "📍"}</span>
                    </button>
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

function TrendsPreviewCard({ gs, onOpen, onOpenTrend, onOpenRegional }){
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
                <span>{t.continent}</span>
                <button className="regSymBtn" onClick={()=>onOpenRegional && onOpenRegional(t)} aria-label="Detail regionálního trendu">
                  <span className="regSymIcon">{t.icon || "📍"}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


function arrowForCoeff(k){
  // Use text arrows so we can color them via CSS.
  if(k>1) return { sym:"▲", cls:"up", label:"roste" };
  if(k<1) return { sym:"▼", cls:"down", label:"klesá" };
  return { sym:"→", cls:"flat", label:"beze změny" };
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

function AccountingPanel({ gs, playerId, gameId }){
  const inv = gs?.inventory?.[playerId] || { investments:[], miningFarms:[], experts:[] };
  const baseUsd = (inv.investments||[]).reduce((s,c)=>s + Number(c.usdProduction||0), 0);
  // (v3 test) region/global bonus rules are not fully encoded; show nominal placeholders.
  const regionalBonusUsd = 0;
  const globalBonusUsd = 0;

  const electricityUsd = (inv.miningFarms||[]).reduce((s,c)=>s + Number(c.electricityUSD||0), 0);
  const cryptoProd = { BTC:0, ETH:0, LTC:0, SIA:0 };
  for(const mf of (inv.miningFarms||[])){
    const sym = mf.crypto;
    if(sym && cryptoProd[sym]!=null) cryptoProd[sym] += Number(mf.cryptoProduction||0);
  }

  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  function openPreview(){
    setPreviewOpen(true);
    setLoading(true);

    s.emit("preview_audit", { gameId, playerId }, (res)=>{
      setLoading(false);
      if(!res?.ok){
        setPreview({ error: res?.error || "Chyba" });
      }else{
        setPreview({ settlementUsd: res.settlementUsd, breakdown: res.breakdown||[] });
      }
    });
  }

  return (
    <div className="kpGame">
      <button className="ghostBtn full" onClick={openPreview}>Předběžný audit</button>

      <div className="secTitle" style={{marginTop:12}}>Tradiční investice</div>
      <div className="list">
        <div className="listItem" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>Základní produkce</div>
          <div style={{fontWeight:900,color:"var(--primary)"}}>+{baseUsd} USD</div>
        </div>
        <div className="listItem" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>Regionální bonus</div>
          <div style={{fontWeight:900,color:"var(--primary)"}}>+{regionalBonusUsd} USD</div>
        </div>
        <div className="listItem" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>Globální bonus</div>
          <div style={{fontWeight:900,color:"var(--primary)"}}>+{globalBonusUsd} USD</div>
        </div>
      </div>

      <div className="secTitle" style={{marginTop:16}}>Mining farmy</div>
      <div className="list">
        <div className="listItem" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>Elektřina</div>
          <div style={{fontWeight:900,color:"var(--danger)"}}>−{electricityUsd} USD</div>
        </div>
        {(["BTC","ETH","LTC","SIA"]).map(sym=>{
          const v = cryptoProd[sym] || 0;
          return (
            <div key={sym} className="listItem" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>{sym} produkce / rok</div>
              <div style={{fontWeight:900,color:"var(--primary)"}}>+{v} ks</div>
            </div>
          );
        })}
      </div>

      {previewOpen ? (
        <SuperTopModal title="Předběžný audit" onClose={()=>setPreviewOpen(false)}>
          {loading ? (
            <div className="muted">Počítám…</div>
          ) : preview?.error ? (
            <div className="muted">{preview.error}</div>
          ) : (
            <>
              <div className="bigNumber">{(preview?.settlementUsd||0)>=0?"+":""}{preview?.settlementUsd||0} USD</div>
              <div className="secTitle">Rozpad</div>
              <div className="list">
                {(preview?.breakdown||[]).map((b, idx)=>(
                  <div key={idx} className="listItem" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>{b.label}</div>
                    <div style={{fontWeight:900}}>{b.usd>=0?"+":""}{b.usd} USD</div>
                  </div>
                ))}
              </div>
              <div className="muted" style={{marginTop:10}}>
                Pozn.: Předběžný audit je simulace pro test (nezavírá rok).
              </div>
            </>
          )}
        </SuperTopModal>
      ) : null}
    </div>
  );
}
