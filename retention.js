/* ═══════════════════════════════════════════════════════════
   토론하자 — retention.js  (다시 올 이유: 리텐션 시스템)
   ── 데모용 mock 데이터로 동작하지만, 개인 데이터 로직은
      실제 구현과 동일하게 전부 localStorage 에 저장된다.
      (서버 새 테이블 0 · 익명 유지)
   실제 앱 적용 시 mock 토론을 DB.topics() 로 바꾸면 그대로 이식.
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ── 카테고리 색 ── */
var CAT = {
  정치:'var(--cat-politics)', 축구:'var(--cat-soccer)', 연예:'var(--cat-ent)',
  게임:'var(--cat-game)', 사회:'var(--cat-society)', 경제:'var(--cat-econ)'
};
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function icon(id,s){s=s||16;return '<svg width="'+s+'" height="'+s+'" style="vertical-align:-2px"><use href="#i-'+id+'"/></svg>';}
function fmt(n){return (n>=10000)?(Math.round(n/100)/100)+'만':(n||0).toLocaleString('ko');}

/* ── 영속 상태 (localStorage) ──────────────────────────────
   실제 앱에서 그대로 쓰는 키 구조. 전부 기기 저장 = 서버 0바이트. */
var LS = {
  get:function(k,d){try{var v=localStorage.getItem('thj_r_'+k);return v==null?d:JSON.parse(v);}catch(e){return d;}},
  set:function(k,v){try{localStorage.setItem('thj_r_'+k,JSON.stringify(v));}catch(e){}}
};

/* 데모를 매번 같은 상태로 보여주기 위해 첫 로드시 시드. (실제 앱에선 이 블록 제거) */
if(!LS.get('seeded')){
  LS.set('seeded',1);
  LS.set('streak',6);
  LS.set('lastVisit','2026-06-20');           // 어제 — 오늘 방문하면 7일째
  LS.set('votes',{});                          // {id:'a'|'b'}
  LS.set('predicts',{});                       // {id:'a'|'b'}
  LS.set('atVote',{});                         // {id:{a,b}} 투표 당시 %
  LS.set('predHit',7); LS.set('predTotal',9);  // 예측 적중 7/9
  LS.set('totalVotes',23); LS.set('totalComments',14); LS.set('likesGot',61);
  LS.set('minorityHit',12); LS.set('minorityTotal',23);
  LS.set('lean',{a:46,b:54});                  // 찬성형/반대형 누적
  LS.set('catCount',{정치:9,게임:6,축구:4,사회:3,연예:1});
  LS.set('badges',['first','ten','win3','minority']);  // 이미 획득
  LS.set('todayVoted',false);
}

/* ── 데모 토론 데이터 ── */
var TODAY = {
  id:'d-today', cat:'사회',
  title:'주 4일제, 임금 삭감 없이 전면 도입해야 한다',
  a:'도입해야', b:'시기상조',
  ac:8421, bc:7160, endsIn:'14시간', comments:2034
};

var YESTERDAY = {
  title:'수능, 자격고사로 바꿔야 한다', final_a:62, myPredict:'a', hit:true
};

var HOT = [
  {id:'h1',cat:'축구',title:'손흥민, 토트넘 잔류가 맞다',a:54,voters:4210,hot:true},
  {id:'h2',cat:'게임',title:'확률형 아이템(가챠) 전면 금지해야',a:71,voters:6820,hot:true},
  {id:'h3',cat:'연예',title:'열애설, 본인이 직접 해명할 의무 있다',a:38,voters:2980,hot:false},
  {id:'h4',cat:'경제',title:'기본소득 月 50만원, 도입할 만하다',a:47,voters:5130,hot:false}
];

/* 내 투표함 — 투표 당시 % 와 현재 % 를 비교해 역전/우세/결말을 파생.
   status: live | soon(마감임박) | closed */
