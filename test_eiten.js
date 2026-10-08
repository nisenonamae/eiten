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
    ok(doc.getElementById('ver').textContent === '2026-10-09 r1', '版が出る');
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

  {
    const repo = makeRepo();
    const dom = await boot(repo, false);
    ok(!dom.window.document.getElementById('conn').hidden, '接続していないと接続の欄が開く');
    dom.window.close();
  }

  console.log(`\n${pass}件 通過 / ${fail}件 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
