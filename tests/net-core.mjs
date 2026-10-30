// 프로토콜 코어 시험: 유실·중복·지연·끊김이 있는 가짜 네트워크에서 방 모으기, 시드 합의, 입력 기록 복제, 복구를 확인한다.
// 사용: node tests/net-core.mjs [반복 수=30]
import { SimNet } from './lib/simnet.mjs';
import { makeCode } from '../src/net/room.js';

const REPS = Number(process.argv[2] || 30);
const fails = [];
const check = (cond, msg, ctx) => { if (!cond) fails.push({ msg, ...ctx }); return cond; };
const streamsOf = n => n.core.streams.slice(0, n.core.ro.length).map(s => JSON.stringify(s));

function lobby(net, humans) {
  const host = net.addNode('Host');
  host.core.create(makeCode(n => net.rint(n)), { n: 4, hu: humans, ch: 0, df: 'normal', ef: 0 });
  host.core.tick();
  const guests = [];
  for (let i = 1; i < humans; i++) {
    const g = net.addNode('Guest' + i);
    g.core.join(host.core.code); guests.push(g);
    net.run(3000);
  }
  return { host, guests };
}

let stats = { games: 0, entries: 0, maxBytes: 0 };
for (let rep = 0; rep < REPS; rep++) {
  const humans = 2 + (rep % 3);
  const net = new SimNet({ seed: 100 + rep, loss: 0.05 + (rep % 4) * 0.1, dup: 0.1, maxDelay: 150 + (rep % 5) * 200 });
  const { host, guests } = lobby(net, humans);
  const all = [host, ...guests];
  const ctx = { rep, humans };
  net.run(10000);
  check(host.core.ro.length === humans, '방장 명단 인원', { ...ctx, got: host.core.ro.length });
  check(guests.every(g => g.core.phase === 'lobby' && g.core.ro.length === humans), '참가자 로비 반영', ctx);

  // 정원이 찬 뒤 오는 사람은 거절
  const late = net.addNode('Late'); late.core.join(host.core.code);
  net.run(8000);
  if (humans < 4 || true) check(late.events.some(e => e.type === 'error' && ['full', 'started'].includes(e.data.code)), '정원 초과 거절', { ...ctx, ev: late.events.map(e => e.type + ':' + (e.data && e.data.code)) });
  net.nodes.delete('Late');

  // 시드 합의
  host.core.start();
  net.run(30000);
  const starts = all.map(n => n.events.find(e => e.type === 'start'));
  if (!check(starts.every(Boolean), '모두 시작 알림', { ...ctx, ev: all.map(n => n.events.map(e => e.type).join(',')) })) continue;
  check(new Set(starts.map(s => s.data.sd)).size === 1, '시드 일치', ctx);
  check(starts.every((s, i) => s.data.myIdx === s.data.ro.indexOf(all[i].sid) && s.data.myIdx >= 0), '좌석 번호', ctx);

  // 입력 기록 복제: 사람마다 자기 줄에 입력을 쌓는다(중간에 한 명이 잠깐 끊김)
  const seatOf = n => n.core.myIdx;
  const counts = all.map(() => 0);
  const target = 60 + (rep % 3) * 40;
  const isolated = { who: rep % humans, from: 2000, to: 9000 };
  let tt = 0;
  net.run(40000, () => {
    tt += 50;
    if (tt === isolated.from) net.isolate(all[isolated.who].name);
    if (tt === isolated.to) net.rejoinAll(all[isolated.who].name);
    all.forEach((n, i) => { if (counts[i] < target && net.rnd() < 0.03) { n.core.store.propose(0, counts[i], 't'); counts[i]++; } });
  });
  net.run(60000);
  stats.entries += counts.reduce((a, b) => a + b, 0);
  const ref = streamsOf(all[0]);
  all.forEach((n, i) => check(streamsOf(n).every((s, j) => s === ref[j]), '입력 기록 수렴', { ...ctx, node: n.name, lens: n.core.streams.map(s => s.length), ref: all[0].core.streams.map(s => s.length) }));
  check(all.every((n, i) => all[0].core.streams[seatOf(n)].length === counts[i]), '입력 개수', { ...ctx, got: all[0].core.streams.map(s => s.length), counts });
  stats.maxBytes = Math.max(stats.maxBytes, net.maxBytes);
  stats.games++;
}
check(stats.maxBytes <= 4096, '상태 크기 4KiB 이하', { max: stats.maxBytes });

