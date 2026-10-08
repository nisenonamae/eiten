// 栄典のテスト:node test_eiten.js(jsdom が要る)
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
function ok(cond, name){ if(cond){ pass++; } else { fail++; console.log('  ✗ ' + name); } }
function throws(fn, re, name){ try{ fn(); ok(false, name + '(投げなかった)'); }catch(e){ ok(re.test(e.message), name + ' :: ' + e.message); } }

// --- GitHub の contents API のまねごと ---
function makeRepo(){
  const files = {}; let n = 0; const hooks = { beforePut: null };
  const res = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });
  async function fetch(url, opt = {}){
    const m = url.match(/\/contents\/([^?]+)/); const p = decodeURIComponent(m[1]);
    const method = opt.method || 'GET';
    if(method === 'GET'){
      if(!files[p]) return res(404, { message: 'Not Found' });
      return res(200, { content: Buffer.from(files[p].text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n'), sha: files[p].sha });
    }
    if(method === 'PUT'){
      if(hooks.beforePut){ const h = hooks.beforePut; hooks.beforePut = null; h(); }
      const body = JSON.parse(opt.body);
      const cur = files[p];
      if(cur && body.sha !== cur.sha) return res(409, { message: 'conflict' });
      if(!cur && body.sha) return res(422, { message: 'sha given' });
      const sha = 'sha' + (++n);
      files[p] = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha };
      return res(200, { content: { sha } });
    }
    return res(405, {});
  }
  return { files, hooks, fetch, put(p, obj){ files[p] = { text: JSON.stringify(obj), sha: 'sha' + (++n) }; }, json(p){ return JSON.parse(files[p].text); } };
}

async function boot(repo, withToken = true){
  const dom = new JSDOM(html, {
    url: 'https://nisenonamae.github.io/eiten/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win){
      win.fetch = repo.fetch;
      if(withToken) win.localStorage.setItem('eiten.cfg', JSON.stringify({ owner: 'o', repo: 'notion-daily', branch: 'main', token: 't' }));
    },
  });
  await dom.window.App.ready;
  return dom;
}
const click = (w, sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const tick = () => new Promise(r => setTimeout(r, 0));

const DATA = 'roadmap/apps/eiten/data.json';
(async () => {
  // ===== 決まり =====
  {
    console.log('決まり');
    const dom = await boot(makeRepo(), false);
    const { E } = dom.window.App;
    ok(E.taskDay(new Date('2026-10-08T19:59:00Z')) === '2026-10-08', '朝5時前(日本時間4:59)は前の日');
    ok(E.taskDay(new Date('2026-10-08T20:00:00Z')) === '2026-10-09', '朝5時ちょうどで次の日');
    ok(E.addDays('2026-12-30', 3) === '2027-01-02', '日を足す');
    const d = E.emptyData(), T = '2026-10-09';
    const A1 = E.saveDef(d, { type: 'achievement', raw: { name: '英検準1級', fields: ['eng'], condition: '合格する', description: '英語の土台' }, today: T }).id;
    ok(d.achievements.length === 1 && d.achievements[0].description === '英語の土台' && d.rules.length === 1, 'すぐに足せて、履歴が残る');
    const B = E.saveDef(d, { type: 'achievement', raw: { name: 'TOEFL100', fields: ['eng'], condition: '100点', requires: [A1] }, today: T }).id;
    throws(() => E.saveDef(d, { type: 'achievement', id: A1, raw: { name: '英検準1級', condition: '合格', requires: [B] }, today: T }), /ぐるっと/, '前提の輪はだめ');
    throws(() => E.saveDef(d, { type: 'achievement', raw: { name: 'TOEFL100', condition: 'x' }, today: T }), /同じ名前/, '同じ名前はだめ');
    throws(() => E.saveDef(d, { type: 'challenge', raw: { name: '留学', condition: 'x', requires: [] }, today: T }), /1つ以上/, '挑戦権は前提が要る');
    throws(() => E.saveDef(d, { type: 'achievement', raw: { name: 'X', condition: 'x', renewDays: '0' }, today: T }), /1以上/, '日数は1以上');
    const C = E.saveDef(d, { type: 'challenge', raw: { name: '海外留学', fields: ['eng'], condition: '留学する', requires: [A1, B], uses: '2', validDays: '365' }, today: T }).id;

    throws(() => E.grant(d, B, { today: T }), /必要実績/, '前提がないと達成できない');
    E.grant(d, A1, { today: T });
    ok(E.held(d, A1, T), '達成したを押すと手に入る');
    throws(() => E.grant(d, A1, { today: T }), /もう/, '二度は付けない');
    const r = E.grant(d, B, { today: T });
    ok(r.newRights.includes(C) && E.rightFor(d, C).left === 2 && E.rightFor(d, C).expires === '2027-10-09', '組み合わせがそろうと挑戦権');
    // 直しても手に入れたものは残る
    E.saveDef(d, { type: 'achievement', id: B, raw: { name: 'TOEFL100', fields: ['eng'], condition: '110点', requires: [A1] }, today: T });
    ok(E.held(d, B, T) && d.rules[d.rules.length - 1].before.condition === '100点', '直しても手に入れた実績は残り、前後が残る');
    throws(() => E.removeDef(d, { type: 'achievement', id: B, today: T }), /取り消して/, '手に入れた実績は消せない');
    throws(() => E.removeDef(d, { type: 'challenge', id: C, today: T }), /持っている/, '持っている挑戦権は消せない');
    // 取り消し
    const u = E.ungrant(d, B);
    ok(!E.held(d, B, T) && u.removedRights.includes(C) && !E.rightFor(d, C), '取り消すと、それで得た挑戦権も戻る');
    E.ungrant(d, A1);
    throws(() => E.removeDef(d, { type: 'achievement', id: A1, today: T }), /必要実績/, '必要実績になっている実績は消せない');
    E.removeDef(d, { type: 'challenge', id: C, today: T });
    E.removeDef(d, { type: 'achievement', id: B, today: T });
    ok(d.achievements.length === 1 && d.challenges.length === 0, '消せる');
    // 更新制
    const H = E.saveDef(d, { type: 'achievement', raw: { name: '体力測定', condition: 'x', renewDays: '30' }, today: T }).id;
    E.grant(d, H, { today: T });
    ok(E.grantFor(d, H).expires === '2026-11-08', '更新期限が付く');
    ok(E.achStatus(d, d.achievements.find(a => a.id === H), '2026-10-30').near, '期限が近いとくすむ');
    ok(E.canGrant(d, H, '2026-11-10').renewal, '更新できる');
    E.grant(d, H, { today: '2026-11-10' });
    ok(E.grantFor(d, H).expires === '2026-12-10' && E.grantFor(d, H).day === T, '更新すると期限が延び、達成日はそのまま');
    const S2 = E.saveDef(d, { type: 'achievement', raw: { name: '夏', condition: 'x', period: { from: '2026-07-01', to: '2026-08-31' } }, today: T }).id;
    ok(!E.canGrant(d, S2, T).ok, '期間の外は達成にできない');
    // 取り込み
    throws(() => E.parsePack('こんにちは'), /見つかりません/, '取り込みの文字でないものははじく');
    throws(() => E.parsePack('{"eiten":2}'), /ではありません/, '形のちがうものははじく');
    throws(() => E.parsePack('{"eiten":1,"parts":[{"id":"b-x","name":"x"}]}'), /最初からある/, '最初の部品のidは使えない');
    const pack = E.parsePack('ここから```json\n' + JSON.stringify({ eiten: 1, title: 'テスト',
      parts: [{ id: 'p-t', name: '点', kind: '紋', shapes: [{ t: 'circle', x: 50, y: 50, r: 10, fill: 'm3', s: 1, rot: 0 }] }],
      arts: [{ id: 'art-t', name: '点の勲章', layers: [{ part: 'b-enshou', x: 50, y: 50, s: 1, metal: 'gold' }, { part: 'p-t', x: 50, y: 50, s: 1, metal: 'silver' }] }],
      achievements: [{ id: 'a-t', name: '点を打つ', fields: [], condition: '点を打った', description: 'はじめの点', requires: [], art: 'art-t' }] }) + '\n```ここまで');
    const ir = E.importPack(d, pack, T);
    ok(ir.arts === 1 && ir.parts === 1 && ir.achievements === 1 && ir.replaced === 0 && d.achievements.find(a => a.id === 'a-t').art === 'art-t', '取り込める(前後に余計な文字があってもよい)');
    pack.achievements[0].condition = '点を2つ打った';
    const ir2 = E.importPack(d, pack, T);
    ok(ir2.replaced === 3 && d.achievements.filter(a => a.id === 'a-t').length === 1 && d.achievements.find(a => a.id === 'a-t').condition === '点を2つ打った', 'もう一度取り込むと上書きで、増えない');
    dom.window.close();
  }

  // ===== 画面と書き込み =====
  {
    console.log('画面と書き込み');
    const repo = makeRepo();
    repo.put('roadmap/gov/ministries.json', [{ tag: 'math', name: '数学省', order: 2 }, { tag: 'eng', name: '英語省', order: 1 }]);
    const dom = await boot(repo);
    const w = dom.window, doc = w.document, App = w.App;
    w.confirm = () => true;
    ok(doc.getElementById('ver').textContent === App.VERSION, '版が出る');
    ok(App.S.ministries[0].name === '英語省', '省を順番どおりに読む');
    ok(doc.querySelectorAll('[data-tab]').length === 4 && !doc.querySelector('[data-tab="review"]'), 'タブは4つ(審査会議はない)');
    click(w, '[data-tab="settings"]');
    click(w, '[data-act="def-add"][data-type="achievement"]');
    ok(doc.getElementById('def-form'), '設定でそのまま足せる');
    doc.getElementById('rf-name').value = '数検準1級';
    doc.getElementById('rf-cond').value = '合格する';
    doc.getElementById('rf-desc').value = '数学の力の証';
    doc.querySelector('input[name="rf-field"][value="math"]').checked = true;
    // 別の端末が先に書き込んだことにする
    repo.put(DATA, { version: 1, achievements: [], challenges: [], parts: [{ id: 'p-x', name: '別の端末の部品', kind: '紋', shapes: [] }], arts: [], grants: [], rights: [], reviews: [], rules: [] });
    await App.Actions.saveDef(); await tick();
    const saved = repo.json(DATA);
    ok(saved.achievements[0].name === '数検準1級' && saved.achievements[0].description === '数学の力の証' && saved.parts.length === 1, 'ぶつかっても読み直して、両方残る');
    ok(!doc.getElementById('def-form') && /数学の力の証/.test(doc.querySelector('main').textContent), '足したら一覧に内容つきで出る');
    const aid = App.S.data.achievements[0].id;
    click(w, `[data-act="grant"][data-id="${aid}"]`); await tick(); await tick();
    ok(repo.json(DATA).grants.length === 1 && doc.getElementById('fanfare'), '達成したを押すと記録され、演出が出る');
    doc.getElementById('fanfare').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    click(w, `[data-act="def-edit"][data-id="${aid}"]`);
    doc.getElementById('rf-cond').value = '';
    await App.Actions.saveDef(); await tick();
    ok(doc.getElementById('toast').classList.contains('err') && doc.getElementById('def-form'), '達成条件がないと直せない(欄は残る)');
    doc.getElementById('rf-cond').value = '合格する(1次・2次)';
    await App.Actions.saveDef(); await tick();
    ok(repo.json(DATA).achievements[0].condition === '合格する(1次・2次)', '直せる');
    click(w, `[data-act="def-del"][data-id="${aid}"]`); await tick();
    ok(App.S.data.achievements.length === 1, '手に入れた実績は消せない');
    click(w, `[data-act="ungrant"][data-id="${aid}"]`); await tick();
    click(w, `[data-act="def-del"][data-id="${aid}"]`); await tick();
    ok(repo.json(DATA).achievements.length === 0 && repo.json(DATA).grants.length === 0, '取り消してから消せる');
    click(w, '[data-tab="list"]');
    // ずっとぶつかる
    let count = 0; const orig = repo.fetch;
    w.fetch = async (u, o = {}) => { if(o.method === 'PUT'){ count++; return { ok: false, status: 409, json: async () => ({}) }; } return orig(u, o); };
    await App.save(d => d, 'テスト').catch(e => ok(/ぶつかり続けた/.test(e.message), 'やり直しは最大3回'));
    ok(count === 4, '最初の1回+やり直し3回');
    w.close();
  }

  // ===== 絵・樹形図・工房 =====
  {
    console.log('絵・樹形図・工房');
    const repo = makeRepo();
    repo.put('roadmap/gov/ministries.json', [{ tag: 'eng', name: '英語省', order: 1 }, { tag: 'math', name: '数学省', order: 2 }]);
    const T = '2026-10-09';
    repo.put(DATA, { version: 1,
      achievements: [
        { id: 'a1', name: '英検準1級', fields: ['eng'], condition: '合格', requires: [], period: null, art: null, renewDays: null },
        { id: 'a2', name: 'TOEFL100', fields: ['eng'], condition: '100点', requires: ['a1'], period: null, art: null, renewDays: null },
        { id: 'm1', name: '数検準1級', fields: ['math'], condition: '合格', requires: [], period: null, art: null, renewDays: null },
        { id: 'm2', name: '英語で数学', fields: ['math'], condition: '英語の数学書を1冊', requires: ['m1', 'a2'], period: null, art: null, renewDays: null } ],
      challenges: [{ id: 'c1', name: '海外留学', fields: ['eng'], condition: '留学', requires: ['a1', 'a2'], period: null, art: null, uses: 2, cooldownDays: 30, validDays: null }],
      parts: [], arts: [], grants: [{ achId: 'a1', day: T, note: '', expires: null, renewals: [] }], rights: [], reviews: [], rules: [] });
    const dom = await boot(repo);
    const w = dom.window, doc = w.document, App = w.App, { A } = App;
    w.confirm = () => true;
    const kinds = k => A.BUILTIN.filter(p => p.kind === k).map(p => p.name);
    ok(['円章','盾','星','六角形','菱形','旗'].every(n => kinds('形').includes(n)), '形がそろっている');
    ok(['本','地球','ペン','剣','山','炎','波','歯車','家','星','王冠','道'].every(n => kinds('紋').includes(n)), '紋がそろっている');
    ok(['光の筋','月桂樹','綬(リボン)','小さな星','縁取り(一重)','縁取り(二重)','縁取り(刻み)','縁取り(粒)'].every(n => kinds('飾り').includes(n)), '飾りがそろっている');
    ok(A.BUILTIN.every(p => !/NaN|undefined/.test(A.partSvg(p))), 'どの部品も描ける');
    ok(/<mask/.test(A.partSvg(A.builtin('b-chikyu'))) && !/<mask/.test(A.artSvg({ layers: [{ part: 'b-chikyu', x: 50, y: 50, s: 1 }] }, id => A.builtin(id), { mode: 'shadow' })), 'くり抜きはマスク・影ではくり抜かない');
    ok(A.metal('#2b4a86')[1] === '#2b4a86', '好きな色から地金を作る');
    ok(!/NaN/.test(A.artSvg(A.builtinArt('ba-senri'), id => A.builtin(id))), '「千里の道も一歩から」が描ける');

    const L = App.treeLayout(App.S.data, 'all', T), dep = k => L.nodes.find(n => n.key === k).depth;
    ok(dep('a:a1') === 0 && dep('a:a2') === 1 && dep('a:m2') === 2 && dep('c:c1') === 2, '必要実績の深さで段が決まる');
    const Lm = App.treeLayout(App.S.data, 'math', T);
    ok(Lm.nodes.find(n => n.key === 'a:a2').outside && !Lm.nodes.find(n => n.key === 'c:c1'), '分野ごとの図ではほかの分野の前提を薄く出す');
    click(w, '[data-tab="tree"]');
    ok(doc.querySelectorAll('.tree [data-node]').length === 5, '図に5つ');
    click(w, '[data-node="c:c1"]');
    ok(/持っている:英検準1級/.test(doc.getElementById('tree-detail').textContent) && /鍵がかかっている/.test(doc.getElementById('tree-detail').textContent), '押すと説明が出る');
    click(w, '[data-node="a:a2"]');
    click(w, '#tree-detail [data-act="grant"]'); await tick(); await tick();
    ok(App.S.data.grants.length === 2 && App.S.data.rights.length === 1, '樹形図から達成したを押せる・挑戦権も得る');
    ok(doc.getElementById('fanfare') && doc.getElementById('fanfare').querySelectorAll('.cf').length > 30, '演出が出る');
    doc.getElementById('fanfare').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    click(w, '[data-act="goto-def"]');
    ok(App.S.tab === 'settings' && doc.getElementById('def-a2'), '設定で見る');
    // #a:id で飛んでくる
    w.location.hash = '#a:m1'; await new Promise(r => setTimeout(r, 20));
    ok(App.S.tab === 'tree' && doc.getElementById('tree-detail') && /数検準1級/.test(doc.getElementById('tree-detail').textContent), 'ほかのアプリの紋章から飛んでこられる');

    // 工房
    click(w, '[data-tab="studio"]');
    click(w, '[data-act="st-add-shape"][data-v="circle"]');
    click(w, '[data-act="st-add-shape"][data-v="star"]');
    const r2 = doc.querySelector('#st-panel input[data-f="r2"]'); r2.value = '6'; r2.dispatchEvent(new w.Event('input', { bubbles: true }));
    ok(App.S.st.part.shapes[1].r2 === 6, 'つまみで形を変える');
    doc.querySelector('#st-panel input[data-f="cut"]').click();
    ok(/<mask/.test(doc.getElementById('st-canvas').innerHTML), 'くり抜ける');
    const nm = doc.querySelector('#st-panel input[data-f="name"]'); nm.value = '星の穴'; nm.dispatchEvent(new w.Event('input', { bubbles: true }));
    const pid = await App.Studio.savePart(); await tick();
    ok(pid && repo.json(DATA).parts[0].name === '星の穴', '部品をしまえる');
    App.Studio.mode('art');
    ok(doc.querySelector('[data-act="st-pick-art"][data-id="ba-senri"]'), '届いた勲章が勲章の一覧にある');
    click(w, '[data-act="st-add-layer"][data-id="b-enshou"]');
    click(w, `[data-act="st-add-layer"][data-id="${pid}"]`);
    click(w, '[data-act="st-metal"][data-v="bronze"]');
    const an = doc.querySelector('#st-panel input[data-o="art"][data-f="name"]'); an.value = '英語の勲章'; an.dispatchEvent(new w.Event('input', { bubbles: true }));
    const artId = await App.Studio.saveArt(); await tick();
    ok(artId && repo.json(DATA).arts[0].layers[1].metal === 'bronze', '勲章をしまえる');
    click(w, '[data-tab="settings"]');
    click(w, '[data-act="def-edit"][data-id="a2"]');
    doc.getElementById('rf-art').value = artId;
    await App.Actions.saveDef(); await tick();
    ok(App.S.data.achievements.find(a => a.id === 'a2').art === artId, '設定で勲章を結びつけられる');
    click(w, '[data-tab="list"]');
    ok(doc.querySelectorAll('.shelf .slot:not(.off)').length === 2, '棚に2つ');
    w.close();
  }

  // ===== 届いた案と取り込み =====
  {
    console.log('届いた案と取り込み');
    const repo = makeRepo();
    repo.put('roadmap/gov/ministries.json', [{ tag: 'eng', name: '英語省', order: 1 }]);
    const dom = await boot(repo);
    const w = dom.window, doc = w.document, App = w.App;
    click(w, '[data-tab="settings"]');
    ok(/千里の道も一歩から/.test(doc.querySelector('.card.delivery').textContent), '届いた案が設定に出る');
    click(w, '[data-act="take-delivery"][data-id="dl-senri"]');
    ok(doc.getElementById('rf-art').value === 'ba-senri' && doc.getElementById('rf-cond').value === '定着に達するタスクが10個以上である', '案の中身が欄に入る');
    await App.Actions.saveDef(); await tick();
    ok(App.S.data.achievements[0].art === 'ba-senri' && !doc.querySelector('.card.delivery'), '足すと届いた案から消える');
    // 取り込み
    const pack = { eiten: 1, title: '本の虫', parts: [], arts: [{ id: 'art-hon', name: '本の虫', layers: [{ part: 'b-rokkaku', x: 50, y: 50, s: 1, metal: 'silver' }, { part: 'b-hon', x: 50, y: 50, s: .7, metal: 'gold' }] }],
      achievements: [{ id: 'a-hon', name: '本の虫', fields: ['eng'], condition: '洋書を10冊読んだ', description: '読書の積み重ね', requires: [], art: 'art-hon' }] };
    doc.getElementById('imp-text').value = 'これを貼ってください:\n' + JSON.stringify(pack);
    click(w, '[data-act="import-read"]');
    ok(/本の虫/.test(doc.querySelector('.importbox .card').textContent) && doc.querySelector('.importbox .card svg'), '読み込むと中身と勲章が見える');
    click(w, '[data-act="import-do"]'); await tick(); await tick();
    const j = repo.json(DATA);
    ok(j.arts.find(a => a.id === 'art-hon') && j.achievements.find(a => a.id === 'a-hon').art === 'art-hon', '取り込むとデータに入る(ファイルの入れ替えは要らない)');
    ok(!doc.querySelector('.importbox .card'), '取り込んだら見本は閉じる');
    doc.getElementById('imp-text').value = 'こわれた{"eiten":1, ';
    click(w, '[data-act="import-read"]');
    ok(doc.getElementById('toast').classList.contains('err'), 'こわれた文字は知らせる');
    w.close();
  }

  // ===== 埋め込み =====
  {
    console.log('埋め込み');
    const repo = makeRepo();
    repo.put(DATA, { version: 1, achievements: [
      { id: 'a1', name: '千里の道も一歩から', fields: [], condition: 'x', requires: [], art: 'ba-senri' },
      { id: 'a2', name: '英検', fields: ['eng'], condition: 'x', requires: [] },
      { id: 'a3', name: '数検', fields: ['math'], condition: 'x', requires: [] } ],
      challenges: [], parts: [], arts: [], grants: [{ achId: 'a1', day: '2026-10-09' }, { achId: 'a2', day: '2026-10-08' }], rights: [], reviews: [], rules: [] });
    const html = fs.readFileSync(path.join(__dirname, 'embed.html'), 'utf8');
    const open = async (q, token = true) => {
      const msgs = [];
      const dom = new JSDOM(html, { url: 'https://nisenonamae.github.io/eiten/embed.html' + q, runScripts: 'dangerously',
        beforeParse(win){ win.fetch = repo.fetch; if(token) win.localStorage.setItem('eiten.cfg', JSON.stringify({ owner: 'o', repo: 'r', branch: 'main', token: 't' })); win.parent.postMessage = m => msgs.push(m); } });
      await new Promise(r => setTimeout(r, 30));
      return { doc: dom.window.document, msgs };
    };
    let e = await open('');
    ok(e.doc.querySelectorAll('a.m').length === 2 && /紋章 2 \/ 3/.test(e.doc.body.textContent), '手に入れた紋章が並ぶ');
    ok(e.doc.querySelector('a.m').getAttribute('href').endsWith('#a:a1') && e.doc.querySelector('a.m').getAttribute('target') === '_top', '押すと栄典のその実績へ');
    ok(e.msgs.some(m => m.type === 'eiten-height'), '高さを親に知らせる');
    e = await open('?field=eng&all=1');
    ok(e.doc.querySelectorAll('a.m').length === 1 && /英検/.test(e.doc.body.textContent), '省ごとに絞れる');
    e = await open('?all=1&head=0');
    ok(e.doc.querySelectorAll('a.m.off').length === 1 && !e.doc.querySelector('.head'), 'まだのものを影で出せる・見出しを消せる');
    e = await open('', false);
    ok(/接続してください/.test(e.doc.body.textContent), '未接続なら案内');
  }

  {
    const dom = await boot(makeRepo(), false);
    ok(!dom.window.document.getElementById('conn').hidden, '接続していないと接続の欄が開く');
    dom.window.close();
  }
  console.log(`\n${pass}件 通過 / ${fail}件 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