var BALLOTS = [
  {id:'b1',cat:'정치',title:'국회의원 정수, 지금보다 늘려야 한다',my:'b',now_a:39,at_a:41,voters:7740,status:'live',endsIn:'2일'},
  {id:'b2',cat:'게임',title:'게임 셧다운제, 다시 도입해야 한다',my:'b',now_a:33,at_a:31,voters:5210,status:'soon',endsIn:'3시간'},
  {id:'b3',cat:'축구',title:'VAR 판정, 지금 방식 유지가 맞다',my:'a',now_a:44,at_a:57,voters:9120,status:'live',endsIn:'1일',flip:true},
  {id:'b4',cat:'사회',title:'대중교통 전면 무료화, 도입해야 한다',my:'a',now_a:58,at_a:52,voters:6340,status:'closed',final_a:61,predict:'a'},
  {id:'b5',cat:'경제',title:'상속세, 폐지하는 게 맞다',my:'b',now_a:55,at_a:49,voters:4870,status:'closed',final_a:57,predict:'a'},
  {id:'b6',cat:'연예',title:'AI 가수, 음원 차트에 올라도 된다',my:'a',now_a:48,at_a:46,voters:3110,status:'live',endsIn:'5일'}
];

/* ── 레벨 정의 ── */
var LEVELS = [
  {n:'토린이',min:0},{n:'관전러',min:5},{n:'입장러',min:15},{n:'열혈 논객',min:30},
  {n:'논쟁의 달인',min:60},{n:'토론왕',min:120}
];
function levelOf(score){
  var lv=0; for(var i=0;i<LEVELS.length;i++){if(score>=LEVELS[i].min)lv=i;}
  var cur=LEVELS[lv], next=LEVELS[lv+1];
  return {idx:lv+1, name:cur.name, cur:cur.min, next:next?next.min:cur.min, isMax:!next};
}

/* ── 배지 정의 ── */
var BADGES = [
  {k:'first',e:'🗳️',n:'첫 한 표'},
  {k:'ten',e:'🔟',n:'10토론 참여'},
  {k:'streak7',e:'🔥',n:'7일 연속'},
  {k:'minority',e:'🦔',n:'소수파 챔피언'},
  {k:'oracle',e:'🎯',n:'예측왕'},
  {k:'win3',e:'🏆',n:'BEST 의견'},
  {k:'allcat',e:'🌐',n:'전 카테고리'},
  {k:'night',e:'🌙',n:'심야 토론러'}
];
var BADGE_DESC = {
  streak7:'7일 연속 오늘의 토론에 참여했어요. 습관이 됐네요.',
  oracle:'예측 적중률 80% 돌파! 판세를 읽는 눈이 있어요.'
};

/* ════════ 렌더 ════════ */

/* ── 오늘 탭 ── */
function renderToday(){
  var voted = LS.get('todayVoted',false);
  var mySide = LS.get('votes',{})[TODAY.id]||null;
  var pred = LS.get('predicts',{})[TODAY.id]||null;
  var tot = TODAY.ac+TODAY.bc, a=Math.round(TODAY.ac/tot*100), b=100-a;

  var voteBlock = voted
    ? predBlock(TODAY.id, mySide, pred)
    : '<div class="vote-duo">'+
        voteBtnHTML('a',TODAY.a,a)+voteBtnHTML('b',TODAY.b,b)+
      '</div>';

  var rec = YESTERDAY;
  var recapHTML =
    '<div class="recap'+(rec.hit?'':' miss')+'">'+
      '<div class="rico">'+(rec.hit?'🎯':'🌫️')+'</div>'+
      '<div>'+
        '<div class="rhit">'+(rec.hit?icon('check',15)+'예측 적중!':'아쉽게 빗나감')+'</div>'+
        '<div class="rt">어제의 토론 <b>「'+esc(rec.title)+'」</b><br>최종 <b>찬성 '+rec.final_a+'%</b>로 마감 · 당신의 예측: '+(rec.myPredict==='a'?'찬성 우세':'반대 우세')+'</div>'+
      '</div>'+
    '</div>';

  var hotHTML = HOT.map(function(h,i){
    return '<div class="mini" data-toast="이 토론은 데모에선 열리지 않아요 · 실제 앱에선 상세로 이동">'+
      '<span class="mrank'+(i===0?' top':'')+'">'+(i+1)+'</span>'+
      '<div class="mbody">'+
        '<div class="mtitle">'+esc(h.title)+'</div>'+
        '<div class="mbar"><i style="width:'+h.a+'%"></i></div>'+
      '</div>'+
      '<div class="mright">'+
        (h.hot?'<div class="mhot">'+icon('fire',12)+' 급상승</div>':'<div class="mvoters">'+fmt(h.voters)+'명</div>')+
      '</div>'+
    '</div>';
  }).join('');

  document.getElementById('page-today').innerHTML =
    '<div class="daily-hero">'+
      '<div class="daily-kicker">'+icon('fire',13)+'오늘의 토론 · 6월 21일</div>'+
      '<span class="tag" style="color:'+CAT[TODAY.cat]+';background:color-mix(in oklab,'+CAT[TODAY.cat]+' 15%,transparent);margin-bottom:8px"><span class="tag-dot" style="background:'+CAT[TODAY.cat]+'"></span>'+TODAY.cat+'</span>'+
      '<h2>'+esc(TODAY.title)+'</h2>'+
      '<div class="dmeta"><span><b>'+icon('users',13)+' '+fmt(tot)+'</b>명 참여</span><span>'+icon('comment',13)+' '+fmt(TODAY.comments)+'</span><span style="color:var(--warn)">'+icon('clock',13)+' '+TODAY.endsIn+' 남음</span></div>'+
      voteBlock+
    '</div>'+

    '<div class="section-h"><span class="st">어제의 결과</span><span class="sub">돌아와서 확인하세요</span></div>'+
    recapHTML+

    '<div class="section-h"><span class="st">지금 뜨는 토론</span><span class="more">전체 →</span></div>'+
    hotHTML;
}

