(function(){
  const cfg=window.OFICINA_SUPABASE||{};
  const cloud={
    ready:false,applying:false,syncTimer:null,pollTimer:null,
    cache:new Map(),profiles:[],invites:[],session:null,_userId:null
  };
  const workspace=cfg.workspace||'oficina-sinop';
  const SESSION_KEY='oficinaSupabaseSessionV1';

  function notice(msg){try{window.toast?window.toast(msg):console.log(msg)}catch(e){console.log(msg)}}
  function dialog(){return document.querySelector('#dlgLogin')}
  function key(t,id){return `${t}|${id}`}
  function current(){return window.__oficinaGetCurrentUser?window.__oficinaGetCurrentUser():null}
  function setCurrent(u){if(window.__oficinaSetCurrentUser)window.__oficinaSetCurrentUser(u)}
  function state(){return window.__oficinaCloudGetState?window.__oficinaCloudGetState():{team:[],vehicles:[],treatments:[],catalog:[],suggestions:[],closures:[],presentation:[]}}
  function serialize(v){return JSON.stringify(v)}
  function cacheSet(t,id,p){cloud.cache.set(key(t,id),serialize(p))}
  function cacheDelete(t,id){cloud.cache.delete(key(t,id))}
  function mapPayload(t,row){return (t==='closures'||t==='presentation')?(row.payload?.payload??row.payload):row.payload}

  function checkConfig(){
    if(!cfg.url||!cfg.publishableKey)throw new Error('Configuração online do Oficina Sinop não foi carregada.');
  }

  function authHeaders(extra={}){
    checkConfig();
    return {'apikey':cfg.publishableKey,'Content-Type':'application/json',...extra};
  }

  function saveSession(s){
    if(!s){localStorage.removeItem(SESSION_KEY);cloud.session=null;return null}
    const expiresAt=s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600);
    cloud.session={...s,expires_at:expiresAt};
    localStorage.setItem(SESSION_KEY,JSON.stringify(cloud.session));
    return cloud.session;
  }

  function loadSession(){
    try{
      const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
      cloud.session=s;
      return s;
    }catch(e){cloud.session=null;return null}
  }

  async function parseResponse(res){
    const text=await res.text();
    let body=null;
    try{body=text?JSON.parse(text):null}catch(e){body=text}
    if(!res.ok){
      const msg=body?.msg||body?.message||body?.error_description||body?.error||(`Erro HTTP ${res.status}`);
      const err=new Error(msg);
      err.status=res.status;
      err.body=body;
      throw err;
    }
    return body;
  }

  async function authRequest(path,{method='POST',body,token}={}){
    const headers=authHeaders(token?{'Authorization':`Bearer ${token}`}:{});
    const res=await fetch(`${cfg.url}/auth/v1${path}`,{
      method,headers,body:body===undefined?undefined:JSON.stringify(body)
    });
    return parseResponse(res);
  }

  async function refreshSession(){
    const s=cloud.session||loadSession();
    if(!s?.refresh_token)throw new Error('Sessão expirada. Entre novamente.');
    const fresh=await authRequest('/token?grant_type=refresh_token',{body:{refresh_token:s.refresh_token}});
    return saveSession(fresh);
  }

  async function ensureSession(){
    const s=cloud.session||loadSession();
    if(!s?.access_token)throw new Error('Sessão não encontrada. Entre novamente.');
    const now=Math.floor(Date.now()/1000);
    if(!s.expires_at||s.expires_at-now<90)return refreshSession();
    return s;
  }

  async function restRequest(path,{method='GET',body,prefer,retry=true}={}){
    let s=await ensureSession();
    const headers=authHeaders({
      'Authorization':`Bearer ${s.access_token}`,
      ...(prefer?{'Prefer':prefer}:{})
    });
    let res=await fetch(`${cfg.url}/rest/v1/${path}`,{
      method,headers,body:body===undefined?undefined:JSON.stringify(body)
    });
    if(res.status===401&&retry){
      s=await refreshSession();
      return restRequest(path,{method,body,prefer,retry:false});
    }
    return parseResponse(res);
  }

  function enc(v){return encodeURIComponent(String(v))}

  async function functionRequest(slug,body,{token}={}){
    checkConfig();
    const headers={
      'apikey':cfg.publishableKey,
      'Content-Type':'application/json',
      ...(token?{'Authorization':`Bearer ${token}`}:{})
    };
    const res=await fetch(`${cfg.url}/functions/v1/${slug}`,{
      method:'POST',headers,body:JSON.stringify(body||{})
    });
    return parseResponse(res);
  }

  async function fetchProfile(userId){
    const rows=await restRequest(`profiles?select=user_id,name,username,role,active,must_change_password&user_id=eq.${enc(userId)}`);
    return Array.isArray(rows)?rows[0]:null;
  }

  async function refreshDirectory(){
    if(!cloud.ready)return;
    try{
      const u=current();
      if(typeof window.isLeader==='function'&&window.isLeader()){
        cloud.profiles=(await restRequest('profiles?select=user_id,name,username,role,active,must_change_password,created_at&order=name.asc'))||[];
      }else cloud.profiles=u?[{user_id:u.id,name:u.name,role:u.role,active:true}]:[];

      if(typeof window.isAdmin==='function'&&window.isAdmin()){
        cloud.invites=(await restRequest('invites?select=email,name,role,active,created_at&order=created_at.desc'))||[];
      }else cloud.invites=[];

      if(typeof window.renderAccess==='function')window.renderAccess();
    }catch(e){console.error('refreshDirectory',e)}
  }

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

  async function syncNow(force=false){
    if(!cloud.ready||cloud.applying||!cloud._userId)return;
    const all=state(),desired=new Map(),upserts=[];

    for(const [type,arr] of Object.entries(all)){
      for(const item of (arr||[])){
        const id=String(item.id||''); if(!id)continue;
        const payload=(type==='closures'||type==='presentation')?{payload:item.payload}:item;
        desired.set(key(type,id),serialize(payload));
        if(force||cloud.cache.get(key(type,id))!==serialize(payload)){
          upserts.push({
            workspace,entity_type:type,entity_id:id,payload,
            updated_by:cloud._userId,updated_at:new Date().toISOString()
          });
        }
      }
    }

    if(upserts.length){
      await restRequest(
        'entities?on_conflict=workspace%2Centity_type%2Centity_id',
        {method:'POST',body:upserts,prefer:'resolution=merge-duplicates,return=minimal'}
      );
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
      await restRequest(
        `entities?workspace=eq.${enc(workspace)}&entity_type=eq.${enc(t)}&entity_id=eq.${enc(id)}`,
        {method:'DELETE',prefer:'return=minimal'}
      );
      cacheDelete(t,id);
    }
  }

  async function loadAll(){
    const local=state();
    const data=(await restRequest(
      `entities?select=entity_type,entity_id,payload,updated_at&workspace=eq.${enc(workspace)}`
    ))||[];

    if(!data.length){
      if(typeof window.isAdmin==='function'&&window.isAdmin()){
        await syncNow(true);
        notice('Base online inicializada com os dados deste aparelho.');
      }
      return;
    }

    cloud.applying=true;
    try{
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

      const groups={
        team:seen.has('team')?temp.team:(local.team||[]),
        vehicles:seen.has('vehicles')?temp.vehicles:(local.vehicles||[]),
        treatments:seen.has('treatments')?temp.treatments:(local.treatments||[]),
        catalog:seen.has('catalog')?temp.catalog:(local.catalog||[]),
        suggestions:seen.has('suggestions')?temp.suggestions:(local.suggestions||[]),
        closures:seen.has('closures')?temp.closures:Object.fromEntries((local.closures||[]).map(x=>[x.id,x.payload])),
        presentation:seen.has('presentation')?temp.presentation:((local.presentation||[])[0]?.payload||null)
      };

      if(window.__oficinaCloudApplyState)window.__oficinaCloudApplyState(groups);
      persistLocalOnly(false);
      if(typeof window.renderAll==='function')window.renderAll();

      const missing=['team','vehicles','treatments','catalog','suggestions','closures','presentation'].filter(t=>!seen.has(t));
      if(missing.length&&typeof window.isAdmin==='function'&&window.isAdmin())await syncNow(true);
    }finally{
      cloud.applying=false;
    }
  }

  function queueSync(){
    if(!cloud.ready||cloud.applying)return;
    clearTimeout(cloud.syncTimer);
    cloud.syncTimer=setTimeout(()=>syncNow(false).catch(e=>{
      console.error('syncNow',e);
      notice('Alteração salva neste aparelho; sincronização online pendente.');
    }),500);
  }

  async function loadProfile(user){
    const p=await fetchProfile(user.id);
    if(!p?.active)throw new Error('Seu acesso ainda não foi liberado pelo administrador.');
    cloud._userId=user.id;
    setCurrent({id:user.id,name:p.name,username:p.username||'',role:p.role,email:user.email,mustChangePassword:!!p.must_change_password});
    cloud.ready=true;
    if(typeof window.applyAccessUI==='function')window.applyAccessUI();
    await loadAll();
    await refreshDirectory();
    startPolling();
    const first=[...document.querySelectorAll('.tab')].find(b=>!b.classList.contains('hidden'));
    if(first&&!document.querySelector('.tab.active:not(.hidden)')&&typeof window.switchTab==='function'){
      window.switchTab(first.dataset.tab);
    }
  }

  async function getAuthUser(){
    const s=await ensureSession();
    const user=await authRequest('/user',{method:'GET',token:s.access_token});
    return user;
  }

  async function login(){
    const username=(document.querySelector('#loginUserName')?.value||document.querySelector('#loginEmail')?.value||'').trim();
    const password=document.querySelector('#loginPassword')?.value||'';
    if(!username||!password){notice('Informe usuário e senha.');return}

    try{
      const session=await functionRequest('login-username',{username,password});
      saveSession(session);
      await loadProfile(session.user);
      if(dialog()?.open)dialog().close();
      notice(`Acesso liberado: ${current()?.name||''}`);
    }catch(e){
      console.error('login',e);
      notice(e.message||'Usuário ou senha inválidos.');
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
      const meta={name};
      if(adminMode)meta.bootstrap_code=bootstrap;
      const result=await authRequest('/signup',{body:{email,password,data:meta}});
      if(result?.access_token&&result?.user){
        saveSession(result);
        await loadProfile(result.user);
        if(dialog()?.open)dialog().close();
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
    try{
      const s=cloud.session||loadSession();
      if(s?.access_token)await authRequest('/logout',{method:'POST',token:s.access_token});
    }catch(e){console.warn('logout',e)}
    stopPolling();
    saveSession(null);
    cloud.ready=false;cloud._userId=null;setCurrent(null);
    if(typeof window.applyAccessUI==='function')window.applyAccessUI();
    if(dialog()&&!dialog().open)dialog().showModal();
  }

  async function restore(){
    try{
      loadSession();
      if(!cloud.session){
        setCurrent(null);
        if(typeof window.applyAccessUI==='function')window.applyAccessUI();
        if(dialog()&&!dialog().open)dialog().showModal();
        return;
      }
      const user=await getAuthUser();
      await loadProfile(user);
      if(dialog()?.open)dialog().close();
    }catch(e){
      console.warn('restore',e);
      saveSession(null);
      setCurrent(null);
      if(typeof window.applyAccessUI==='function')window.applyAccessUI();
      if(dialog()&&!dialog().open)dialog().showModal();
    }
  }

  function startPolling(){
    stopPolling();
    cloud.pollTimer=setInterval(()=>{
      if(cloud.ready&&!cloud.applying){
        loadAll().catch(e=>console.warn('poll',e));
      }
    },12000);
  }
  function stopPolling(){if(cloud.pollTimer){clearInterval(cloud.pollTimer);cloud.pollTimer=null}}

  async function createUser(){
    if(!cloud.ready||!window.isAdmin?.()){notice('Apenas o administrador pode criar usuários.');return}
    const name=document.querySelector('#newUserName')?.value.trim();
    const username=document.querySelector('#newUserLogin')?.value.trim().toLowerCase();
    const password=document.querySelector('#newUserPassword')?.value||'';
    const role=document.querySelector('#newUserRole')?.value;
    if(!name||!username||password.length<8||!role){notice('Preencha nome, usuário, função e senha temporária com no mínimo 8 caracteres.');return}
    try{
      const s=await ensureSession();
      await functionRequest('admin-user',{action:'create',name,username,password,role},{token:s.access_token});
      document.querySelector('#newUserName').value='';
      document.querySelector('#newUserLogin').value='';
      document.querySelector('#newUserPassword').value='';
      await refreshDirectory();
      notice(`Usuário ${username} criado com sucesso.`);
    }catch(e){
      console.error('createUser',e);notice(e.message||'Não foi possível criar o usuário.');
    }
  }

  async function resetPassword(userId,name){
    if(!cloud.ready||!window.isAdmin?.())return;
    const password=prompt(`Nova senha temporária para ${name||'o usuário'} (mínimo 8 caracteres):`);
    if(password===null)return;
    if(password.length<8){notice('A senha precisa ter no mínimo 8 caracteres.');return}
    try{
      const s=await ensureSession();
      await functionRequest('admin-user',{action:'reset_password',user_id:userId,password},{token:s.access_token});
      await refreshDirectory();
      notice('Senha temporária atualizada.');
    }catch(e){console.error(e);notice(e.message||'Não foi possível redefinir a senha.');}
  }

  async function setProfileActive(userId,active){
    if(!window.isAdmin?.())return;
    try{
      await restRequest(`profiles?user_id=eq.${enc(userId)}`,{
        method:'PATCH',
        body:{active,updated_at:new Date().toISOString()},
        prefer:'return=minimal'
      });
      await refreshDirectory();
    }catch(e){notice(e.message||'Não foi possível alterar o usuário.')}
  }

  async function setProfileRole(userId,role){
    if(!window.isAdmin?.())return;
    try{
      await restRequest(`profiles?user_id=eq.${enc(userId)}`,{
        method:'PATCH',
        body:{role,updated_at:new Date().toISOString()},
        prefer:'return=minimal'
      });
      await refreshDirectory();
    }catch(e){notice(e.message||'Não foi possível alterar a função.')}
  }

  function init(){
    try{
      checkConfig();
      cloud.connectionError=null;
    }catch(e){
      cloud.connectionError=e;
      console.error('Supabase config',e);
      notice(e.message);
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
  cloud.createUser=createUser;
  cloud.resetPassword=resetPassword;
  cloud.setProfileActive=setProfileActive;
  cloud.setProfileRole=setProfileRole;
  window.oficinaCloud=cloud;
})();