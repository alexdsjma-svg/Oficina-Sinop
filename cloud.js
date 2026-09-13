(function(){
  const cfg=window.OFICINA_SUPABASE||{};
  const api=window.supabase;
  const cloud={client:null,ready:false,applying:false,syncTimer:null,cache:new Map(),profiles:[],invites:[],channel:null};
  const workspace=cfg.workspace||'oficina-sinop';
  function notice(msg){try{toast(msg)}catch(e){console.log(msg)}}
  function key(t,id){return `${t}|${id}`}
  function safeTeam(){return (window.equipe||equipe||[]).map(x=>{const y={...x};delete y.pin;return y})}
  function collections(){
    return {
      team:safeTeam(),
      vehicles:[...(window.veiculos||veiculos||[])],
      treatments:[...(window.tratativas||tratativas||[])],
      catalog:[...(window.catalogo||catalogo||[])],
      suggestions:[...(window.sugestoes||sugestoes||[])],
      closures:Object.entries(window.monthClosures||monthClosures||{}).map(([id,payload])=>({id,payload})),
      presentation:[{id:'config',payload:(window.presentationConfig||presentationConfig||{})}]
    };
  }
  function serialize(obj){return JSON.stringify(obj)}
  function cacheSet(type,id,payload){cloud.cache.set(key(type,id),serialize(payload))}
  function cacheDelete(type,id){cloud.cache.delete(key(type,id))}
  function mapPayload(type,row){
    if(type==='closures'||type==='presentation') return row.payload?.payload ?? row.payload;
    return row.payload;
  }
  async function refreshDirectory(){
    if(!cloud.ready||!cloud.client)return;
    try{
      if(typeof isLeader==='function'&&isLeader()){
        const {data:p,error:pe}=await cloud.client.from('profiles').select('user_id,name,role,active,created_at').order('name');
        if(!pe)cloud.profiles=p||[];
      } else cloud.profiles=currentUser?[{user_id:currentUser.id,name:currentUser.name,role:currentUser.role,active:true}]:[];
      if(typeof isAdmin==='function'&&isAdmin()){
        const {data:i,error:ie}=await cloud.client.from('invites').select('email,name,role,active,created_at').order('created_at',{ascending:false});
        if(!ie)cloud.invites=i||[];
      } else cloud.invites=[];
      if(typeof renderAccess==='function')renderAccess();
    }catch(e){console.error(e)}
  }
  async function loadAll(){
    const {data,error}=await cloud.client.from('entities').select('entity_type,entity_id,payload,updated_at').eq('workspace',workspace);
    if(error)throw error;
    if(!data||!data.length){
      if(typeof isAdmin==='function'&&isAdmin()) await syncNow(true);
      return;
    }
    cloud.applying=true;
    const groups={team:[],vehicles:[],treatments:[],catalog:[],suggestions:[],closures:{},presentation:null};
    cloud.cache.clear();
    for(const row of data){
      const t=row.entity_type,id=row.entity_id,p=mapPayload(t,row);
      cacheSet(t,id,row.payload);
      if(['team','vehicles','treatments','catalog','suggestions'].includes(t))groups[t].push(p);
      else if(t==='closures')groups.closures[id]=p;
      else if(t==='presentation'&&id==='config')groups.presentation=p;
    }
    if(groups.team.length)equipe=groups.team.map(x=>({...x,pin:'0000'}));
    veiculos=groups.vehicles;
    tratativas=groups.treatments;
    catalogo=groups.catalog;
    sugestoes=groups.suggestions;
    monthClosures=groups.closures||{};
    if(groups.presentation)presentationConfig=groups.presentation;
    normalizeData();
    persistLocalOnly(false);
    cloud.applying=false;
    renderAll();
  }
  function persistLocalOnly(render=true){
    localStorage.setItem('oficinaFlowEquipeV3',JSON.stringify(equipe));
    localStorage.setItem('oficinaFlowVeiculos',JSON.stringify(veiculos));
    localStorage.setItem('oficinaFlowTratativas',JSON.stringify(tratativas));
    localStorage.setItem('oficinaFlowCatalogoV3',JSON.stringify(catalogo));
    localStorage.setItem('oficinaFlowMonthClosuresV5',JSON.stringify(monthClosures));
    localStorage.setItem('oficinaFlowPresentationConfigV5',JSON.stringify(presentationConfig));
    localStorage.setItem('oficinaFlowSugestoesV6',JSON.stringify(sugestoes));
    localStorage.setItem('oficinaFlowAuditV6',JSON.stringify(auditLog));
    if(render)renderAll();
  }
  async function syncNow(force=false){
    if(!cloud.ready||cloud.applying||!cloud.client||!cloud._userId)return;
    const all=collections(),desired=new Map(),upserts=[];
    for(const [type,arr] of Object.entries(all)){
      for(const item of arr){
        const id=String(item.id||''); if(!id)continue;
        const payload=(type==='closures'||type==='presentation')?{payload:item.payload}:item;
        desired.set(key(type,id),serialize(payload));
        if(force||cloud.cache.get(key(type,id))!==serialize(payload)){
          upserts.push({workspace,entity_type:type,entity_id:id,payload,updated_by:cloud._userId,updated_at:new Date().toISOString()});
        }
      }
    }
    if(upserts.length){
      const {error}=await cloud.client.from('entities').upsert(upserts,{onConflict:'workspace,entity_type,entity_id'});
      if(error)throw error;
      for(const r of upserts)cacheSet(r.entity_type,r.entity_id,r.payload);
    }
    const deletions=[];
    for(const k of cloud.cache.keys())if(!desired.has(k)){const [t,...rest]=k.split('|');deletions.push([t,rest.join('|')]);}
    for(const [t,id] of deletions){
      const {error}=await cloud.client.from('entities').delete().eq('workspace',workspace).eq('entity_type',t).eq('entity_id',id);
      if(!error)cacheDelete(t,id);
    }
  }
  function queueSync(){
    if(!cloud.ready||cloud.applying)return;
    clearTimeout(cloud.syncTimer);
    cloud.syncTimer=setTimeout(()=>syncNow(false).catch(e=>{console.error(e);notice('Alteração salva localmente; sincronização pendente.')}),450);
  }
  async function loadProfile(user){
    const {data,error}=await cloud.client.from('profiles').select('user_id,name,role,active').eq('user_id',user.id).single();
    if(error)throw error;
    if(!data?.active)throw new Error('Seu acesso ainda não foi liberado pelo administrador.');
    cloud._userId=user.id;
    currentUser={id:user.id,name:data.name,role:data.role,email:user.email};
    cloud.ready=true;
    applyAccessUI();
    await loadAll();
    await refreshDirectory();
    subscribeRealtime();
    const first=$$('.tab').find(b=>!b.classList.contains('hidden'));
    if(first&&!$('.tab.active:not(.hidden)'))switchTab(first.dataset.tab);
  }
  async function login(){
    const email=$('#loginEmail')?.value.trim(),password=$('#loginPassword')?.value||'';
    if(!email||!password){notice('Informe e-mail e senha.');return}
    try{
      const {data,error}=await cloud.client.auth.signInWithPassword({email,password}); if(error)throw error;
      await loadProfile(data.user); dlgLogin.close(); notice(`Acesso liberado: ${currentUser.name}`);
    }catch(e){console.error(e);notice(e.message||'Não foi possível entrar.');}
  }
  async function signup(adminMode=false){
    const email=$('#loginEmail')?.value.trim(),password=$('#loginPassword')?.value||'',name=$('#loginName')?.value.trim()||'';
    const bootstrap=$('#loginBootstrap')?.value.trim()||'';
    if(!email||password.length<8||!name){notice('Informe nome, e-mail e uma senha com pelo menos 8 caracteres.');return}
    if(adminMode&&!bootstrap){notice('Informe o código de ativação do administrador.');return}
    try{
      const options={data:{name}}; if(adminMode)options.data.bootstrap_code=bootstrap;
      const {data,error}=await cloud.client.auth.signUp({email,password,options}); if(error)throw error;
      if(data.session&&data.user){await loadProfile(data.user);dlgLogin.close();notice('Conta criada e conectada.');}
      else notice('Conta criada. Confirme o e-mail recebido e depois entre.');
    }catch(e){console.error(e);notice(e.message||'Não foi possível criar a conta.');}
  }
  async function logout(){
    try{await cloud.client.auth.signOut()}catch(e){}
    cloud.ready=false;cloud._userId=null;currentUser=null;
    if(cloud.channel){try{cloud.client.removeChannel(cloud.channel)}catch(e){} cloud.channel=null;}
    applyAccessUI(); dlgLogin.showModal();
  }
  async function restore(){
    try{
      const {data:{session}}=await cloud.client.auth.getSession();
      if(session?.user){await loadProfile(session.user);dlgLogin.close();return}
    }catch(e){console.error(e)}
    currentUser=null;applyAccessUI();dlgLogin.showModal();
  }
  function subscribeRealtime(){
    if(cloud.channel)try{cloud.client.removeChannel(cloud.channel)}catch(e){}
    cloud.channel=cloud.client.channel('oficina-entities')
      .on('postgres_changes',{event:'*',schema:'public',table:'entities',filter:`workspace=eq.${workspace}`},()=>{
        clearTimeout(cloud._reloadTimer);cloud._reloadTimer=setTimeout(()=>loadAll().catch(console.error),250);
      }).subscribe();
  }
  async function createInvite(){
    if(!cloud.ready||typeof isAdmin!=='function'||!isAdmin()){notice('Apenas o administrador pode convidar usuários.');return}
    const email=$('#inviteEmail')?.value.trim().toLowerCase(),name=$('#inviteName')?.value.trim(),role=$('#inviteRole')?.value;
    if(!email||!name||!role){notice('Preencha nome, e-mail e função.');return}
    const {error}=await cloud.client.from('invites').upsert({email,name,role,active:true,created_by:cloud._userId},{onConflict:'email'});
    if(error){console.error(error);notice('Não foi possível criar o convite.');return}
    $('#inviteEmail').value='';$('#inviteName').value='';await refreshDirectory();notice('Convite liberado. O colaborador já pode criar a conta.');
  }
  async function setProfileActive(userId,active){
    if(!isAdmin())return;
    const {error}=await cloud.client.from('profiles').update({active,updated_at:new Date().toISOString()}).eq('user_id',userId);
    if(error){notice('Não foi possível alterar o usuário.');return}await refreshDirectory();
  }
  async function setProfileRole(userId,role){
    if(!isAdmin())return;
    const {error}=await cloud.client.from('profiles').update({role,updated_at:new Date().toISOString()}).eq('user_id',userId);
    if(error){notice('Não foi possível alterar a função.');return}await refreshDirectory();
  }
  async function init(){
    if(!api||!cfg.url||!cfg.publishableKey){console.error('Supabase não configurado');return}
    cloud.client=api.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    window.oficinaCloud=cloud;
  }
  cloud.init=init;cloud.login=login;cloud.signup=signup;cloud.logout=logout;cloud.restore=restore;cloud.queueSync=queueSync;cloud.syncNow=syncNow;cloud.refreshDirectory=refreshDirectory;cloud.createInvite=createInvite;cloud.setProfileActive=setProfileActive;cloud.setProfileRole=setProfileRole;
  window.oficinaCloud=cloud;
})();