try {
(function () {
  if (window.__ZCLONE__) {
    window.__ZCLONE__.toggle();
    return;
  }
  var API = "https://api.zeta-ai.io";
  var GAP = 800;
  var UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  var AUTH = {};
  var CRED = "include";
  var lastCall = 0;
  var busy = false;
  var needList = false;
  var statusEl = null;
  var logEl = null;
  var listEl = null;
  var box = null;
  var pill = null;
  var origFetch = window.fetch.bind(window);
  var SKIPH = ["content-type", "accept", "content-length"];

  function keep(k, v) {
    k = String(k).toLowerCase();
    if (SKIPH.indexOf(k) > -1) return;
    AUTH[k] = String(v);
    if (needList && !busy) {
      needList = false;
      setTimeout(function () { refresh(); }, 400);
    }
  }
  function grab(h) {
    try {
      if (!h) return;
      if (Array.isArray(h)) {
        h.forEach(function (p) { keep(p[0], p[1]); });
      } else if (typeof h.forEach === "function") {
        h.forEach(function (v, k) { keep(k, v); });
      } else {
        Object.keys(h).forEach(function (k) { keep(k, h[k]); });
      }
    } catch (e) {}
  }
  window.fetch = function (input, init) {
    try {
      var u = typeof input === "string" ? input : (input && (input.url || input.href)) || "";
      if (u.indexOf("api.zeta-ai.io") > -1) {
        if (input && typeof input === "object" && input.headers) grab(input.headers);
        if (init && init.headers) grab(init.headers);
      }
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };
  var XOP = XMLHttpRequest.prototype.open;
  var XSH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__zu = String(u);
    return XOP.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try {
      if (this.__zu && this.__zu.indexOf("api.zeta-ai.io") > -1) keep(k, v);
    } catch (e) {}
    return XSH.apply(this, arguments);
  };

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  function trunc(s, n) {
    s = s == null ? "" : String(s);
    return s.length > n ? s.slice(0, n) + "..." : s;
  }
  function bare(u) {
    return u ? String(u).split("?")[0] : u;
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }
  function log(msg) {
    if (!logEl) return;
    logEl.textContent += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }
  function say(msg) {
    if (statusEl) statusEl.textContent = msg;
  }
  function poke() {
    try {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    } catch (e) {}
  }
  function scanTokens() {
    var found = [];
    function add(s) {
      var m = String(s).match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g);
      if (m) m.forEach(function (t) { if (found.indexOf(t) < 0) found.push(t); });
    }
    try {
      for (var i = 0; i < localStorage.length; i++) add(localStorage.getItem(localStorage.key(i)));
    } catch (e) {}
    try {
      for (var j = 0; j < sessionStorage.length; j++) add(sessionStorage.getItem(sessionStorage.key(j)));
    } catch (e2) {}
    try { add(decodeURIComponent(document.cookie)); } catch (e3) {}
    return found;
  }
  async function probeAuth() {
    var toks = scanTokens();
    for (var i = 0; i < toks.length && i < 6; i++) {
      AUTH.authorization = "Bearer " + toks[i];
      try {
        await api("GET", "/v1/coin/balance");
        return true;
      } catch (e) {
        delete AUTH.authorization;
      }
    }
    return false;
  }

  async function api(method, path, body, form) {
    var url = path.indexOf("http") === 0 ? path : API + path;
    var flipped = false;
    for (var attempt = 0; attempt < 7; attempt++) {
      var wait = lastCall + GAP - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      var headers = {};
      Object.keys(AUTH).forEach(function (k) { headers[k] = AUTH[k]; });
      var init = { method: method, headers: headers, credentials: CRED };
      if (body !== undefined && body !== null) {
        if (form) {
          init.body = body;
        } else {
          init.body = JSON.stringify(body);
          headers["content-type"] = "application/json";
        }
      }
      var res;
      try {
        res = await origFetch(url, init);
      } catch (e) {
        if (!flipped) {
          flipped = true;
          CRED = CRED === "include" ? "omit" : "include";
          continue;
        }
        throw e;
      }
      if (res.status === 429) {
        log("요청이 몰려 잠시 대기 중... (" + (attempt + 1) + ")");
        await sleep(2500 * (attempt + 1));
        continue;
      }
      var text = await res.text();
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e2) { data = text; }
      if (!res.ok) {
        var err = new Error(method + " " + path + " -> " + res.status + " " + trunc(text, 300));
        err.status = res.status;
        throw err;
      }
      return data;
    }
    throw new Error(method + " " + path + " -> 429 반복");
  }

  async function getBlob(url) {
    var res = await origFetch(url);
    if (!res.ok) throw new Error("이미지 " + res.status);
    return await res.blob();
  }
  async function dims(blob) {
    if (window.createImageBitmap) {
      var bmp = await window.createImageBitmap(blob);
      var d = { w: bmp.width, h: bmp.height };
      if (bmp.close) bmp.close();
      return d;
    }
    return await new Promise(function (resolve, reject) {
      var img = new Image();
      var u = URL.createObjectURL(blob);
      img.onload = function () {
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
        URL.revokeObjectURL(u);
      };
      img.onerror = function () { reject(new Error("이미지 해석 실패")); };
      img.src = u;
    });
  }
  async function upChar(plotId, charId, url) {
    var blob = await getBlob(url);
    var d = await dims(blob);
    var fd = new FormData();
    fd.append("images", blob, "blob");
    fd.append("widths", String(d.w));
    fd.append("heights", String(d.h));
    fd.append("aspectRatios", String(d.w / d.h));
    var r = await api("POST", "/v2/plots/" + plotId + "/characters/" + charId + "/images", fd, true);
    var it = r && r.results && r.results[0];
    if (!it || it.type !== "Success") throw new Error("캐릭터 이미지 업로드 실패");
    return it.imageUrl;
  }
  async function upProf(plotId, cpId, url) {
    var blob = await getBlob(url);
    var d = await dims(blob);
    var fd = new FormData();
    fd.append("image", blob, "blob");
    fd.append("width", String(d.w));
    fd.append("height", String(d.h));
    fd.append("aspectRatio", String(d.w / d.h));
    var r = await api("PUT", "/v2/plots/" + plotId + "/chat-profiles/" + cpId + "/images", fd, true);
    if (!r || !r.imageUrl) throw new Error("프로필 이미지 업로드 실패");
    return r.imageUrl;
  }

  function localePrefix() {
    var seg = location.pathname.split("/")[1];
    return "/" + (seg && seg.length === 2 ? seg : "ko");
  }
  async function createPlot() {
    var res = await origFetch(localePrefix() + "/plots/create", { credentials: "include", redirect: "follow" });
    var re = new RegExp("plots/(" + UUID_RE + ")/edit");
    var m = re.exec(res.url || "");
    if (m) return m[1];
    var html = await res.text();
    m = re.exec(html);
    return m ? m[1] : null;
  }

  function copyObj(o) {
    var n = {};
    Object.keys(o).forEach(function (k) { n[k] = o[k]; });
    return n;
  }

  async function run(srcId, targetId) {
    if (busy) {
      log("이미 진행 중이에요.");
      return;
    }
    busy = true;
    logEl.textContent = "";
    var nid = targetId || null;
    try {
      say("복제 중... 화면을 닫지 마세요");
      log("원본 읽는 중...");
      var src = await api("GET", "/v1/plots/" + srcId + "/creator");
      var D = src.draft || src;
      var pick = function (k) { return D[k] != null ? D[k] : src[k]; };
      if (src.mode && src.mode !== "STORY_CHAT") throw new Error("스토리챗 플롯만 복제할 수 있어요 (" + src.mode + ")");
      var srcChars = D.characters || [];
      if (!srcChars.length) throw new Error("원본에 캐릭터가 없어요");
      var rel = false;
      if (src.status === "RELEASE") {
        rel = confirm("원본이 등록된 플롯이에요.\n복제본도 등록까지 할까요?\n(취소 = 미등록 상태로 두기)");
      }

      if (!nid) {
        log("새 플롯 만드는 중...");
        nid = await createPlot();
        if (!nid) throw new Error("새 플롯을 자동으로 만들지 못했어요. + 버튼으로 빈 플롯을 직접 만들고, 그 편집 화면에서 다시 실행해 주세요.");
      }
      if (nid === srcId) throw new Error("원본과 같은 플롯이에요");
      var tgt = await api("GET", "/v1/plots/" + nid + "/creator");
      var TD = tgt.draft || tgt;
      var tchars = TD.characters || [];
      if (TD.name || TD.longDescription || tchars.length > 1 || (tchars[0] && tchars[0].name)) {
        throw new Error("대상 플롯이 비어 있지 않아서 중단했어요");
      }
      var blank = tchars[0] && tchars[0].id;

      var idMap = {};
      var chars = srcChars.map(function (sc, i) {
        var nidc = i === 0 && blank ? blank : uuid();
        idMap[sc.id] = nidc;
        return { sid: sc.id, nid: nidc, name: sc.name, description: sc.description, imageUrl: null, srcImage: sc.imageUrl };
      });
      var profs = (D.chatProfiles || []).map(function (sp) {
        return { sid: sp.id, nid: uuid(), name: sp.name, summary: sp.summary, description: sp.description, isUsingDefaultName: !!sp.isUsingDefaultName, imageUrl: null, srcImage: sp.imageUrl };
      });
      var lorebookIds = D.lorebookIds || (src.lorebooks || []).map(function (l) { return l.id; });
      var name = pick("name") || "";
      var longDescription = pick("longDescription") || "";
      var narrator = pick("narrator") || "";

      log("기본 내용 저장 중...");
      await api("PATCH", "/v1/plots/" + nid, {
        name: name,
        longDescription: longDescription,
        narrator: narrator,
        characters: chars.map(function (c) { return { id: c.nid, name: c.name, description: c.description }; }),
        chatProfiles: profs.map(function (p) { return { id: p.nid, isUsingDefaultName: p.isUsingDefaultName }; }),
        lorebookIds: lorebookIds
      });

      for (var i = 0; i < chars.length; i++) {
        var c = chars[i];
        var list = [];
        try {
          var lr = await api("GET", "/v2/plots/" + srcId + "/characters/" + c.sid + "/images/creator");
          list = (lr && lr.images) || [];
        } catch (e) {
          log(c.name + " 이미지 목록을 못 읽었어요");
        }
        for (var j = 0; j < list.length; j++) {
          try {
            log(c.name + " 이미지 올리는 중 (" + (j + 1) + "/" + list.length + ")");
            var up = await upChar(nid, c.nid, list[j].imageUrl);
            if (j === 0) c.imageUrl = up;
          } catch (e2) {
            log("이미지 업로드 실패: " + trunc(e2.message, 100) + (j === 0 ? " (원본 이미지를 참조로 연결)" : ""));
            if (j === 0) c.imageUrl = bare(list[j].imageUrl);
          }
        }
        if (!c.imageUrl && c.srcImage) {
          c.imageUrl = bare(c.srcImage);
          log(c.name + " 이미지는 원본을 참조로 연결했어요");
        }
      }

      for (var k = 0; k < profs.length; k++) {
        var p = profs[k];
        var purl = null;
        try {
          var pr = await api("GET", "/v2/plots/" + srcId + "/chat-profiles/" + p.sid + "/images/original");
          purl = pr && pr.imageUrl;
        } catch (e3) {
          if (e3.status !== 404) log("프로필 이미지를 못 읽었어요");
        }
        if (purl) {
          try {
            log("프로필 이미지 올리는 중");
            p.imageUrl = await upProf(nid, p.nid, purl);
          } catch (e4) {
            log("프로필 이미지 업로드 실패: " + trunc(e4.message, 100) + " (참조로 연결)");
            p.imageUrl = bare(purl);
          }
        } else if (p.srcImage) {
          p.imageUrl = bare(p.srcImage);
        }
      }

      var intros = (D.intros || []).map(function (it) {
        var conv = it.conversation || {};
        var msgs = (conv.messages || []).map(function (m) {
          var n = copyObj(m);
          if (n.senderId && idMap[n.senderId]) n.senderId = idMap[n.senderId];
          n.tempId = Date.now() + "-" + Math.random();
          return n;
        });
        return {
          conversation: { messages: msgs, cyoaChoices: conv.cyoaChoices || null },
          publicConversationMessageCount: it.publicConversationMessageCount,
          playerCharacterSelectionIndex: it.playerCharacterSelectionIndex,
          backgroundAudioUrl: it.backgroundAudioUrl || null,
          backgroundAudioDurationSeconds: it.backgroundAudioDurationSeconds || null
        };
      });
      var aboutSrc = D.about || null;
      var about = {
        characters: aboutSrc && aboutSrc.characters && aboutSrc.characters.length
          ? aboutSrc.characters.map(function (ac) {
              return { characterId: idMap[ac.characterId] || ac.characterId, name: ac.name, description: ac.description };
            })
          : chars.map(function (c2) { return { characterId: c2.nid, name: c2.name, description: null }; }),
        contents: aboutSrc && aboutSrc.contents && aboutSrc.contents.length ? aboutSrc.contents : [{ type: "text", content: "" }]
      };

      log("비공개 설정 적용 중...");
      await api("PATCH", "/v1/plots/" + nid + "/private", { isPrivate: src.isPrivate === true });

      log("전체 설정 저장 중...");
      await api("PUT", "/v1/plots/" + nid, {
        plotId: nid,
        chatProfiles: profs.map(function (p2) {
          return { id: p2.nid, name: p2.name, imageUrl: bare(p2.imageUrl), summary: p2.summary, description: p2.description, isUsingDefaultName: p2.isUsingDefaultName };
        }),
        imageUrl: null,
        shortDescription: pick("shortDescription") || "",
        hashtags: [],
        isAboutPublic: !!pick("isAboutPublic"),
        about: about,
        isCreatorCommentPublic: !!pick("isCreatorCommentPublic"),
        creatorComment: pick("creatorComment") || "",
        isExampleConversationPublic: !!pick("isExampleConversationPublic"),
        lorebookIds: lorebookIds,
        stylePreset: D.stylePreset != null ? D.stylePreset : (src.stylePreset || null),
        infoBoxSetting: D.infoBoxSetting != null ? D.infoBoxSetting : (src.infoBoxSetting || null),
        cyoaSetting: D.cyoaSetting != null ? D.cyoaSetting : (src.cyoaSetting || null),
        plugins: D.plugins != null ? D.plugins : (src.plugins || null),
        name: name,
        longDescription: longDescription,
        narrator: narrator,
        characters: chars.map(function (c3) {
          return { id: c3.nid, imageUrl: bare(c3.imageUrl), name: c3.name, description: c3.description };
        }),
        intros: intros,
        exampleConversations: D.exampleConversation || D.exampleConversations || []
      });

      try {
        var cs = await api("GET", "/v1/creator/plots/" + srcId + "/comment-setting");
        if (cs && cs.windowStatus) {
          await api("PATCH", "/v1/creator/plots/" + nid + "/comment-setting", { status: cs.windowStatus });
        }
      } catch (e5) {
        log("댓글 설정은 복사하지 못했어요");
      }

      if (rel) {
        log("등록 중...");
        await api("PATCH", "/v1/plots/" + nid + "/status", { status: "RELEASE" });
      }

      try {
        var pi = await api("GET", "/v2/plots/" + srcId + "/images/creator");
        if (pi && pi.images && pi.images.length) log("플롯 이미지 " + pi.images.length + "장은 복사되지 않았어요");
      } catch (e6) {}
      if (D.imageUrl || D.initialRoomImageUrl) log("플롯 커버 이미지는 복사되지 않았어요");

      log("완료!");
      say("복제 완료! 새로고침하면 목록에 나와요");
      addOpenButton(nid);
    } catch (e7) {
      log("실패: " + e7.message);
      say("복제에 실패했어요. 아래 로그를 확인하세요");
      if (nid) {
        log("만들다 만 플롯이 있어요: " + nid);
        addOpenButton(nid);
      }
    }
    busy = false;
  }

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }
  function btnCss(bg) {
    return "display:block;width:100%;text-align:left;margin:0 0 5px;padding:9px 11px;font-size:13px;background:" + bg + ";color:white;border:1px solid rgb(120,95,190);border-radius:8px;";
  }
  function addOpenButton(id) {
    if (!listEl) return;
    var b = el("button", btnCss("rgb(100,70,180)"), "새 플롯 편집 화면 열기");
    b.onclick = function () {
      location.href = localePrefix() + "/plots/" + id + "/edit";
    };
    listEl.insertBefore(b, listEl.firstChild);
  }

  async function loadList() {
    var seen = {};
    var out = [];
    var combos = [["true", "RELEASE"], ["false", "RELEASE"], ["true", "PRERELEASE"], ["false", "PRERELEASE"]];
    for (var i = 0; i < combos.length; i++) {
      var cursor = null;
      for (var pg = 0; pg < 8; pg++) {
        var q = "/v1/plots/creator?limit=15&isPrivate=" + combos[i][0] + "&orderBy.property=UPDATED_AT&orderBy.direction=DESC&status=" + combos[i][1] + "&modes=STORY_CHAT" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
        var r = null;
        try {
          r = await api("GET", q);
        } catch (e) {
          if (e.status === 401 || e.status === 403) return { items: out, authFail: true };
          break;
        }
        var arr = (r && r.plots) || [];
        var added = 0;
        arr.forEach(function (p) {
          var id = p.id || p.plotId;
          if (id && !seen[id]) {
            seen[id] = 1;
            out.push({ id: id, name: p.name || (p.draft && p.draft.name) || "(제목 없음)", st: combos[i][1], pv: combos[i][0] });
            added++;
          }
        });
        if (!r || !r.nextCursor || !added) break;
        cursor = r.nextCursor;
      }
    }
    return { items: out, authFail: false };
  }

  function currentEditId() {
    var m = new RegExp("plots/(" + UUID_RE + ")/edit").exec(location.pathname);
    return m ? m[1] : null;
  }

  function start(srcId, label) {
    if (busy) return;
    if (!confirm("'" + label + "' 을(를) 복제할까요?")) return;
    var target = null;
    var cur = currentEditId();
    if (cur && cur !== srcId) {
      if (confirm("지금 열려 있는 빈 플롯에 붙여넣을까요?\n확인 = 지금 플롯에 붙여넣기\n취소 = 새 플롯 만들기")) target = cur;
    }
    run(srcId, target);
  }

  function renderList(items) {
    listEl.textContent = "";
    if (!items.length) return;
    items.forEach(function (it) {
      var tag = (it.pv === "true" ? "비공개" : "공개") + " · " + (it.st === "RELEASE" ? "등록" : "미등록");
      var b = el("button", btnCss("rgb(50,42,80)"), it.name + "  (" + tag + ")");
      b.onclick = function () { start(it.id, it.name); };
      listEl.appendChild(b);
    });
  }

  async function refresh() {
    if (busy) return;
    say("목록 불러오는 중...");
    var r = await loadList();
    if (r.authFail && !r.items.length) {
      poke();
      await sleep(1500);
      r = await loadList();
    }
    if (r.authFail && !r.items.length) {
      if (await probeAuth()) r = await loadList();
    }
    renderList(r.items);
    if (r.items.length) {
      say("복제할 플롯을 탭하세요");
    } else if (r.authFail) {
      needList = true;
      say("화면의 탭(전체/스토리챗)을 한 번 눌러 주세요");
    } else {
      say("불러올 플롯이 없어요. '직접 입력'을 써 보세요");
    }
  }

  function setOpen(v) {
    box.style.display = v ? "flex" : "none";
    pill.style.display = v ? "none" : "block";
  }

  box = el("div", "position:fixed;left:0;right:0;bottom:0;height:40vh;z-index:2147483647;background:rgb(24,20,38);color:rgb(240,235,255);font:13px/1.4 -apple-system,sans-serif;display:flex;flex-direction:column;border-top:3px solid rgb(155,120,255);");
  var head = el("div", "display:flex;gap:6px;padding:6px 8px;flex:none;align-items:center;");
  head.appendChild(el("b", "flex:1;font-size:14px;", "플롯 복제"));
  function mk(label, fn) {
    var b = el("button", "padding:6px 9px;font-size:12px;background:rgb(60,50,90);color:white;border:1px solid rgb(155,120,255);border-radius:8px;", label);
    b.onclick = fn;
    head.appendChild(b);
  }
  mk("새로고침", function () { refresh(); });
  mk("직접 입력", function () {
    var v = prompt("복제할 플롯의 주소 또는 ID를 붙여넣어 주세요");
    if (!v) return;
    var m = new RegExp(UUID_RE).exec(v);
    if (!m) {
      say("주소에서 플롯 ID를 찾지 못했어요");
      return;
    }
    start(m[0], m[0].slice(0, 8));
  });
  mk("접기", function () { setOpen(false); });
  statusEl = el("div", "padding:0 10px 5px;font-size:12px;color:rgb(200,190,235);flex:none;");
  listEl = el("div", "flex:1;overflow:auto;padding:0 8px;-webkit-overflow-scrolling:touch;");
  logEl = el("div", "height:56px;overflow:auto;padding:4px 10px;background:rgb(10,8,18);font:11px/1.35 monospace;white-space:pre-wrap;word-break:break-all;flex:none;");
  box.appendChild(head);
  box.appendChild(statusEl);
  box.appendChild(listEl);
  box.appendChild(logEl);
  pill = el("button", "position:fixed;right:10px;bottom:96px;z-index:2147483647;padding:8px 12px;font-size:13px;background:rgb(100,70,180);color:white;border:1px solid rgb(200,180,255);border-radius:18px;display:none;", "복제");
  pill.onclick = function () { setOpen(true); };
  document.body.appendChild(box);
  document.body.appendChild(pill);

  window.__ZCLONE__ = {
    toggle: function () { setOpen(box.style.display === "none"); },
    run: run
  };
  refresh();
})();
} catch (err) {
  alert("ZCLONE error: " + (err && err.message ? err.message : err));
}