function voteBtnHTML(side,label,pct){
  return '<button class="vbtn '+side+'" data-vote="'+side+'">'+
    '<span class="check">'+icon('check',13)+'</span>'+
    '<span class="vlab">'+(side==='a'?'찬성':'반대')+' · '+esc(label)+'</span>'+
    '<span class="vpct">'+pct+'<small>%</small></span>'+
  '</button>';
}

/* 예측 회로 블록 — 투표 후 노출 */
function predBlock(id,mySide,pred){
  var head = '<div style="display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;margin-bottom:12px;color:'+(mySide==='a'?'var(--a-text)':'var(--b-text)')+'">'+
    icon('check',15)+(mySide==='a'?'찬성':'반대')+'에 투표했어요</div>';
  if(pred){
    return '<div style="margin-top:14px">'+head+
      '<div class="predict-box" style="border-style:solid;border-color:var(--gold)">'+
        '<div class="predict-done">'+icon('target',15)+'예측 완료 · 최종 '+(pred==='a'?'찬성':'반대')+' 우세에 걸었어요</div>'+
        '<div class="psub" style="margin:6px 0 0">마감되면 적중 여부를 알림으로 알려드려요. 결과 보러 다시 오세요 👀</div>'+
      '</div></div>';
  }
  return '<div style="margin-top:14px">'+head+
    '<div class="predict-box">'+
      '<div class="ph">'+icon('target',15)+'한 발 더 — 최종 승자 예측</div>'+
      '<div class="psub">마감 때 어느 쪽이 이길까요? 맞히면 적중률이 오르고 「예측왕」에 가까워져요.</div>'+
      '<div class="predict-row">'+
        '<button class="pbtn a" data-predict="a">찬성이 이긴다</button>'+
        '<button class="pbtn b" data-predict="b">반대가 이긴다</button>'+
      '</div>'+
    '</div></div>';
}

/* ── 투표함 탭 ── */
var BALLOT_FILTER = 'all';
function renderBallots(){
  var preds = LS.get('predicts',{});
  var counts = {all:BALLOTS.length, live:0, soon:0, closed:0};
  BALLOTS.forEach(function(x){counts[x.status]++;});

  var filters=[['all','전체'],['live','진행중'],['soon','마감임박'],['closed','마감']];
  var fbar = '<div class="filterbar">'+filters.map(function(f){
    return '<button class="fchip'+(BALLOT_FILTER===f[0]?' on':'')+'" data-filter="'+f[0]+'">'+f[1]+'<span class="n">'+counts[f[0]]+'</span></button>';
  }).join('')+'</div>';

  var list = BALLOTS.filter(function(x){return BALLOT_FILTER==='all'||x.status===BALLOT_FILTER;});
  var html = list.map(function(x){return ballotHTML(x,preds[x.id]);}).join('') ||
    '<div style="padding:50px 20px;text-align:center;color:var(--muted);font-size:13px">해당하는 토론이 없어요.</div>';

  document.getElementById('page-ballots').innerHTML =
    '<div class="section-h" style="margin-top:4px"><span class="st">내 투표함</span><span class="sub">내가 찍은 토론은 어떻게 됐을까</span></div>'+
    fbar + html +
    '<div class="local-note" style="margin-top:18px">이 기록은 전부 <b>내 기기에만</b> 저장돼요 · 서버 0바이트</div>';
}

