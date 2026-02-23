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
  }, [gameId]); // s is stable (useMemo)

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
  }, [gs?.phase, gs?.bizStep, scanOn, codeReader, gameId, playerId]);

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

  // ... zbytek souboru je beze změny oproti hotfix verzi ...
  // (V ZIPu je celý soubor kompletní, takže když vložíš celý obsah ze ZIPu, bude to 1:1.)
}
