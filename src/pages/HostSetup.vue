<template>
  <div
    class="flex-1 flex justify-center items-center bg-background min-h-screen p-6"
  >
    <Card class="w-full max-w-lg shadow-lg">
      <CardHeader>
        <CardTitle class="text-2xl">
          {{ t`Host Setup` }}
        </CardTitle>
        <CardDescription>
          {{
            mode === 'express'
              ? t`Sotrama Suite will install and configure MariaDB for you with a dedicated least-privilege account.`
              : t`Connect Sotrama Suite to your existing MariaDB/MySQL server. No installer runs.`
          }}
        </CardDescription>
        <div
          v-if="errorMsg"
          class="mt-4 p-3 text-sm text-destructive-foreground bg-destructive/10 rounded-lg border border-destructive/30"
        >
          {{ errorMsg }}
        </div>
      </CardHeader>
      <CardContent>
        <!-- Step 1: Host vs Client -->
        <div v-if="!role" class="space-y-3">
          <h2 class="text-sm font-semibold text-foreground">
            {{ t`How will this computer use Sotrama?` }}
          </h2>
          <div
            data-testid="role-host"
            class="p-4 rounded-lg border-2 cursor-pointer transition-colors hover:bg-accent"
            :class="role === 'host' ? 'border-primary bg-accent' : 'border-border'"
            @click="selectRole('host')"
          >
            <p class="text-sm font-medium text-foreground">{{ t`This is the office/server computer (Host)` }}</p>
            <p class="text-xs text-muted-foreground mt-1">{{ t`MariaDB will be installed here. Other computers on the office network will connect to this machine.` }}</p>
          </div>
          <div
            data-testid="role-client"
            class="p-4 rounded-lg border-2 cursor-pointer transition-colors hover:bg-accent"
            :class="role === 'client' ? 'border-primary bg-accent' : 'border-border'"
            @click="selectRole('client')"
          >
            <p class="text-sm font-medium text-foreground">{{ t`This computer is a client` }}</p>
            <p class="text-xs text-muted-foreground mt-1">{{ t`Do not install MariaDB here. Connect to the Sotrama host already running on the local network.` }}</p>
          </div>
        </div>

        <template v-else>
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">
              <Badge variant="secondary">{{ role === 'host' ? t`Host mode` : t`Client mode` }}</Badge>
              <span v-if="lanIp && role === 'host'" class="ms-2 font-mono">({{ lanIp }})</span>
            </span>
            <Button
              variant="link"
              size="sm"
              :disabled="installing"
              @click="role = null"
            >
              {{ t`Change` }}
            </Button>
          </div>

          <!-- Mode Selection Tabs (host only: Express vs Advanced; client is always Advanced) -->
          <div
            v-if="role === 'host'"
            class="mt-4 flex gap-6 border-b border-border pb-3"
          >
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                v-model="mode"
                type="radio"
                value="express"
                :disabled="installing"
                class="accent-primary"
              />
              <span
                class="text-sm font-medium text-foreground"
                >{{ t`Express setup (install locally)` }}</span
              >
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                v-model="mode"
                type="radio"
                value="advanced"
                data-testid="advanced-mode-radio"
                :disabled="installing"
                class="accent-primary"
              />
              <span
                class="text-sm font-medium text-foreground"
                >{{ t`Advanced (existing server)` }}</span
              >
            </label>
          </div>
          <div v-else class="mt-4 pb-3 border-b border-border">
            <p class="text-sm font-medium text-foreground">{{ t`Connect to office host` }}</p>
            <p class="text-xs text-muted-foreground mt-1">{{ t`Enter the host address shown on the server computer.` }}</p>
          </div>

          <!-- Option A: Express install (host only) -->
          <template v-if="role === 'host' && mode === 'express' && !done">
          <div class="mt-4 space-y-4">
            <p class="text-xs text-muted-foreground leading-relaxed">
              {{
                t`Requires internet access to download and run the MariaDB installer. Only Windows can install fully offline when the bundled MSI is present; macOS (Homebrew) and Linux (apt/dnf) both require live internet access on the host at install time.`
              }}
            </p>

            <div>
              <label
                class="block text-sm font-medium text-foreground"
                >{{ t`Port` }}</label
              >
              <Input
                v-model.number="port"
                type="number"
                :disabled="installing"
                class="mt-1"
              />
              <p
                v-if="portMessage"
                class="text-xs text-amber-600 dark:text-amber-400 mt-1"
              >
                {{ portMessage }}
              </p>
            </div>

            <div>
              <label
                class="block text-sm font-medium text-foreground"
                >{{ t`Database name` }}</label
              >
              <Input
                v-model="database"
                placeholder="sotrama"
                :disabled="installing"
                class="mt-1"
              />
              <p class="text-xs text-muted-foreground mt-1">
                {{
                  t`Sotrama Suite will generate and manage dedicated credentials automatically.`
                }}
              </p>
            </div>

            <Button
              :disabled="installing || !port || !database"
              class="w-full mt-2"
              @click="expressInstall"
            >
              {{ installLabel }}
            </Button>

            <div
              v-if="installStage"
              class="mt-2 text-xs text-muted-foreground flex items-center gap-2"
            >
              <span
                class="inline-block w-2 h-2 rounded-full bg-primary animate-pulse"
              ></span>
              <span>{{ installStage }}</span>
            </div>
          </div>
        </template>

        <!-- Option B: Advanced connection -->
        <template v-else-if="mode === 'advanced' && !done">
          <div class="mt-4 space-y-3">
            <div>
              <label
                class="block text-sm font-medium text-foreground"
                >{{ t`Host` }}</label
              >
              <Input
                v-model="host"
                placeholder="127.0.0.1"
                data-testid="host-input"
                class="mt-1"
              />
            </div>
            <div>
              <label
                class="block text-sm font-medium text-foreground"
                >{{ t`Port` }}</label
              >
              <Input
                v-model.number="port"
                data-testid="port-input"
                type="number"
                class="mt-1"
              />
            </div>
            <div>
              <label
                class="block text-sm font-medium text-foreground"
                >{{ t`Database name` }}</label
              >
              <Input
                v-model="database"
                placeholder="sotrama"
                data-testid="database-input"
                class="mt-1"
              />
            </div>
            <div>
              <label
                class="block text-sm font-medium text-foreground"
                >{{ t`User` }}</label
              >
              <Input
                v-model="user"
                data-testid="user-input"
                class="mt-1"
              />
            </div>
            <div>
              <label
                class="block text-sm font-medium text-foreground"
                >{{ t`Password` }}</label
              >
              <Input
                v-model="password"
                type="password"
                data-testid="password-input"
                class="mt-1"
              />
            </div>

            <Button
              :disabled="testing || !host || !port || !database || !user"
              class="w-full mt-2"
              @click="advancedTest"
              data-testid="test-connection-button"
            >
              {{ testing ? t`Testing…` : t`Test connection` }}
            </Button>

            <p
              v-if="testOk && dbExistsChecked && dbExists"
              class="text-sm font-medium text-green-600 dark:text-green-400"
            >
              {{ t`Connection successful — database ready. Press Continue below.` }}
            </p>
            <p
              v-else-if="testDone && !testOk"
              class="text-sm text-destructive"
            >
              {{ testError }}
            </p>
            <div v-if="testDone && dbExistsChecked" class="mt-2 text-sm">
              <p v-if="dbExists" class="text-green-600 dark:text-green-400">
                {{ t`Database exists and is accessible.` }}
              </p>
              <div v-else class="flex items-center gap-3">
                <p class="text-amber-600 dark:text-amber-400">
                  {{ t`Database does not exist on this server.` }}
                </p>
                <Button
                  size="sm"
                  :disabled="creatingDb"
                  data-testid="create-db-button"
                  @click="createTargetDatabase"
                >
                  {{ creatingDb ? t`Creating…` : t`Create database` }}
                </Button>
              </div>
            </div>
          </div>
        </template>

        <!-- Summary card (express) -->
        <Card
          v-if="done"
          class="mt-4 bg-muted/50"
        >
          <CardContent class="pt-6">
          <div class="flex items-center gap-2 mb-3">
            <Badge variant="secondary">{{ t`Setup complete` }}</Badge>
          </div>

          <dl
            class="space-y-2 text-sm"
          >
            <div class="flex justify-between pt-2">
              <dt class="text-muted-foreground">{{ t`Host` }}</dt>
              <dd class="font-medium text-foreground">
                {{ lanIp || '127.0.0.1' }}
              </dd>
            </div>
            <div class="flex justify-between pt-2">
              <dt class="text-muted-foreground">
                {{ t`Allocated port` }}
              </dt>
              <dd class="font-medium text-foreground">
                {{ summary?.port }}
              </dd>
            </div>
            <div class="flex justify-between pt-2">
              <dt class="text-muted-foreground">
                {{ t`Database` }}
              </dt>
              <dd class="font-medium text-foreground">
                {{ summary?.database }}
              </dd>
            </div>
            <div class="flex justify-between pt-2">
              <dt class="text-muted-foreground">
                {{ t`App user` }}
              </dt>
              <dd class="font-medium text-foreground">
                sotrama_app
              </dd>
            </div>
            <div class="flex justify-between items-center pt-2">
              <dt class="text-muted-foreground">
                {{ t`App password` }}
              </dt>
              <dd class="flex items-center gap-2">
                <span
                  class="font-mono text-xs text-foreground break-all bg-muted px-2 py-1 rounded"
                >
                  {{ summary?.appPassword }}
                </span>
                <Button
                  variant="link"
                  size="sm"
                  @click="copyPassword"
                >
                  {{ copied ? t`Copied!` : t`Copy` }}
                </Button>
              </dd>
            </div>
          </dl>

          <div
            class="mt-4 pt-3 border-t border-border space-y-2"
          >
            <p class="text-xs text-muted-foreground">
              {{
                t`Share the app credentials above with LAN clients — they must never use root.`
              }}
            </p>
            <p class="text-xs text-muted-foreground leading-relaxed">
              {{
                t`Security: bind-address is set to 0.0.0.0. Inbound access is restricted to your local network via OS Firewall rules and SQL grant privileges.`
              }}
            </p>
          </div>
          </CardContent>
        </Card>

        <Button
          v-if="canContinue"
          class="w-full mt-6"
          @click="finish"
          data-testid="continue-button"
        >
          {{ t`Continue to company setup` }}
        </Button>
        </template>
      </CardContent>
    </Card>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { t } from 'fyo';