function ballotHTML(x,pred){
  var now_a=x.now_a, now_b=100-now_a;
  var col=CAT[x.cat];
  var winning = (x.my==='a'&&now_a>50)||(x.my==='b'&&now_b>50);
  var lead = x.my==='a'?now_a:now_b;

  // 상태 배지
  var statusEl='';
  if(x.status==='closed'){
    var finalA=x.final_a, iWon=(x.my==='a'&&finalA>50)||(x.my==='b'&&finalA<50);
    statusEl='<span class="status '+(iWon?'win':'lose')+'">'+(iWon?'🏆 내 쪽 승':'내 쪽 패')+'</span>';
  } else if(x.flip){
    statusEl='<span class="status flip">🔄 역전됨</span>';
  } else if(x.status==='soon'){
    statusEl='<span class="status warn">'+icon('clock',11)+'마감임박 '+x.endsIn+'</span>';
  } else {
    statusEl='<span class="status '+(winning?'win':'lose')+'">'+(winning?'내 쪽 우세':'내 쪽 열세')+'</span>';
  }

  // 예측 태그
  var predEl='';
  if(x.status==='closed'){
    var pHit=(x.predict==='a'&&x.final_a>50)||(x.predict==='b'&&x.final_a<50);
    predEl='<span class="predtag '+(pHit?'hit':'miss')+'">'+icon('target',12)+(pHit?'예측 적중':'예측 빗나감')+'</span>';
  } else if(pred){
    predEl='<span class="predtag pending">'+icon('target',12)+'예측: '+(pred==='a'?'찬성':'반대')+'</span>';
  }

  var flipFlag='';
  var headRight = x.status==='closed'
    ? '<span style="color:var(--muted);white-space:nowrap">최종 찬성 '+x.final_a+'%</span>'
    : (x.flip?'<span style="color:var(--warn);font-weight:800;white-space:nowrap">투표 땐 '+x.at_a+'% → 지금 '+now_a+'%</span>':'<span style="color:var(--muted);white-space:nowrap">'+fmt(x.voters)+'명</span>');

  return '<div class="ballot'+(x.flip?' flip':'')+'">'+
    '<div class="bt-top">'+
      '<span class="tag" style="color:'+col+';background:color-mix(in oklab,'+col+' 14%,transparent)"><span class="tag-dot" style="background:'+col+'"></span>'+x.cat+'</span>'+
      statusEl+
      '<span class="myside '+x.my+'" style="margin-left:auto;white-space:nowrap;flex:0 0 auto">'+(x.my==='a'?'내 입장: 찬성':'내 입장: 반대')+'</span>'+
    '</div>'+
    '<h3>'+esc(x.title)+'</h3>'+
    '<div class="bbar-wrap">'+
      '<div class="bbar-head"><span class="lead-a">찬성 '+now_a+'%</span><span class="lead-b">'+now_b+'% 반대</span></div>'+
      '<div class="rbar-track"><div class="rbar-fill-a" style="width:'+now_a+'%"></div></div>'+
    '</div>'+
    '<div class="bfoot">'+headRight+predEl+'</div>'+
  '</div>';
}

