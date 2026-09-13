(function(){
  const cfg=window.OFICINA_SUPABASE||{};
  const cloud={client:null,ready:false,applying:false,syncTimer:null,cache:new Map(),profiles:[],invites:[],channel:null};
  const workspace=cfg.workspace||'oficina-sinop';

  function notice(msg){try{window.toast?window.toast(msg):console.log(msg)}catch(e){console.log(msg)}}
  function loginDialog(){return document.querySelector('#dlgLogin')}
  function key(t,id){return `${t}|${id}`}
  function state(){return window.__oficinaCloudGetState?window.__oficinaCloudGetState():{team:[],vehicles:[],treatments:[],catalog:[],suggestions:[],closures:[],presentation:[]}}
  function current(){return window.__oficinaGetCurrentUser?window.__oficinaGetCurrentUser():null}
  function setCurrent(u){if(window.__oficinaSetCurrentUser)window.__oficinaSetCurrentUser(u)}
  function serialize(obj){return JSON.stringify(obj)}
  function cacheSet(type,id,payload){cloud.cache.set(key(type,id),serialize(payload))}
  function cacheDelete(type,id){cloud.cache.delete(key(type,id))}
  function mapPayload(type,row){return (type==='closures'||type==='presentation')?(row.payload?.payload ?? row.payload):row.payload}

  function persistLocalOnly(render=true){
    const s=state();
    localStorage.setItem('oficinaFlowEquipeV3',JSON.stringify((s.team||[]).map(x=>({...x,pin:'0000'}))));
    localStorage.setItem('oficinaFlowVeiculos',JSON.stringify(s.vehicles||[]));
    localStorage.setItem('oficinaFlowTratativas',JSON.stringify(s.treatments||[]));
    localStorage.setItem('oficinaFlowCatalogoV3',JSON.stringify(s.catalog||[]));
    localStorage.setItem('oficinaFlowMonthClosuresV5',JSON.stringify(Object.fromEntries((s.closures||[]).map(x=>[x.id,x.payload]))));
    localStorage.setItem('oficinaFlowPresentationConfigV5',JSON.stringify((s.presentation||[])[0]?.payload||{}));
    localStorage.setItem('oficinaFlowSugestoesV6',JSON.stringify(s.suggestions||[]));
    if(render&&typeof window.renderAll==='function')window.renderAll();
  }

  async function refreshDirectory(){
    if(!cloud.ready||!cloud.client)return;
    try{
      const u=current();
      if(typeof window.isLeader==='function'&&window.isLeader()){
        const {data:p,error:pe}=await cloud.client.from('profiles').select('user_id,name,role,active,created_at').order('name');
        if(!pe)cloud.profiles=p||[];
      } else cloud.profiles=u?[{user_id:u.id,name:u.name,role:u.role,active:true}]:[];

      if(typeof window.isAdmin==='function'&&window.isAdmin()){
        const {data:i,error:ie}=await cloud.client.from('invites').select('email,name,role,active,created_at').order('created_at',{ascending:false});
        if(!ie)cloud.invites=i||[];
      } else cloud.invites=[];

      if(typeof window.renderAccess==='function')window.renderAccess();
    }catch(e){console.error('refreshDirectory',e)}
  }

  async function syncNow(force=false){
    if(!cloud.ready||cloud.applying||!cloud.client||!cloud._userId)return;
    const all=state(),desired=new Map(),upserts=[];
    for(const [type,arr] of Object.entries(all)){
      for(const item of (arr||[])){
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
    for(const k of cloud.cache.keys()){
      if(!desired.has(k)){
        const [t,...rest]=k.split('|');
        deletions.push([t,rest.join('|')]);
      }
    }
    for(const [t,id] of deletions){
      const {error}=await cloud.client.from('entities').delete().eq('workspace',workspace).eq('entity_type',t).eq('entity_id',id);
      if(!error)cacheDelete(t,id);
    }
  }

  async function loadAll(){
    const local=state();
    const {data,error}=await cloud.client.from('entities').select('entity_type,entity_id,payload,updated_at').eq('workspace',workspace);
    if(error)throw error;

    if(!data||!data.length){
      if(typeof window.isAdmin==='function'&&window.isAdmin()){
        await syncNow(true);
        notice('Base online inicializada com os dados deste aparelho.');
      }
      return;
    }

    cloud.applying=true;
    const groups={team:null,vehicles:null,treatments:null,catalog:null,suggestions:null,closures:null,presentation:null};
    const temp={team:[],vehicles:[],treatments:[],catalog:[],suggestions:[],closures:{},presentation:null};
    const seen=new Set();
    cloud.cache.clear();

    for(const row of data){
      const t=row.entity_type,id=row.entity_id,p=mapPayload(t,row);
      seen.add(t);cacheSet(t,id,row.payload);
      if(['team','vehicles','treatments','catalog','suggestions'].includes(t))temp[t].push(p);
      else if(t==='closures')temp.closures[id]=p;
      else if(t==='presentation'&&id==='config')temp.presentation=p;
    }

    groups.team=seen.has('team')?temp.team:(local.team||[]);
    groups.vehicles=seen.has('vehicles')?temp.vehicles:(local.vehicles||[]);
    groups.treatments=seen.has('treatments')?temp.treatments:(local.treatments||[]);
    groups.catalog=seen.has('catalog')?temp.catalog:(local.catalog||[]);
    groups.suggestions=seen.has('suggestions')?temp.suggestions:(local.suggestions||[]);
    groups.closures=seen.has('closures')?temp.closures:Object.fromEntries((local.closures||[]).map(x=>[x.id,x.payload]));
    groups.presentation=seen.has('presentation')?temp.presentation:((local.presentation||[])[0]?.payload||null);

    if(window.__oficinaCloudApplyState)window.__oficinaCloudApplyState(groups);
    persistLocalOnly(false);
    cloud.applying=false;
    if(typeof window.renderAll==='function')window.renderAll();

    const missing=['team','vehicles','treatments','catalog','suggestions','closures','presentation'].filter(t=>!seen.has(t));
    if(missing.length&&typeof window.isAdmin==='function'&&window.isAdmin())await syncNow(true);
  }

  function queueSync(){
    if(!cloud.ready||cloud.applying)return;
    clearTimeout(cloud.syncTimer);
    cloud.syncTimer=setTimeout(()=>syncNow(false).catch(e=>{
      console.error('syncNow',e);
      notice('Alteração salva neste aparelho; sincronização online pendente.');
    }),450);
  }

  async function loadProfile(user){
    const {data,error}=await cloud.client.from('profiles').select('user_id,name,role,active').eq('user_id',user.id).single();
    if(error)throw error;
    if(!data?.active)throw new Error('Seu acesso ainda não foi liberado pelo administrador.');
    cloud._userId=user.id;
    setCurrent({id:user.id,name:data.name,role:data.role,email:user.email});
    cloud.ready=true;
    if(typeof window.applyAccessUI==='function')window.applyAccessUI();
    await loadAll();
    await refreshDirectory();
    subscribeRealtime();
    const first=[...document.querySelectorAll('.tab')].find(b=>!b.classList.contains('hidden'));
    const active=document.querySelector('.tab.active:not(.hidden)');
    if(first&&!active&&typeof window.switchTab==='function')window.switchTab(first.dataset.tab);
  }

  async function login(){
    const email=document.querySelector('#loginEmail')?.value.trim();
    const password=document.querySelector('#loginPassword')?.value||'';
    if(!email||!password){notice('Informe e-mail e senha.');return}
    try{
      const client=await ensureClient();
      const {data,error}=await client.auth.signInWithPassword({email,password});
      if(error)throw error;
      await loadProfile(data.user);
      if(loginDialog()?.open)loginDialog().close();
      notice(`Acesso liberado: ${current()?.name||''}`);
    }catch(e){
      console.error('login',e);
      notice(e.message||'Não foi possível entrar.');
    }
  }

  async function signup(adminMode=false){
    const email=document.querySelector('#loginEmail')?.value.trim();
    const password=document.querySelector('#loginPassword')?.value||'';
    const name=document.querySelector('#loginName')?.value.trim()||'';
    const bootstrap=document.querySelector('#loginBootstrap')?.value.trim()||'';
    if(!email||password.length<8||!name){notice('Informe nome, e-mail e uma senha com pelo menos 8 caracteres.');return}
    if(adminMode&&!bootstrap){notice('Informe o código de ativação do administrador.');return}
    try{
      const options={data:{name},emailRedirectTo:location.origin+location.pathname};
      if(adminMode)options.data.bootstrap_code=bootstrap;
      const client=await ensureClient();
      const {data,error}=await client.auth.signUp({email,password,options});
      if(error)throw error;
      if(data.session&&data.user){
        await loadProfile(data.user);
        if(loginDialog()?.open)loginDialog().close();
        notice('Conta criada e conectada.');
      }else{
        notice('Conta criada. Confirme o e-mail recebido e depois entre.');
      }
    }catch(e){
      console.error('signup',e);
      notice(e.message||'Não foi possível criar a conta.');
    }
  }

  async function logout(){
    try{const client=await ensureClient();await client.auth.signOut()}catch(e){}
    cloud.ready=false;cloud._userId=null;setCurrent(null);
    if(cloud.channel){try{cloud.client.removeChannel(cloud.channel)}catch(e){} cloud.channel=null;}
    if(typeof window.applyAccessUI==='function')window.applyAccessUI();
    if(loginDialog()&&!loginDialog().open)loginDialog().showModal();
  }

  async function restore(){
    try{
      const client=await ensureClient();
      const {data:{session}}=await client.auth.getSession();
      if(session?.user){
        await loadProfile(session.user);
        if(loginDialog()?.open)loginDialog().close();
        return;
      }
    }catch(e){console.error('restore',e)}
    setCurrent(null);
    if(typeof window.applyAccessUI==='function')window.applyAccessUI();
    if(loginDialog()&&!loginDialog().open)loginDialog().showModal();
  }

  function subscribeRealtime(){
    if(cloud.channel)try{cloud.client.removeChannel(cloud.channel)}catch(e){}
    cloud.channel=cloud.client.channel('oficina-entities')
      .on('postgres_changes',{event:'*',schema:'public',table:'entities',filter:`workspace=eq.${workspace}`},()=>{
        clearTimeout(cloud._reloadTimer);
        cloud._reloadTimer=setTimeout(()=>loadAll().catch(e=>console.error('realtime reload',e)),300);
      }).subscribe();
  }

  async function createInvite(){
    if(!cloud.ready||typeof window.isAdmin!=='function'||!window.isAdmin()){notice('Apenas o administrador pode convidar usuários.');return}
    const email=document.querySelector('#inviteEmail')?.value.trim().toLowerCase();
    const name=document.querySelector('#inviteName')?.value.trim();
    const role=document.querySelector('#inviteRole')?.value;
    if(!email||!name||!role){notice('Preencha nome, e-mail e função.');return}
    const {error}=await cloud.client.from('invites').upsert({email,name,role,active:true,created_by:cloud._userId},{onConflict:'email'});
    if(error){console.error(error);notice('Não foi possível criar o convite.');return}
    document.querySelector('#inviteEmail').value='';
    document.querySelector('#inviteName').value='';
    await refreshDirectory();
    notice('Acesso liberado. O colaborador já pode criar a conta.');
  }

  async function setProfileActive(userId,active){
    if(!window.isAdmin?.())return;
    const {error}=await cloud.client.from('profiles').update({active,updated_at:new Date().toISOString()}).eq('user_id',userId);
    if(error){notice('Não foi possível alterar o usuário.');return}
    await refreshDirectory();
  }

  async function setProfileRole(userId,role){
    if(!window.isAdmin?.())return;
    const {error}=await cloud.client.from('profiles').update({role,updated_at:new Date().toISOString()}).eq('user_id',userId);
    if(error){notice('Não foi possível alterar a função.');return}
    await refreshDirectory();
  }

  let libraryPromise=null;

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const existing=[...document.scripts].find(s=>s.src===src);
      if(existing){
        if(window.supabase?.createClient)return resolve();
        existing.addEventListener('load',()=>resolve(),{once:true});
        existing.addEventListener('error',()=>reject(new Error('Falha ao carregar '+src)),{once:true});
        return;
      }
      const s=document.createElement('script');
      s.src=src;
      s.async=true;
      s.crossOrigin='anonymous';
      s.onload=()=>resolve();
      s.onerror=()=>reject(new Error('Falha ao carregar '+src));
      document.head.appendChild(s);
    });
  }

  async function loadSupabaseLibrary(){
    if(window.supabase?.createClient)return window.supabase;
    if(libraryPromise)return libraryPromise;
    libraryPromise=(async()=>{
      const sources=[
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
        'https://unpkg.com/@supabase/supabase-js@2'
      ];
      let lastError=null;
      for(const src of sources){
        try{
          await loadScript(src);
          if(window.supabase?.createClient)return window.supabase;
        }catch(e){
          lastError=e;
          console.warn('Supabase CDN falhou:',src,e);
        }
      }
      throw lastError||new Error('Não foi possível carregar a biblioteca do Supabase.');
    })();
    return libraryPromise;
  }

  async function ensureClient(){
    if(cloud.client)return cloud.client;
    const api=await loadSupabaseLibrary();
    if(!api||typeof api.createClient!=='function'){
      throw new Error('Biblioteca do Supabase não foi carregada.');
    }
    if(!cfg.url||!cfg.publishableKey){
      throw new Error('Configuração online do Oficina Sinop não foi carregada.');
    }
    cloud.client=api.createClient(cfg.url,cfg.publishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    return cloud.client;
  }

  async function init(){
    try{
      await ensureClient();
      cloud.connectionError=null;
    }catch(e){
      cloud.connectionError=e;
      console.error('Supabase init',e);
      notice(e.message||'Falha ao carregar a conexão online.');
    }
    window.addEventListener('online',()=>{if(cloud.ready)syncNow(false).catch(console.error)});
  }

  cloud.init=init;
  cloud.login=login;
  cloud.signup=signup;
  cloud.logout=logout;
  cloud.restore=restore;
  cloud.queueSync=queueSync;
  cloud.syncNow=syncNow;
  cloud.refreshDirectory=refreshDirectory;
  cloud.createInvite=createInvite;
  cloud.setProfileActive=setProfileActive;
  cloud.setProfileRole=setProfileRole;
  window.oficinaCloud=cloud;
})();