// 보내던 사람이 사라져도 다른 사람이 대신 전달 (중계)
{
  const net = new SimNet({ seed: 7, loss: 0.1 });
  const { host, guests } = lobby(net, 3); const all = [host, ...guests];
  host.core.start(); net.run(12000);
  const [h, g1, g2] = all;
  net.partition(g1.name, g2.name);               // g1 의 소식은 방장에게만 간다
  for (let i = 0; i < 20; i++) { g1.core.store.propose(0, i, 'm1.' + i); net.run(300); }
  net.run(8000);
  check(h.core.streams[1].length === 20 && g2.core.streams[1].length === 0, '중계 준비 상태', { h: h.core.streams[1].length, g2: g2.core.streams[1].length });
  net.kill(g1.name); net.forget(g1.name);
  net.run(40000);
  check(g2.core.streams[1].length === 20, '끊긴 사람의 입력을 다른 참가자가 대신 전달', { got: g2.core.streams[1].length });
}

// 기록을 잃은 채 다시 들어온 사람이 자기 기록을 되찾음
{
  const net = new SimNet({ seed: 9, loss: 0.1 });
  const { host, guests } = lobby(net, 3); const all = [host, ...guests];
  host.core.start(); net.run(12000);
  for (let i = 0; i < 30; i++) { all.forEach((n, j) => n.core.store.propose(0, i, 't')); net.run(200); }
  net.run(10000);
  const code = host.core.code, g = guests[0];
  const lostSid = g.name; net.kill(lostSid); net.forget(lostSid); net.nodes.delete(lostSid);
  net.run(20000);
  const back = net.addNode(lostSid);                         // 같은 이름 → 같은 sid, 저장 기록 없음
  back.core.join(code);
  net.run(30000);
  const st = back.events.find(e => e.type === 'start');
  check(!!st, '복귀자에게 시작 알림', { ev: back.events.map(e => e.type + ':' + (e.data && e.data.code)) });
  check(back.core.streams.slice(0, 3).every((s, i) => s.length === 30), '복귀자의 기록 복구', { lens: back.core.streams.map(s => s.length) });
  check(back.core.myIdx === 1, '복귀자 좌석', { idx: back.core.myIdx });
}

// 오래 끊겼다 돌아온 사람이 긴 기록(수백 개)을 창 단위로 따라잡는다 + 상태 크기가 한도를 넘지 않는다
{
  const net = new SimNet({ seed: 21, loss: 0.1 });
  const { host, guests } = lobby(net, 4); const all = [host, ...guests];
  host.core.start(); net.run(30000);
  const lag = all[3];
  net.isolate(lag.name);
  for (let i = 0; i < 400; i++) { all.slice(0, 3).forEach(n => n.core.store.propose(0, i, 'm' + (i % 5) + '.' + (i % 90))); net.run(60); }
  net.run(15000);
  net.rejoinAll(lag.name);
  net.run(120000);
  const ref = streamsOf(all[0]);
  check(all.every(n => streamsOf(n).every((s, j) => s === ref[j])), '긴 기록 따라잡기', { lens: lag.core.streams.map(s => s.length), ref: all[0].core.streams.map(s => s.length) });
  check(net.maxBytes <= 4096, '긴 기록에서도 상태 크기 4KiB 이하', { max: net.maxBytes });
  console.log(`  긴 기록 따라잡기: 기록 ${all[0].core.streams.reduce((a, s) => a + s.length, 0)}개, 상태 최대 ${net.maxBytes}바이트`);
}