/* ── 마이 탭 ── */
function renderProfile(){
  var tv=LS.get('totalVotes',0), tc=LS.get('totalComments',0), lg=LS.get('likesGot',0);
  var ph=LS.get('predHit',0), pt=LS.get('predTotal',1);
  var predRate=Math.round(ph/Math.max(pt,1)*100);
  var mh=LS.get('minorityHit',0), mt=LS.get('minorityTotal',1);
  var minRate=Math.round(mh/Math.max(mt,1)*100);
  var lean=LS.get('lean',{a:50,b:50});
  var score=tv+tc*2+Math.floor(lg/5);
  var lv=levelOf(score);
  var lvPct=lv.isMax?100:Math.round((score-lv.cur)/(lv.next-lv.cur)*100);
  var badges=LS.get('badges',[]);
  var cats=LS.get('catCount',{});
  var nick='침착한여우42';

  // 카테고리 막대
  var catTotal=Object.values(cats).reduce(function(s,n){return s+n;},0)||1;
  var catSorted=Object.keys(cats).sort(function(p,q){return cats[q]-cats[p];}).slice(0,5);
  var catHTML=catSorted.map(function(c){
    var pct=Math.round(cats[c]/catTotal*100);
    return '<div class="catrow"><span class="cn" style="color:'+CAT[c]+'">'+c+'</span>'+
      '<span class="ct"><i style="width:'+pct+'%;background:'+CAT[c]+'"></i></span>'+
      '<span class="cc">'+cats[c]+'</span></div>';
  }).join('');

  // 소수파 도넛
  var R=26,C=2*Math.PI*R,off=C*(1-minRate/100);
  var ring='<div class="ring"><svg width="62" height="62">'+
    '<circle cx="31" cy="31" r="'+R+'" fill="none" stroke="var(--surface-3)" stroke-width="6"/>'+
    '<circle cx="31" cy="31" r="'+R+'" fill="none" stroke="var(--cat-politics)" stroke-width="6" stroke-linecap="round" stroke-dasharray="'+C+'" stroke-dashoffset="'+off+'"/>'+
    '</svg><span class="rv">'+minRate+'%</span></div>';

  // 찬반 스펙트럼 (knob 위치: 반대 비율이 높을수록 오른쪽)
  var leanPos=lean.b; // 0=완전 찬성, 100=완전 반대
  var leanWord = lean.b>lean.a?'반대형':(lean.a>lean.b?'찬성형':'균형형');

  var badgeHTML=BADGES.map(function(bd){
    var earned=badges.indexOf(bd.k)>=0;
    return '<div class="bdg'+(earned?' earned':'')+'">'+
      (earned?'':'<span class="lock">🔒</span>')+
      '<span class="be">'+bd.e+'</span><span class="bn">'+bd.n+'</span></div>';
  }).join('');

  document.getElementById('page-profile').innerHTML =
    '<div class="profile-hero">'+
      '<div class="ph-row">'+
        '<div class="ph-av">🦊</div>'+
        '<div class="ph-id">'+
          '<div class="ph-nick">'+esc(nick)+'<span class="tg">#k7m</span></div>'+
          '<div class="ph-rank"><span class="lv">Lv.'+lv.idx+'</span>'+esc(lv.name)+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="lvbar">'+
        '<div class="lvb-head"><span>다음 등급까지</span><span>'+(lv.isMax?'최고 등급':(lv.next-score)+'점 남음')+'</span></div>'+
        '<div class="lvb-track"><div class="lvb-fill" style="width:'+lvPct+'%"></div></div>'+
      '</div>'+
    '</div>'+

    '<div class="stat-grid">'+
      stat('a',tv,'참여한 토론')+
      stat('live',predRate+'%','예측 적중률')+
      stat('g',lg,'받은 공감')+
      stat('b',tc,'남긴 의견')+
    '</div>'+

    '<div class="section-h"><span class="st">나의 토론 성향</span><span class="sub">투표가 쌓일수록 정교해져요</span></div>'+
    '<div class="trait">'+
      '<div class="tlabel">찬반 기질</div>'+
      '<div class="spectrum">'+
        '<div class="sp-head"><span class="l">찬성 '+lean.a+'%</span><span class="r">반대 '+lean.b+'%</span></div>'+
        '<div class="sp-track"><div class="sp-knob" style="left:'+leanPos+'%"></div></div>'+
        '<div class="sp-cap">당신은 평균적으로 <b>'+leanWord+'</b> — 새로운 주장에 일단 의심부터 던지는 편</div>'+
      '</div>'+
      '<div class="minority">'+ring+
        '<div class="mtext"><b>소수파 지수 '+minRate+'%</b><span>23번 중 12번, 당신은 다수와 다른 쪽에 섰어요. 흔들리지 않는 사람.</span></div>'+
      '</div>'+
    '</div>'+

    '<div class="section-h"><span class="st">활동 카테고리</span></div>'+
    '<div class="trait"><div class="catbars">'+catHTML+'</div></div>'+

    '<div class="section-h"><span class="st">배지</span><span class="sub">'+badges.length+' / '+BADGES.length+' 획득</span></div>'+
    '<div class="badge-grid">'+badgeHTML+'</div>'+

    '<button class="share-cta" data-toast="성향 카드 이미지를 공유 시트로 내보내요 (실제 앱)">'+icon('share',17)+'내 토론 성향 카드 공유</button>'+
    '<div class="local-note">레벨·성향·배지·소수파 지수는 모두 <b>기기에서 계산</b>돼요.<br>로그인도, 서버 저장도 없이 \'나\'가 쌓입니다.</div>';
}
function stat(cls,v,l){return '<div class="stat"><div class="sv '+cls+'">'+(typeof v==='number'?fmt(v):v)+'</div><div class="sl">'+l+'</div></div>';}

