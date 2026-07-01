/* ===== The Living Edit — optional cloud sync (Supabase) =====
 * Backs up the local state object S to a per-user row, protected by RLS.
 * Everything degrades gracefully: no connection / not signed in = app works
 * exactly as before, purely on-device.
 */
(function(){
  var SUPA_URL = "https://ikbshdfcjqgfyorkpkob.supabase.co";
  var SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrYnNoZGZjanFnZnlvcmtwa29iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NjYxNjYsImV4cCI6MjA5ODQ0MjE2Nn0.V8H4mHT9R9MaKbpmlvJETSKBFB4e34xKpcjEzZiRkQw";

  var sbc = null;
  try{
    if(window.supabase && window.supabase.createClient){
      sbc = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
        auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
      });
    }
  }catch(e){ sbc = null; }
  window.__cloudReady = false;

  function cloudUser(){
    return new Promise(function(res){
      if(!sbc){ res(null); return; }
      sbc.auth.getSession().then(function(r){ res((r.data && r.data.session) ? r.data.session.user : null); }).catch(function(){ res(null); });
    });
  }
  function cloudPull(){
    return cloudUser().then(function(u){
      if(!u || !sbc) return null;
      return sbc.from("user_state").select("data").eq("id", u.id).maybeSingle()
        .then(function(r){ return (r && r.data) ? r.data.data : null; })
        .catch(function(){ return null; });
    });
  }
  function cloudPush(){
    return cloudUser().then(function(u){
      if(!u || !sbc) return;
      return sbc.from("user_state").upsert({ id:u.id, data:S, updated_at:new Date().toISOString() }).catch(function(){});
    });
  }
  /* Merge remote state INTO local, without losing anything the user has here. */
  function cloudMerge(remote){
    if(!remote || typeof remote!=="object") return;
    try{
      var localSaved  = Array.isArray(S.savedFacts) ? S.savedFacts : [];
      var remoteSaved = Array.isArray(remote.savedFacts) ? remote.savedFacts : [];
      var byId = {};
      remoteSaved.concat(localSaved).forEach(function(x){ if(x && x.id) byId[x.id] = x; });
      S.savedFacts = Object.keys(byId).map(function(k){ return byId[k]; })
                       .sort(function(a,b){ return (a.ts||0) - (b.ts||0); });

      ["name","bday","theme"].forEach(function(k){
        if((S[k]===undefined || S[k]==="" || S[k]===null) && remote[k]!==undefined && remote[k]!=="") S[k] = remote[k];
      });
      var li = Array.isArray(S.interests) ? S.interests.slice() : [];
      (Array.isArray(remote.interests) ? remote.interests : []).forEach(function(x){ if(li.indexOf(x)<0) li.push(x); });
      if(li.length) S.interests = li;

      S.onboarded = S.onboarded || remote.onboarded;
      if(remote.unlocked) S.unlocked = true;
    }catch(e){}
  }
  function cloudSync(){
    return cloudUser().then(function(u){
      if(!u) return;
      return cloudPull().then(function(remote){
        cloudMerge(remote);
        try{ save(); }catch(e){}
        return cloudPush();
      });
    });
  }

  /* Debounced background push whenever local state changes. */
  var pushTimer = null;
  function cloudSchedulePush(){
    if(!window.__cloudReady) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function(){ cloudPush(); }, 1500);
  }
  /* Wrap the app's save() so on-device saves also flow to the cloud. */
  if(typeof save === "function"){
    var _origSave = save;
    save = function(){ _origSave.apply(this, arguments); cloudSchedulePush(); };
    try{ window.save = save; }catch(e){}
  }

  /* ---- Auth actions: email → 6-digit code → verify ---- */
  var pendingEmail = "";

  window.cloudSendCode = function(email){
    if(!sbc){ if(typeof toast==="function") toast("Sync isn't available offline"); return; }
    email = (email||"").trim();
    if(!email || email.indexOf("@")<1){ if(typeof toast==="function") toast("Enter a valid email"); return; }
    if(typeof toast==="function") toast("Sending code…");
    sbc.auth.signInWithOtp({ email:email, options:{ shouldCreateUser:true } })
      .then(function(r){
        if(r.error){ if(typeof toast==="function") toast("Error: "+(r.error.message||r.error.status||"unknown")); }
        else { pendingEmail = email; showCodeStep(); }
      });
  };

  window.cloudVerifyCode = function(token){
    if(!sbc) return;
    token = (token||"").replace(/\s/g,"");
    if(token.length<6){ if(typeof toast==="function") toast("Enter the 6-digit code"); return; }
    if(typeof toast==="function") toast("Checking…");
    sbc.auth.verifyOtp({ email:pendingEmail, token:token, type:"email" })
      .then(function(r){
        if(r.error){ if(typeof toast==="function") toast("Wrong or expired code — try again"); }
        else { if(typeof closeAppSheet==="function") closeAppSheet(); /* onAuthStateChange handles the sync + toast */ }
      });
  };

  function showCodeStep(){
    if(typeof openAppSheet!=="function") return;
    openAppSheet(
      '<h2 class="serif" style="font-size:24px;margin:0 0 6px">Enter your code</h2>'+
      '<div class="muted ital" style="margin-bottom:14px">We emailed a sign-in code to <b>'+esc(pendingEmail)+'</b>. Enter it below.</div>'+
      '<div class="inrow" style="margin:4px 0 4px"><input id="cloudCode" class="grow" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="Enter code" aria-label="Sign-in code" style="background:#FCF9F1;border:1px solid var(--line);border-radius:9px;padding:9px 11px;letter-spacing:4px;font-size:18px;text-align:center"><button class="btn sm" onclick="cloudVerifyCode(document.getElementById(\'cloudCode\').value)">Verify</button></div>'+
      '<div class="muted ital" style="font-size:12px;margin-top:10px">Didn’t get it? Check spam, or <a href="#" onclick="cloudSendCode(\''+esc(pendingEmail).replace(/'/g,"\\'")+'\');return false;" style="color:var(--gold)">send a new code</a>.</div>'
    );
    setTimeout(function(){ var el=document.getElementById("cloudCode"); if(el) el.focus(); }, 120);
  }
  window.cloudSignOut = function(){
    if(!sbc) return;
    sbc.auth.signOut().then(function(){
      window.__cloudReady = false;
      if(typeof toast==="function") toast("Signed out");
      if(typeof closeAppSheet==="function") closeAppSheet();
    });
  };
  window.cloudSync = cloudSync;

  /* ---- Account sheet in Settings ---- */
  window.openAccount = function(){
    if(typeof openAppSheet!=="function") return;
    if(!sbc){
      openAppSheet('<h2 class="serif" style="font-size:24px;margin:0 0 8px">Sync</h2>'+
        '<div class="muted ital">Cloud sync isn’t available right now. Your data is safe on this device.</div>');
      return;
    }
    cloudUser().then(function(u){
      var html;
      if(u){
        html='<h2 class="serif" style="font-size:24px;margin:0 0 6px">Your account</h2>'+
          '<div class="muted" style="margin-bottom:14px">Signed in as <b>'+esc(u.email||"")+'</b>. Your saved facts and preferences sync automatically across your devices.</div>'+
          '<div class="inrow" style="flex-direction:column;gap:9px;align-items:stretch">'+
            '<button class="btn ghost" onclick="cloudSync().then(function(){if(typeof toast===\'function\')toast(\'Synced ✦\');})">Sync now</button>'+
            '<button class="btn ghost" onclick="cloudSignOut()">Sign out</button>'+
          '</div>';
      } else {
        html='<h2 class="serif" style="font-size:24px;margin:0 0 6px">Sync across devices</h2>'+
          '<div class="muted ital" style="margin-bottom:14px">Sign in to back up your saved facts and settings and get them on any device. No password — we email you a one-time code.</div>'+
          '<div class="inrow" style="margin:4px 0 4px"><input id="cloudEmail" class="grow" type="email" autocomplete="email" placeholder="you@example.com" aria-label="Email address" style="background:#FCF9F1;border:1px solid var(--line);border-radius:9px;padding:9px 11px"><button class="btn sm" onclick="cloudSendCode(document.getElementById(\'cloudEmail\').value)">Send code</button></div>'+
          '<div class="muted ital" style="font-size:12px;margin-top:8px">Your data stays private to you.</div>';
      }
      openAppSheet(html);
    });
  };

  /* ---- React to auth changes (incl. magic-link return + page load) ---- */
  if(sbc){
    sbc.auth.onAuthStateChange(function(ev, session){
      window.__cloudReady = !!session;
      if((ev==="SIGNED_IN" || ev==="INITIAL_SESSION") && session){
        cloudSync().then(function(){
          if(ev==="SIGNED_IN" && typeof toast==="function") toast("Synced ✦");
          try{ if(typeof tab!=="undefined" && typeof setTab==="function") setTab(tab); }catch(e){}
        });
      }
    });
  }
})();