// 해시 대조: 다른 값이 오면 알림
{
  const net = new SimNet({ seed: 11, loss: 0 });
  const { host, guests } = lobby(net, 2); const all = [host, ...guests];
  host.core.start(); net.run(12000);
  host.core.store.reportHash(5, 'aaaaaaaaaaaaaaaa'); guests[0].core.store.reportHash(5, 'bbbbbbbbbbbbbbbb');
  net.run(10000);
  check(all.every(n => n.events.some(e => e.type === 'desync')), '해시 불일치 알림', {});
  const net2 = new SimNet({ seed: 12, loss: 0 });
  const l2 = lobby(net2, 2); l2.host.core.start(); net2.run(12000);
  l2.host.core.store.reportHash(5, 'cccccccccccccccc'); l2.guests[0].core.store.reportHash(5, 'cccccccccccccccc'); net2.run(10000);
  check(![l2.host, ...l2.guests].some(n => n.events.some(e => e.type === 'desync')), '같은 해시는 알림 없음', {});
}

// 앱(규칙) 버전이 다르면 같은 방에 못 들어온다
{
  const net = new SimNet({ seed: 31, loss: 0 });
  const host = net.addNode('Host');
  host.core.create(makeCode(n => net.rint(n)), { n: 2, hu: 2, ch: 0, df: 'normal', ef: 0 });
  host.core.tick();
  const old = net.addNode('Guestold');
  old.core.rulesVer = 1; old.core.appVer = '1.00';                // 예전 버전 참가자
  old.core.join(host.core.code);
  net.run(8000);
  check(old.events.some(e => e.type === 'error' && e.data.code === 'version'), '버전 다른 참가자는 입장 거절(참가자 쪽 안내)', { ev: old.events.map(e => e.type + ':' + (e.data && e.data.code)) });
  check(host.events.some(e => e.type === 'error' && e.data.code === 'peerversion'), '방장에게도 버전 다른 사람이 왔다고 알림', {});
  check(host.core.ro.length === 1, '버전 다른 사람은 명단에 안 들어감', { ro: host.core.ro.length });
  const ok = net.addNode('Guestnew'); ok.core.join(host.core.code); net.run(8000);
  check(host.core.ro.length === 2, '같은 버전 참가자는 들어옴', {});
}

// 말도 안 되는 값은 걸러짐
{
  const { cleanState, cleanText, cleanEntry, normCode } = await import('../src/net/room.js');
  check(cleanState({ a: 'aug1', s: 'ABCDEFGH', n: '<b>x</b>'.repeat(5), t: 1, __proto__: { x: 1 }, e: [0, [0, 1, 't'], [0, 'x', 1], [0, 2, 't']] }).e.list.length === 1, '잘못된 입력 항목은 거기서 끊음', {});
  check(cleanState({ a: 'aug1', s: 'ABCDEFGH', n: '<script>alert(1)</script>', t: 1 }).n.indexOf('<') < 0, '이름에서 꺾쇠 제거', {});
  check(cleanState({ a: 'other', s: 'ABCDEFGH' }) === null, '다른 앱 상태 무시', {});
  check(cleanState({ a: 'aug1', s: '../../x' }) === null, '이상한 id 무시', {});
  check(cleanEntry([0, 5, 'x'.repeat(40)]) === null && cleanEntry([0, 5, '<img>']) === null && cleanEntry([2, 1, 1]) === null && cleanEntry([0, -1, 1]) === null, '입력 항목 검사', {});
  check(cleanText('a\u0000b‮c'.repeat(10), 8).length <= 8, '이름 길이·제어문자', {});
  check(normCode('ab0c') === 'ABC' && normCode(' x-y z!w ') === 'XYZW', '방 코드 정리', { got: normCode('ab0c') });
}

console.log(`프로토콜 코어: ${stats.games}/${REPS}판 시뮬 · 입력 ${stats.entries}개 복제 · 상태 최대 ${stats.maxBytes}바이트`);
if (fails.length) { console.log('실패', fails.length); console.log(JSON.stringify(fails.slice(0, 6), null, 1)); process.exit(1); }
console.log('프로토콜 코어 통과');
