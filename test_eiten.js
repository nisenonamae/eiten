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

(async () => {
  // ===== 決まり =====
  {
    const repo = makeRepo();
    const dom = await boot(repo, false);
    const { E } = dom.window.App;
    console.log('決まり');
    ok(E.taskDay(new Date('2026-10-08T19:59:00Z')) === '2026-10-08', '朝5時前(日本時間4:59)は前の日');
    ok(E.taskDay(new Date('2026-10-08T20:00:00Z')) === '2026-10-09', '朝5時ちょうどで次の日');
    ok(E.addDays('2026-12-30', 3) === '2027-01-02', '日を足す');

    const d = E.emptyData(); const T = '2026-10-09';
    // 実績を足す申し出 → 認める
    const r1 = E.proposeRule(d, { op: 'add', type: 'achievement', def: { name: '英検準1級', fields: ['eng'], condition: '合格する', requires: [] }, today: T });
    ok(d.achievements.length === 0, '申し出ただけでは反映されない');
    throws(() => E.decide(d, r1.id, { approve: true, reason: ' ', today: T }), /理由/, '理由なしでは決められない');
    E.decide(d, r1.id, { approve: true, reason: '妥当', today: T });
    ok(d.achievements.length === 1 && d.rules.length === 1, '認めると反映され、履歴に残る');
    const A = d.achievements[0].id;
    throws(() => E.decide(d, r1.id, { approve: true, reason: 'x', today: T }), /もう決まって/, '同じ審査は二度決められない');

    const r2 = E.proposeRule(d, { op: 'add', type: 'achievement', def: { name: 'TOEFL100', fields: ['eng'], condition: '100点', requires: [A] }, today: T });
    E.decide(d, r2.id, { approve: true, reason: 'ok', today: T });
    const B = d.achievements.find(a => a.name === 'TOEFL100').id;
    throws(() => E.proposeRule(d, { op: 'edit', type: 'achievement', id: A, def: { name: '英検準1級', condition: '合格', requires: [B] }, today: T }), /ぐるっと/, '前提の輪はだめ');
    throws(() => E.proposeRule(d, { op: 'add', type: 'achievement', def: { name: 'TOEFL100', condition: 'x' }, today: T }), /同じ名前/, '同じ名前はだめ');
    throws(() => E.proposeRule(d, { op: 'add', type: 'challenge', def: { name: '留学', condition: 'x', requires: [] }, today: T }), /1つ以上/, '挑戦権は前提が要る');
    throws(() => E.proposeRule(d, { op: 'add', type: 'achievement', def: { name: 'X', condition: 'x', renewDays: '0' }, today: T }), /1以上/, '日数は1以上');

    // 挑戦権
    const r3 = E.proposeRule(d, { op: 'add', type: 'challenge', def: { name: '海外留学', fields: ['eng'], condition: '留学する', requires: [A, B], uses: '2', cooldownDays: '30', validDays: '365' }, today: T });
    E.decide(d, r3.id, { approve: true, reason: 'ok', today: T });
    const C = d.challenges[0].id;
    ok(d.challenges[0].uses === 2 && d.challenges[0].validDays === 365, '数は数として持つ');

    // 申請
    ok(!E.canApply(d, B, T).ok, '前提がないと申請できない');
    throws(() => E.submitApplication(d, { achId: A, evidence: '', today: T }), /証拠/, '証拠なしでは申請できない');
    const ap1 = E.submitApplication(d, { achId: A, evidence: '合格証', today: T });
    ok(!E.canApply(d, A, T).ok, '審査待ちがあると重ねて申請できない');
    E.decide(d, ap1.id, { approve: false, reason: '証拠が足りない', today: T });
    ok(d.grants.length === 0 && E.canApply(d, A, T).ok, '差し戻したら手に入らず、出し直せる');
    const ap2 = E.submitApplication(d, { achId: A, evidence: '合格証の写真', today: T });
    E.decide(d, ap2.id, { approve: true, reason: '確認', today: T });
    ok(E.held(d, A, T), '認めると手に入る');
    ok(E.achStatus(d, d.achievements.find(a => a.id === B), T).state === 'open', '前提がそろうと今目指せる');
    const ap3 = E.submitApplication(d, { achId: B, evidence: 'スコア', today: T });
    const out = E.decide(d, ap3.id, { approve: true, reason: '確認', today: T });
    ok(out.newRights.includes(C), '組み合わせがそろうと挑戦権が得られる');
    const right = E.rightFor(d, C);
    ok(right.left === 2 && right.expires === '2027-10-09', '挑戦権の回数と有効期限');

    // 不遡及
    const r4 = E.proposeRule(d, { op: 'edit', type: 'achievement', id: B, def: { name: 'TOEFL100', fields: ['eng'], condition: '110点に変更', requires: [A] }, today: T });
    E.decide(d, r4.id, { approve: true, reason: '厳しくする', today: T });
    ok(E.held(d, B, T) && d.rules.length === 4, 'ルールが変わっても手に入れた実績は残る');
    ok(d.rules[3].before.condition === '100点' && d.rules[3].after.condition === '110点に変更', '変更の前後が残る');

    // 更新制
    const r5 = E.proposeRule(d, { op: 'add', type: 'achievement', def: { name: '体力測定', fields: ['health'], condition: 'x', renewDays: '30' }, today: T });
    E.decide(d, r5.id, { approve: true, reason: 'ok', today: T });
    const H = d.achievements.find(a => a.name === '体力測定');
    E.decide(d, E.submitApplication(d, { achId: H.id, evidence: '記録', today: T }).id, { approve: true, reason: 'ok', today: T });
    ok(E.grantFor(d, H.id).expires === '2026-11-08', '更新期限が付く');
    ok(E.achStatus(d, H, '2026-10-30').near, '期限が近いとくすむ');
    ok(E.achStatus(d, H, '2026-11-09').expired, '期限が過ぎると切れる');
    const ren = E.submitApplication(d, { achId: H.id, evidence: '再測定', today: '2026-11-10' });
    ok(ren.renewal, '更新の申請になる');
    E.decide(d, ren.id, { approve: true, reason: 'ok', today: '2026-11-10' });
    const g = E.grantFor(d, H.id);
    ok(g.expires === '2026-12-10' && g.day === T && g.renewals.length === 1, '更新すると期限が延び、認定日はそのまま');

    // 期間限定
    const r6 = E.proposeRule(d, { op: 'add', type: 'achievement', def: { name: '夏の実績', condition: 'x', period: { from: '2026-07-01', to: '2026-08-31' } }, today: T });
    E.decide(d, r6.id, { approve: true, reason: 'ok', today: T });
    ok(!E.canApply(d, d.achievements.find(a => a.name === '夏の実績').id, T).ok, '期間の外は申請できない');
    dom.window.close();
  }

  // ===== 画面と書き込み =====
  {
    console.log('画面と書き込み');
    const repo = makeRepo();
    repo.put('roadmap/gov/ministries.json', [{ tag: 'math', name: '数学省', order: 2 }, { tag: 'eng', name: '英語省', order: 1 }]);
    const dom = await boot(repo);
    const w = dom.window, doc = w.document, App = w.App;
    ok(doc.getElementById('ver').textContent === App.VERSION, '版が出る');
    ok(App.S.ministries[0].name === '英語省', '省を順番どおりに読む');
    ok(doc.querySelectorAll('[data-tab]').length === 5, 'タブが5つ');
    ok(/まだ実績が決まっていません/.test(doc.body.textContent), 'からっぽの一覧');

    click(w, '[data-tab="settings"]');
    click(w, '[data-act="propose-add"][data-type="achievement"]');
    ok(App.S.tab === 'review' && doc.getElementById('rule-form'), '申し出の欄が審査会議に出る');
    doc.getElementById('rf-name').value = '数検準1級';
    doc.getElementById('rf-cond').value = '合格する';
    doc.querySelector('input[name="rf-field"][value="math"]').checked = true;
    await App.Actions.ruleSubmit(); await tick();
    ok(repo.files['roadmap/apps/eiten/data.json'], 'データのファイルが作られる');
    ok(repo.json('roadmap/apps/eiten/data.json').reviews.length === 1, '申し出が書き込まれる');
    ok(!doc.getElementById('rule-form'), '出したら欄が閉じる');

    const rid = App.S.data.reviews[0].id;
    doc.getElementById('why-' + rid).value = '条件がはっきりしている';
    // 別の端末が先に書き込んだことにする → 読み直してやり直す
    repo.hooks.beforePut = () => { const j = repo.json('roadmap/apps/eiten/data.json'); j.parts.push({ id: 'p-x', name: '別の端末の部品' }); repo.put('roadmap/apps/eiten/data.json', j); };
    await App.Actions.decide(rid, true); await tick();
    const saved = repo.json('roadmap/apps/eiten/data.json');
    ok(saved.achievements.length === 1 && saved.parts.length === 1, 'ぶつかっても読み直して、両方の書き込みが残る');

    click(w, '[data-tab="settings"]');
    ok(/数検準1級/.test(doc.querySelector('main').textContent) && /数学省/.test(doc.querySelector('main').textContent), '設定に定義が出る');
    ok(!doc.querySelector('main input[type=text]'), '設定には直接書く欄がない');

    click(w, '[data-tab="review"]');
    const achId = App.S.data.achievements[0].id;
    doc.getElementById('ap-ach').value = achId;
    doc.getElementById('ap-evi').value = '合格証';
    await App.Actions.apply(); await tick();
    const rid2 = App.S.data.reviews.find(r => r.kind === 'apply').id;
    doc.getElementById('why-' + rid2).value = '';
    await App.Actions.decide(rid2, true); await tick();
    ok(App.S.data.grants.length === 0, '理由なしの審査は書き込まれない');
    ok(doc.getElementById('toast').classList.contains('err'), '理由なしは知らせる');
    doc.getElementById('why-' + rid2).value = '合格証を確かめた';
    await App.Actions.decide(rid2, true); await tick();
    ok(repo.json('roadmap/apps/eiten/data.json').grants.length === 1, '認定が書き込まれる');
    ok(doc.querySelectorAll('details.log').length === 2, '記録が残る');

    click(w, '[data-tab="list"]');
    ok(doc.querySelector('.shelf .slot:not(.off) .m-got'), '一覧の棚に輝く勲章');
    click(w, '[data-act="field"][data-v="eng"]');
    ok(!doc.querySelector('.shelf'), '分野で絞り込める');

    // 書き込みがずっとぶつかる
    let count = 0;
    const orig = repo.fetch;
    w.fetch = async (u, o = {}) => { if(o.method === 'PUT'){ count++; return { ok: false, status: 409, json: async () => ({}) }; } return orig(u, o); };
    await App.save(d => d, 'テスト').catch(e => ok(/ぶつかり続けた/.test(e.message), 'やり直しは最大3回'));
    ok(count === 4, '最初の1回+やり直し3回');
    w.close();
  }

  // ===== 絵・樹形図・工房・演出(r2) =====
  {
    console.log('絵・樹形図・工房・演出');
    const repo = makeRepo();
    repo.put('roadmap/gov/ministries.json', [{ tag: 'eng', name: '英語省', order: 1 }, { tag: 'math', name: '数学省', order: 2 }]);
    const T = '2026-10-09';
    repo.put('roadmap/apps/eiten/data.json', { version: 1,
      achievements: [
        { id: 'a1', name: '英検準1級', fields: ['eng'], condition: '合格', requires: [], period: null, art: null, renewDays: null },
        { id: 'a2', name: 'TOEFL100', fields: ['eng'], condition: '100点', requires: ['a1'], period: null, art: null, renewDays: null },
        { id: 'm1', name: '数検準1級', fields: ['math'], condition: '合格', requires: [], period: null, art: null, renewDays: null },
        { id: 'm2', name: '英語で数学', fields: ['math'], condition: '英語の数学書を1冊', requires: ['m1', 'a2'], period: null, art: null, renewDays: null } ],
      challenges: [{ id: 'c1', name: '海外留学', fields: ['eng'], condition: '留学', requires: ['a1', 'a2'], period: null, art: null, uses: 2, cooldownDays: 30, validDays: null }],
      parts: [], arts: [], grants: [{ achId: 'a1', day: T, evidence: 'x', reviewId: 'r0', expires: null, renewals: [] }], rights: [], reviews: [], rules: [] });
    const dom = await boot(repo);
    const w = dom.window, doc = w.document, App = w.App, { A, E } = App;

    // 最初からの部品
    const kinds = k => A.BUILTIN.filter(p => p.kind === k).map(p => p.name);
    ok(['円章','盾','星','六角形','菱形','旗'].every(n => kinds('形').includes(n)), '形がそろっている');
    ok(['本','地球','ペン','剣','山','炎','波','歯車','家','星','王冠'].every(n => kinds('紋').includes(n)), '紋がそろっている');
    ok(['光の筋','月桂樹','綬(リボン)','小さな星','縁取り(一重)','縁取り(二重)','縁取り(刻み)','縁取り(粒)'].every(n => kinds('飾り').includes(n)), '飾りがそろっている');
    ok(A.BUILTIN.every(p => !/NaN|undefined/.test(A.partSvg(p))), 'どの部品も描ける');
    ok(/<mask/.test(A.partSvg(A.builtin('b-chikyu'))), 'くり抜きはマスクで描く');
    const art = { layers: [{ part: 'b-chikyu', x: 50, y: 50, s: 1, rot: 0, metal: 'silver' }], text: { str: '誉', y: 60 } };
    ok(!/<mask/.test(A.artSvg(art, id => A.builtin(id), { mode: 'shadow' })), '影ではくり抜かない');
    ok(A.artSvg(art, id => A.builtin(id)).includes(A.METALS.silver[2]), '地金の色を塗り替えられる');
    ok(A.metal('#2b4a86')[1] === '#2b4a86' && /^hsl/.test(A.metal('#2b4a86')[0]), '好きな色から地金の3色を作る');
    ok(/C/.test(A.pathD([[0,0],[10,0],[10,10]], true, true)) && !/C/.test(A.pathD([[0,0],[10,0]], false, false)), '曲線となめらかでない線');

    // 樹形図の並び
    const L = App.treeLayout(App.S.data, 'all', T);
    const dep = k => L.nodes.find(n => n.key === k).depth;
    ok(dep('a:a1') === 0 && dep('a:a2') === 1 && dep('a:m2') === 2 && dep('c:c1') === 2, '必要実績の深さで段が決まる');
    ok(L.edges.find(e => e.from === 'a:a1' && e.to === 'a:a2').on && !L.edges.find(e => e.from === 'a:a2').on, '持っている実績からの線は光る');
    const Lm = App.treeLayout(App.S.data, 'math', T);
    ok(Lm.nodes.find(n => n.key === 'a:a2').outside && Lm.nodes.find(n => n.key === 'a:a1').outside && !Lm.nodes.find(n => n.key === 'c:c1'), '分野ごとの図では、ほかの分野の前提を薄く出す');

    click(w, '[data-tab="tree"]');
    ok(doc.querySelectorAll('.tree [data-node]').length === 5, 'すべての図に5つ');
    ok(doc.querySelector('[data-node="a:a1"]').classList.contains('tn-got') && doc.querySelector('[data-node="a:a2"]').classList.contains('tn-open') && doc.querySelector('[data-node="a:m2"]').classList.contains('tn-locked'), '状態で色分け');
    click(w, '[data-node="c:c1"]');
    const det = doc.getElementById('tree-detail').textContent;
    ok(/留学/.test(det) && /持っている:英検準1級/.test(det) && /まだ:TOEFL100/.test(det) && /鍵がかかっている/.test(det), '押すと達成条件・必要実績・状態が出る');
    click(w, '[data-node="a:a2"]');
    click(w, '[data-act="goto-apply"]');
    ok(App.S.tab === 'review' && doc.getElementById('ap-ach').value === 'a2', '目指せる実績から申請へ');
    click(w, '[data-tab="tree"]'); ok(doc.getElementById('tree-detail'), '選んだものは覚えている');
    click(w, '[data-act="goto-def"]');
    ok(App.S.tab === 'settings' && doc.getElementById('def-a2'), '設定で見る');
    click(w, '[data-tab="tree"]'); click(w, '[data-act="field"][data-v="math"]');
    ok(doc.querySelectorAll('.tree .tn-out').length === 2, '分野の切り替え');
    click(w, '[data-act="field"][data-v="all"]');

    // 部品の工房
    click(w, '[data-tab="studio"]');
    ok(doc.getElementById('st-canvas') && doc.querySelectorAll('#st-panel .thumb').length === A.BUILTIN.length, '部品の棚に最初の部品が並ぶ');
    click(w, '[data-act="st-add-shape"][data-v="circle"]');
    click(w, '[data-act="st-add-shape"][data-v="star"]');
    ok(App.S.st.part.shapes.length === 2 && App.S.st.sel === 1, '図形を置ける');
    const r = doc.querySelector('#st-panel input[data-f="r2"]'); r.value = '6'; r.dispatchEvent(new w.Event('input', { bubbles: true }));
    ok(App.S.st.part.shapes[1].r2 === 6 && /polygon/.test(doc.getElementById('st-canvas').innerHTML), 'つまみで形を変えると絵が変わる');
    doc.querySelector('#st-panel input[data-f="cut"]').click();
    ok(App.S.st.part.shapes[1].cut && /<mask/.test(doc.getElementById('st-canvas').innerHTML), 'くり抜ける');
    click(w, '[data-act="st-color"][data-target="fill"][data-v="m1"]');
    click(w, '[data-act="st-down"][data-i="1"]');
    ok(App.S.st.part.shapes[0].t === 'star' && App.S.st.sel === 0, '重なりの順を変えられる');
    click(w, '[data-act="st-up"][data-i="0"]');
    await App.Studio.savePart(); await tick();
    ok(/名前/.test(doc.getElementById('toast').textContent), '名前がないとしまえない');
    const nm = doc.querySelector('#st-panel input[data-f="name"]'); nm.value = '星の穴'; nm.dispatchEvent(new w.Event('input', { bubbles: true }));
    const pid = await App.Studio.savePart(); await tick();
    ok(pid && repo.json('roadmap/apps/eiten/data.json').parts[0].name === '星の穴' && !App.S.st.dirty, '部品の棚にしまえる');
    App.Studio.pickPart('b-oukan');
    ok(App.S.st.part.id === null && /直し/.test(App.S.st.part.name) && App.S.st.part.shapes.length === 5, '最初の部品を直すと新しい部品になる');
    App.Studio.newPart();
    click(w, '[data-act="st-add-shape"][data-v="path"]');
    const n0 = App.S.st.part.shapes[0].pts.length;
    click(w, '[data-act="st-pt-add"]');
    ok(App.S.st.part.shapes[0].pts.length === n0 + 1 && doc.querySelectorAll('#st-canvas .handle').length === n0 + 1, '曲線の点を足せる・つまむ丸が出る');
    App.S.st.dirty = false;

    // 勲章の工房
    click(w, '[data-act="st-mode"][data-v="art"]');
    click(w, '[data-act="st-add-layer"][data-id="b-enshou"]');
    click(w, `[data-act="st-add-layer"][data-id="${pid}"]`);
    click(w, '[data-act="st-metal"][data-v="bronze"]');
    ok(App.S.st.art.layers.length === 2 && App.S.st.art.layers[1].metal === 'bronze', '部品を重ね、地金を選べる');
    const xs = doc.querySelector('#st-panel input[data-o="layer"][data-f="x"]'); xs.value = '40'; xs.dispatchEvent(new w.Event('input', { bubbles: true }));
    ok(App.S.st.art.layers[1].x === 40, '位置を動かせる');
    const tx = doc.querySelector('#st-panel input[data-o="text"][data-f="str"]'); tx.value = '英'; tx.dispatchEvent(new w.Event('input', { bubbles: true }));
    const an = doc.querySelector('#st-panel input[data-o="art"][data-f="name"]'); an.value = '英語の勲章'; an.dispatchEvent(new w.Event('input', { bubbles: true }));
    const aid = await App.Studio.saveArt(); await tick();
    ok(aid && repo.json('roadmap/apps/eiten/data.json').arts[0].layers.length === 2, '勲章をしまえる');
    App.Studio.mode('part'); App.Studio.pickPart(pid);
    await App.Studio.delPart(); await tick();
    ok(App.S.data.parts.length === 1, '使っている部品は消せない');
    App.Studio.mode('art');

    // 勲章を実績に結びつける(審査会議を通す)
    click(w, '[data-tab="settings"]');
    click(w, '[data-act="propose-edit"][data-id="a2"]');
    doc.getElementById('rf-art').value = aid;
    await App.Actions.ruleSubmit(); await tick();
    ok(!App.S.data.achievements.find(a => a.id === 'a2').art, '申し出ただけでは結びつかない');
    const rr = App.S.data.reviews.find(x => x.kind === 'rule');
    ok(/英語の勲章/.test(doc.querySelector('.card.pending').textContent), '審査で勲章の変更が見える');
    doc.getElementById('why-' + rr.id).value = 'よい絵';
    await App.Actions.decide(rr.id, true); await tick();
    ok(App.S.data.achievements.find(a => a.id === 'a2').art === aid, '認めると勲章が結びつく');
    ok(!doc.getElementById('fanfare'), 'ルールの変更では演出は出ない');

    // 認定の演出
    doc.getElementById('ap-ach').value = 'a2'; doc.getElementById('ap-evi').value = 'スコア';
    await App.Actions.apply(); await tick();
    const ap = App.S.data.reviews.find(x => x.kind === 'apply');
    doc.getElementById('why-' + ap.id).value = '確認';
    await App.Actions.decide(ap.id, true); await tick();
    const fan = doc.getElementById('fanfare');
    ok(fan && /TOEFL100/.test(fan.textContent) && fan.querySelectorAll('.cf').length > 30 && fan.querySelector('.rays'), '認定で絵・光の筋・紙吹雪が出る');
    ok(fan.innerHTML.includes('viewBox="0 0 100 100"') && /認定/.test(fan.textContent), '結びついた勲章で出る');
    fan.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    ok(!doc.getElementById('fanfare'), '押すと閉じる');
    ok(App.S.data.rights.length === 1, '挑戦権も得る');
    click(w, '[data-tab="list"]');
    ok(doc.querySelectorAll('.shelf .slot:not(.off)').length === 2, '棚に2つ');
    App.S.st.dirty = false; App.Studio.mode('art'); App.Studio.pickArt(aid);
    await App.Studio.delArt(); await tick();
    ok(App.S.data.arts.length === 1, '実績に結びついた勲章は消せない');
    w.close();
  }

  {
    const repo = makeRepo();
    const dom = await boot(repo, false);
    ok(!dom.window.document.getElementById('conn').hidden, '接続していないと接続の欄が開く');
    dom.window.close();
  }

  console.log(`\n${pass}件 通過 / ${fail}件 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