import { IPC_ACTIONS } from 'utils/messages';
import type { ConnectionConfig, HostType } from '../setup/types';
import { canInstallMariaDB, normalizeHostRole } from '../utils/hostRole';
import { fyo } from 'src/initFyo';
import Button from 'src/components/ui/button/Button.vue';
import Card from 'src/components/ui/card/Card.vue';
import CardContent from 'src/components/ui/card/CardContent.vue';
import CardDescription from 'src/components/ui/card/CardDescription.vue';
import CardHeader from 'src/components/ui/card/CardHeader.vue';
import CardTitle from 'src/components/ui/card/CardTitle.vue';
import Badge from 'src/components/ui/badge/Badge.vue';
import Input from 'src/components/ui/input/Input.vue';

import type { IPC } from 'main/preload';

declare const ipc: IPC;

type ProgressPayload = {
  percent?: number;
  downloaded?: number;
  total?: number;
  stage?: string;
};

function genPassword(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function withIpcTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s.`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export default defineComponent({
  name: 'HostSetup',
  components: {
    Button,
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    Badge,
    Input,
  },
  emits: ['host-ready'],
  data() {
    return {
      role: null as HostType | null,
      lanIp: null as string | null,
      mode: 'express' as 'express' | 'advanced',
      port: 3306,
      database: 'sotrama',
      // express credentials
      rootPassword: '',
      appPassword: '',
      // advanced credentials
      host: '127.0.0.1',
      user: 'root',
      password: '',
      // process indicators
      installing: false,
      isDownloading: false,
      installStage: '',
      progressPercent: 0,
      portMessage: '',
      done: false,
      testing: false,
      testOk: false,
      testDone: false,
      testError: '',
      dbExists: null as boolean | null,
      dbExistsChecked: false,
      creatingDb: false,
      errorMsg: '',
      copied: false,
      summary: null as null | {
        port: number;
        database: string;
        appPassword: string;
      },
    };
  },
  computed: {
    installChannel(): string {
      return IPC_ACTIONS.INSTALL_MARIA_DB;
    },
    installLabel(): string {
      if (this.isDownloading) {
        return `${t`Downloading MariaDB…`} ${Math.round(
          this.progressPercent
        )}%`;
      }
      if (this.installing) {
        return t`Installing MariaDB…`;
      }
      return t`Install MariaDB`;
    },
    canContinue(): boolean {
      if (!this.role) return false;
      if (this.role === 'host' && this.mode === 'express') return this.done;
      if (!this.testOk) return false;
      // For advanced (both host and client), require DB to exist or be creatable
      if (this.dbExists === false) return false;
      return true;
    },
  },
  async mounted() {
    try {
      const ip = await ipc.getLanIp();
      if (ip) this.lanIp = ip;
    } catch {}
    const saved = normalizeHostRole(fyo.config.get('hostRole'));
    if (saved) {
      this.role = saved;
      this.applyRoleSideEffects(saved);
    }
  },
  beforeUnmount() {
    this.cleanupListeners();
  },
  methods: {
    selectRole(role: HostType) {
      this.role = role;
      fyo.config.set('hostRole', role);
      this.applyRoleSideEffects(role);
    },
    applyRoleSideEffects(role: HostType) {
      if (role === 'client') {
        this.mode = 'advanced';
        if (this.host === '127.0.0.1') this.host = '';
      } else {
        if (!this.host) this.host = '127.0.0.1';
      }
      this.testOk = false;
      this.testDone = false;
      this.testError = '';
      this.dbExists = null;
      this.dbExistsChecked = false;
      this.done = false;
      this.errorMsg = '';
    },
    t(str: TemplateStringsArray | string) {
      return typeof str === 'string' ? t(str) : t(str);
    },

    cleanupListeners() {
      if (typeof ipc !== 'undefined' && ipc.removeMariaDBProgressListener) {
        ipc.removeMariaDBProgressListener(this.installChannel);
      }
    },

    async copyPassword() {
      if (this.summary?.appPassword) {
        await navigator.clipboard.writeText(this.summary.appPassword);
        this.copied = true;
        setTimeout(() => {
          this.copied = false;
        }, 2000);
      }
    },

    async advancedTest() {
      this.testing = true;
      this.testOk = false;
      this.testDone = false;
      this.testError = '';
      this.dbExists = null;
      this.dbExistsChecked = false;
      try {
        const ping = await withIpcTimeout(
          ipc.pingMariaDB({
            host: this.host,
            port: this.port,
            user: this.user,
            password: this.password,
          }),
          30000
        );
        if (!ping.ok) {
          this.testOk = false;
          this.testError = ping.error || '';
          return;
        }
        try {
          const dbCheck = await withIpcTimeout(
            ipc.checkDbExists({
              host: this.host,
              port: this.port,
              user: this.user,
              password: this.password,
              database: this.database.trim(),
            }),
            30000
          );
          this.dbExists = dbCheck.exists;
          this.dbExistsChecked = true;
          if (dbCheck.exists) {
            this.testOk = true;
            this.testError = '';
          } else {
            this.testOk = false;
            this.testError = dbCheck.error
              ? `Database "${this.database.trim()}" not found: ${dbCheck.error}`
              : `Database "${this.database.trim()}" does not exist on this server.`;
          }
        } catch (err) {
          this.testOk = false;
          this.testError = (err as Error).message || String(err);
        }
      } catch (err) {
        this.testOk = false;
        this.testError = (err as Error).message || String(err);
      } finally {
        this.testing = false;
        this.testDone = true;
      }
    },

    async createTargetDatabase() {
      if (!this.database.trim()) return;
      this.creatingDb = true;
      this.errorMsg = '';
      try {
        const res = await withIpcTimeout(
          ipc.createDatabase({
            host: this.host,
            port: this.port,
            user: this.user,
            password: this.password,
            database: this.database.trim(),
          }),
          30000
        );
        if (res.ok) {
          this.dbExists = true;
          this.testOk = true;
          this.testError = '';
        } else {
          this.testError = res.error || 'Failed to create database. Check that the user has CREATE privilege.';
        }
      } catch (err) {
        this.testError = (err as Error).message || String(err);
      } finally {
        this.creatingDb = false;
      }
    },

    async expressInstall() {
      if (!canInstallMariaDB(this.role)) {
        this.errorMsg = t`MariaDB installation is only available on the host computer.`;
        return;
      }

      this.installing = true;
      this.isDownloading = true;
      this.installStage = t`Preparing installation…`;
      this.progressPercent = 0;
      this.portMessage = '';
      this.errorMsg = '';
      this.cleanupListeners();

      try {
        this.rootPassword = genPassword();
        this.appPassword = genPassword();
        const database = this.database.trim() || 'sotrama';
        const requestedPort = this.port;

        ipc.registerMariaDBProgressListener(
          this.installChannel,
          (e: ProgressPayload) => {
            if (typeof e.percent === 'number') this.progressPercent = e.percent;
            if (e.stage) this.installStage = e.stage;
          }
        );

        const result = (await ipc.provisionMariaDB({
          rootPassword: this.rootPassword,
          appPassword: this.appPassword,
          database,
          port: requestedPort,
          hostMode: true,
        })) as { ok: boolean; error?: string; log?: string; port?: number };

        if (!result.ok) {
          this.errorMsg = result.error || t`Installation failed.`;
          if (result.log) {
            this.installStage = `Log: ${result.log.slice(0, 240)}`;
          }
          return;
        }

        if (result.port) {
          if (result.port !== requestedPort) {
            this.portMessage = `${t`Port`} ${requestedPort} ${t`was in use; allocated port`} ${result.port}.`;
          }
          this.port = result.port;
        }

        this.isDownloading = false;
        this.summary = {
          port: this.port,
          database,
          appPassword: this.appPassword,
        };
        this.done = true;
        this.installStage = t`Ready.`;
      } catch (err) {
        this.errorMsg = (err as Error).message || String(err);
      } finally {
        this.installing = false;
        this.isDownloading = false;
        this.cleanupListeners();
      }
    },

    finish() {
      // Persist role for restart (typed ConfigMap key — see fyo/core/types.ts)
      if (this.role) {
        fyo.config.set('hostRole', this.role);
      }
      const isExpressHost = this.role === 'host' && this.mode === 'express';
      const config: ConnectionConfig = isExpressHost
        ? {
            host: '127.0.0.1',
            port: this.port,
            user: 'sotrama_app',
            password: this.appPassword,
            database: this.database.trim() || 'sotrama',
          }
        : {
            host: this.host,
            port: this.port,
            user: this.user,
            password: this.password,
            database: this.database.trim(),
          };

      // IPC/main expects a JSON string (see App.vue hostReady + main/ipc/router)
      this.$emit('host-ready', JSON.stringify(config));
    },
  },
});
</script>
