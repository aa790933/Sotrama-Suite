import test from 'tape';
import fs from 'fs';

test('HostSetup has host/client role selection', (t) => {
  const vue = fs.readFileSync('src/pages/HostSetup.vue', 'utf-8');
  t.ok(vue.includes(`role: null as HostType`), 'has role state');
  t.ok(vue.includes(`selectRole`), 'has selectRole method');
  t.ok(vue.includes(`data-testid="role-host"`), 'has host card');
  t.ok(vue.includes(`data-testid="role-client"`), 'has client card');
  t.ok(vue.includes(`This is the office/server computer (Host)`), 'host label');
  t.ok(vue.includes(`This computer is a client`), 'client label');
  t.ok(vue.includes(`getLanIp`), 'fetches LAN IP');
  t.ok(vue.includes(`lanIp`), 'has lanIp state');
  t.ok(vue.includes(`role === 'host'`), 'host conditional');
  t.ok(vue.includes(`role === 'client'`), 'client conditional');
  t.end();
});

test('HostSetup client never installs MariaDB locally', (t) => {
  const vue = fs.readFileSync('src/pages/HostSetup.vue', 'utf-8');
  // Express install should be host-only
  t.ok(vue.includes(`role === 'host' && mode === 'express'`), 'express host-only');
  // Client forces advanced
  t.ok(vue.includes(`if (role === 'client')`) && vue.includes(`this.mode = 'advanced'`), 'client forces advanced');
  t.end();
});

test('HostSetup persists hostRole', (t) => {
  const vue = fs.readFileSync('src/pages/HostSetup.vue', 'utf-8');
  t.ok(vue.includes(`fyo.config.set('hostRole'`), 'persists hostRole');
  t.ok(vue.includes(`fyo.config.get('hostRole'`), 'restores hostRole');
  t.end();
});

test('ConfigMap has hostRole', (t) => {
  const types = fs.readFileSync('fyo/core/types.ts', 'utf-8');
  t.ok(types.includes(`hostRole`), 'ConfigMap has hostRole');
  t.ok(types.includes(`'host' | 'client'`) || types.includes(`HostType`), 'host/client type');
  t.end();
});

test('App handles host/client and safe display', (t) => {
  const app = fs.readFileSync('src/App.vue', 'utf-8');
  t.ok(app.includes(`getSafeConfigDetail`), 'App uses safe detail');
  t.ok(app.includes(`hostRole`) || app.includes(`HostSetup`), 'App references host setup');
  t.end();
});

test('IPC getLanIp exists', (t) => {
  const preload = fs.readFileSync('main/preload.ts', 'utf-8');
  const messages = fs.readFileSync('utils/messages.ts', 'utf-8');
  const router = fs.readFileSync('main/ipc/router.ts', 'utf-8');
  t.ok(preload.includes('getLanIp'), 'preload has getLanIp');
  t.ok(messages.includes('GET_LAN_IP'), 'messages has GET_LAN_IP');
  t.ok(router.includes('GET_LAN_IP'), 'router handles GET_LAN_IP');
  t.ok(router.includes('detectLanIp'), 'router uses detectLanIp');
  t.end();
});
