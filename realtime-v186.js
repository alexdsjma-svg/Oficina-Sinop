import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION="18.7";
let sb=null, channel=null, activeToken="", retryTimer=null, pullTimer=null, notifTimer=null;

function badge(){
  let el=document.getElementById("ajcRealtimeBadge");
  if(!el){
    el=document.createElement("div");
    el.id="ajcRealtimeBadge";
    el.innerHTML='<span class="ajc-rt-dot"></span><span class="ajc-rt-text">Tempo real: preparando</span>';
    document.body.appendChild(el);
  }
  return el;
}
function status(state,text){
  const el=badge();
  el.dataset.state=state;
  const t=el.querySelector(".ajc-rt-text");
  if(t)t.textContent=text;
}
function cloud(){return window.oficinaCloud}
function cfg(){return window.OFICINA_SUPABASE||{}}
function online(){return navigator.onLine!==false}
function pullSoon(){
  clearTimeout(pullTimer);
  pullTimer=setTimeout(async()=>{
    try{
      status("sync","Tempo real: atualizando…");
      await cloud()?.pullNow?.();
      status("live","Tempo real: conectado");
    }catch(e){
      console.warn("AJC realtime pull",e);
      status(online()?"sync":"offline",online()?"Tempo real: reconectando":"Offline • sincroniza ao voltar");
    }
  },120);
}
function notifSoon(){
  clearTimeout(notifTimer);
  notifTimer=setTimeout(async()=>{try{await cloud()?.refreshNotifications?.()}catch(e){console.warn("AJC realtime notifications",e)}},100);
}
async function disconnect(){
  try{if(sb&&channel)await sb.removeChannel(channel)}catch(e){}
  sb=null;channel=null;activeToken="";
}
async function connect(){
  if(!online()){status("offline","Offline • sincroniza ao voltar");return}
  const c=cloud(), conf=cfg(), token=c?.session?.access_token||"";
  if(!c?.ready||!token||!conf.url||!conf.publishableKey){
    status("wait","Tempo real: aguardando login");
    return;
  }
  if(channel&&activeToken===token)return;
  await disconnect();
  activeToken=token;
  try{
    sb=createClient(conf.url,conf.publishableKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      realtime:{params:{eventsPerSecond:20}}
    });
    sb.realtime.setAuth(token);
    channel=sb.channel("ajc-oficina-live-"+(conf.workspace||"oficina-sinop"))
      .on("postgres_changes",{event:"*",schema:"public",table:"entities",filter:"workspace=eq."+(conf.workspace||"oficina-sinop")},pullSoon)
      .on("postgres_changes",{event:"*",schema:"public",table:"notifications"},notifSoon)
      .subscribe((s)=>{
        if(s==="SUBSCRIBED")status("live","Tempo real: conectado");
        else if(["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(s))status(online()?"sync":"offline",online()?"Tempo real: reconectando":"Offline • sincroniza ao voltar");
      });
  }catch(e){
    console.warn("AJC realtime connect",e);
    status("sync","Tempo real: reconectando");
  }
}
function brand(){
  const small=document.querySelector(".mini-brand-text small");
  if(small)small.textContent="V18.7 • Home V17.7 restaurada";
  document.title="AJC Oficina V18.7 — Home V17.7 restaurada";
}
function start(){
  brand();
  badge();
  connect();
  clearInterval(retryTimer);
  retryTimer=setInterval(connect,2500);
}
window.addEventListener("online",()=>{status("sync","Tempo real: reconectando");connect()});
window.addEventListener("offline",()=>status("offline","Offline • sincroniza ao voltar"));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")connect()});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
setTimeout(start,1200);
window.AJC_REALTIME_VERSION=VERSION;