/* ════════ 인터랙션 ════════ */
function toast(msg,emoji,gold){
  var t=document.getElementById('toast');
  t.querySelector('.tem').textContent=emoji||'✓';
  t.querySelector('.tmsg').textContent=msg;
  t.classList.toggle('gold',!!gold);
  t.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(function(){t.classList.remove('show');},2600);
}
function unlock(badge){
  var u=document.getElementById('unlock');
  u.querySelector('.ue').textContent=badge.e;
  u.querySelector('.un').textContent=badge.n;
  u.querySelector('.ud').textContent=BADGE_DESC[badge.k]||'새 배지를 획득했어요!';
  u.classList.add('show');
}
function earnBadge(k){
  var badges=LS.get('badges',[]);
  if(badges.indexOf(k)>=0) return false;
  badges.push(k); LS.set('badges',badges);
  var bd=BADGES.filter(function(x){return x.k===k;})[0];
  if(bd) setTimeout(function(){unlock(bd);},650);
  return true;
}

/* 탭 전환 */
function switchTab(name){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('on',t.dataset.tab===name);});
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('on');});
  document.getElementById('page-'+name).classList.add('on');
  document.getElementById('view').scrollTop=0;
  if(name==='ballots')renderBallots();
  if(name==='profile')renderProfile();
}

/* 오늘의 토론 투표 */
function doVote(side){
  var votes=LS.get('votes',{}); votes[TODAY.id]=side; LS.set('votes',votes);
  var at=LS.get('atVote',{}); var tot=TODAY.ac+TODAY.bc; at[TODAY.id]={a:Math.round(TODAY.ac/tot*100)}; LS.set('atVote',at);
  // 스트릭 +1 (어제 방문 → 오늘 첫 참여)
  if(!LS.get('todayVoted',false)){
    LS.set('todayVoted',true);
    var s=LS.get('streak',0)+1; LS.set('streak',s);
    document.getElementById('streakN').textContent=s;
    LS.set('totalVotes',LS.get('totalVotes',0)+1);
    toast(s+'일 연속 참여 중! 내일도 만나요','🔥');
    if(s>=7) earnBadge('streak7');
  }
  renderToday();
}

/* 예측 */
function doPredict(side){
  var preds=LS.get('predicts',{}); preds[TODAY.id]=side; LS.set('predicts',preds);
  LS.set('predTotal',LS.get('predTotal',0)+1);
  // 데모: 적중률이 오르며 예측왕(80%) 배지 조건 시연
  var ph=LS.get('predHit',0)+1; LS.set('predHit',ph);
  var rate=Math.round(ph/LS.get('predTotal',1)*100);
  // 투표함 배지 갱신
  var bb=document.getElementById('ballotBadge');
  toast('예측 등록 완료 · 마감 때 결과 알려드릴게요','🎯',true);
  if(rate>=80) earnBadge('oracle');
  renderToday();
}

/* 이벤트 위임 */
document.addEventListener('click',function(e){
  var tab=e.target.closest('.tab');
  if(tab){switchTab(tab.dataset.tab);return;}

  var v=e.target.closest('[data-vote]');
  if(v){doVote(v.dataset.vote);return;}

  var p=e.target.closest('[data-predict]');
  if(p){doPredict(p.dataset.predict);return;}

  var f=e.target.closest('[data-filter]');
  if(f){BALLOT_FILTER=f.dataset.filter;renderBallots();return;}

  var tst=e.target.closest('[data-toast]');
  if(tst){toast(tst.dataset.toast,'👀');return;}

  var sc=e.target.closest('#streakChip');
  if(sc){toast(LS.get('streak',0)+'일 연속 · 하루라도 빠지면 0부터예요','🔥');return;}

  if(e.target.closest('#unlockClose')){
    document.getElementById('unlock').classList.remove('show');
    if(document.getElementById('page-profile').classList.contains('on'))renderProfile();
    return;
  }
});

/* ── 초기 ── */
renderToday();
renderBallots();
var _initTab=(location.hash||'').replace('#','');
if(_initTab==='ballots'||_initTab==='profile')switchTab(_initTab);
