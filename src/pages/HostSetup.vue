<template>
  <div
    class="
      flex-1 flex
      justify-center
      items-center
      bg-gray-50
      dark:bg-gray-900
      min-h-screen
      p-4
    "
  >
    <div
      class="
        w-full
        max-w-lg
        shadow-xl
        rounded-xl
        border border-gray-200
        dark:border-gray-800
        bg-white
        dark:bg-gray-800
      "
    >
      <div class="px-6 py-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ t`Host Setup` }}
        </h1>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {{
            mode === 'express'
              ? t`Sotrama Suite will install and configure MariaDB for you with a dedicated least-privilege account.`
              : t`Connect Sotrama Suite to your existing MariaDB/MySQL server. No installer runs.`
          }}
        </p>

        <!-- Error Banner -->
        <div
          v-if="errorMsg"
          class="
            mt-4
            p-3
            text-sm text-red-700
            bg-red-100
            dark:bg-red-900/40 dark:text-red-200
            rounded-lg
            border border-red-200
            dark:border-red-800
          "
        >
          {{ errorMsg }}
        </div>

        <!-- Mode Selection Tabs -->
        <div
          class="
            mt-5
            flex
            gap-6
            border-b border-gray-200
            dark:border-gray-700
            pb-3
          "
        >
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="mode"
              type="radio"
              value="express"
              :disabled="installing"
              class="text-blue-600 focus:ring-blue-500"
            />
            <span
              class="text-sm font-medium text-gray-800 dark:text-gray-200"
              >{{ t`Express setup (install locally)` }}</span
            >
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="mode"
              type="radio"
              value="advanced"
              :disabled="installing"
              class="text-blue-600 focus:ring-blue-500"
            />
            <span
              class="text-sm font-medium text-gray-800 dark:text-gray-200"
              >{{ t`Advanced (existing server)` }}</span
            >
          </label>
        </div>

        <!-- Option A: Express install -->
        <template v-if="mode === 'express' && !done">
          <div class="mt-4 space-y-4">
            <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {{
                t`Requires internet access to download and run the MariaDB installer. Only Windows can install fully offline when the bundled MSI is present; macOS (Homebrew) and Linux (apt/dnf) both require live internet access on the host at install time.`
              }}
            </p>

            <div>
              <label
                class="
                  block
                  text-sm
                  font-medium
                  text-gray-700
                  dark:text-gray-300
                "
                >{{ t`Port` }}</label
              >
              <input
                v-model.number="port"
                type="number"
                :disabled="installing"
                class="
                  mt-1
                  w-full
                  px-3
                  py-2
                  rounded-lg
                  border border-gray-300
                  dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100
                  focus:ring-2 focus:ring-blue-500 focus:outline-none
                "
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
                class="
                  block
                  text-sm
                  font-medium
                  text-gray-700
                  dark:text-gray-300
                "
                >{{ t`Database name` }}</label
              >
              <input
                v-model="database"
                placeholder="sotrama"
                :disabled="installing"
                class="
                  mt-1
                  w-full
                  px-3
                  py-2
                  rounded-lg
                  border border-gray-300
                  dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100
                  focus:ring-2 focus:ring-blue-500 focus:outline-none
                "
              />
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{
                  t`Sotrama Suite will generate and manage dedicated credentials automatically.`
                }}
              </p>
            </div>

            <button
              :disabled="installing || !port || !database"
              class="
                w-full
                mt-2
                px-4
                py-2.5
                rounded-lg
                bg-blue-600
                hover:bg-blue-700
                text-white
                font-medium
                shadow-sm
                transition-all
                disabled:opacity-50 disabled:cursor-not-allowed
              "
              @click="expressInstall"
            >
              {{ installLabel }}
            </button>

            <div
              v-if="installStage"
              class="
                mt-2
                text-xs text-gray-500
                dark:text-gray-400
                flex
                items-center
                gap-2
              "
            >
              <span
                class="
                  inline-block
                  w-2
                  h-2
                  rounded-full
                  bg-blue-500
                  animate-pulse
                "
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
                class="
                  block
                  text-sm
                  font-medium
                  text-gray-700
                  dark:text-gray-300
                "
                >{{ t`Host` }}</label
              >
              <input
                v-model="host"
                placeholder="127.0.0.1"
                class="
                  mt-1
                  w-full
                  px-3
                  py-2
                  rounded-lg
                  border border-gray-300
                  dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100
                  focus:ring-2 focus:ring-blue-500 focus:outline-none
                "
              />
            </div>
            <div>
              <label
                class="
                  block
                  text-sm
                  font-medium
                  text-gray-700
                  dark:text-gray-300
                "
                >{{ t`Port` }}</label
              >
              <input
                v-model.number="port"
                type="number"
                class="
                  mt-1
                  w-full
                  px-3
                  py-2
                  rounded-lg
                  border border-gray-300
                  dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100
                  focus:ring-2 focus:ring-blue-500 focus:outline-none
                "
              />
            </div>
            <div>
              <label
                class="
                  block
                  text-sm
                  font-medium
                  text-gray-700
                  dark:text-gray-300
                "
                >{{ t`Database name` }}</label
              >
              <input
                v-model="database"
                placeholder="sotrama"
                class="
                  mt-1
                  w-full
                  px-3
                  py-2
                  rounded-lg
                  border border-gray-300
                  dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100
                  focus:ring-2 focus:ring-blue-500 focus:outline-none
                "
              />
            </div>
            <div>
              <label
                class="
                  block
                  text-sm
                  font-medium
                  text-gray-700
                  dark:text-gray-300
                "
                >{{ t`User` }}</label
              >
              <input
                v-model="user"
                class="
                  mt-1
                  w-full
                  px-3
                  py-2
                  rounded-lg
                  border border-gray-300
                  dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100
                  focus:ring-2 focus:ring-blue-500 focus:outline-none
                "
              />
            </div>
            <div>
              <label
                class="
                  block
                  text-sm
                  font-medium
                  text-gray-700
                  dark:text-gray-300
                "
                >{{ t`Password` }}</label
              >
              <input
                v-model="password"
                type="password"
                class="
                  mt-1
                  w-full
                  px-3
                  py-2
                  rounded-lg
                  border border-gray-300
                  dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100
                  focus:ring-2 focus:ring-blue-500 focus:outline-none
                "
              />
            </div>

            <button
              :disabled="testing || !host || !port || !database || !user"
              class="
                w-full
                mt-2
                px-4
                py-2.5
                rounded-lg
                bg-blue-600
                hover:bg-blue-700
                text-white
                font-medium
                shadow-sm
                transition-all
                disabled:opacity-50 disabled:cursor-not-allowed
              "
              @click="advancedTest"
            >
              {{ testing ? t`Testing…` : t`Test connection` }}
            </button>

            <p
              v-if="testOk"
              class="text-sm font-medium text-green-600 dark:text-green-400"
            >
              {{ t`Connection successful — press Continue below.` }}
            </p>
            <p
              v-else-if="testDone && !testOk"
              class="text-sm text-red-600 dark:text-red-400"
            >
              {{ testError }}
            </p>
          </div>
        </template>

        <!-- Summary card (express) -->
        <div
          v-if="done"
          class="
            mt-4
            p-5
            rounded-xl
            border border-gray-200
            dark:border-gray-700
            bg-gray-50
            dark:bg-gray-900/60
          "
        >
          <div class="flex items-center gap-2 mb-3">
            <span class="w-2.5 h-2.5 rounded-full bg-green-500"></span>
            <h2
              class="text-base font-semibold text-gray-900 dark:text-gray-100"
            >
              {{ t`Setup complete` }}
            </h2>
          </div>

          <dl
            class="
              space-y-2
              text-sm
              divide-y divide-gray-200
              dark:divide-gray-800
            "
          >
            <div class="flex justify-between pt-2">
              <dt class="text-gray-500 dark:text-gray-400">{{ t`Host` }}</dt>
              <dd class="font-medium text-gray-900 dark:text-gray-200">
                127.0.0.1
              </dd>
            </div>
            <div class="flex justify-between pt-2">
              <dt class="text-gray-500 dark:text-gray-400">
                {{ t`Allocated port` }}
              </dt>
              <dd class="font-medium text-gray-900 dark:text-gray-200">
                {{ summary?.port }}
              </dd>
            </div>
            <div class="flex justify-between pt-2">
              <dt class="text-gray-500 dark:text-gray-400">
                {{ t`Database` }}
              </dt>
              <dd class="font-medium text-gray-900 dark:text-gray-200">
                {{ summary?.database }}
              </dd>
            </div>
            <div class="flex justify-between pt-2">
              <dt class="text-gray-500 dark:text-gray-400">
                {{ t`App user` }}
              </dt>
              <dd class="font-medium text-gray-900 dark:text-gray-200">
                sotrama_app
              </dd>
            </div>
            <div class="flex justify-between items-center pt-2">
              <dt class="text-gray-500 dark:text-gray-400">
                {{ t`App password` }}
              </dt>
              <dd class="flex items-center gap-2">
                <span
                  class="
                    font-mono
                    text-xs text-gray-900
                    dark:text-gray-200
                    break-all
                    bg-gray-200
                    dark:bg-gray-800
                    px-2
                    py-1
                    rounded
                  "
                >
                  {{ summary?.appPassword }}
                </span>
                <button
                  type="button"
                  class="
                    text-xs text-blue-600
                    hover:text-blue-700
                    dark:text-blue-400
                  "
                  @click="copyPassword"
                >
                  {{ copied ? t`Copied!` : t`Copy` }}
                </button>
              </dd>
            </div>
          </dl>

          <div
            class="
              mt-4
              pt-3
              border-t border-gray-200
              dark:border-gray-700
              space-y-2
            "
          >
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{
                t`Share the app credentials above with LAN clients — they must never use root.`
              }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {{
                t`Security: bind-address is set to 0.0.0.0. Inbound access is restricted to your local network via OS Firewall rules and SQL grant privileges.`
              }}
            </p>
          </div>
        </div>

        <button
          v-if="canContinue"
          class="
            w-full
            mt-6
            px-4
            py-2.5
            rounded-lg
            bg-green-600
            hover:bg-green-700
            text-white
            font-medium
            shadow-sm
            transition-all
          "
          @click="finish"
        >
          {{ t`Continue to company setup` }}
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { t } from 'fyo';
import { IPC_ACTIONS } from 'utils/messages';
import type { ConnectionConfig } from '../setup/types';

import type { IPC } from 'main/preload';

// Declare IPC bridge interface
declare const ipc: IPC;

type ProgressPayload = { percent: number; downloaded: number; total: number };

function genPassword(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default defineComponent({
  name: 'HostSetup',
  emits: ['host-ready'],
  data() {
    return {
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
    downloadChannel(): string {
      return IPC_ACTIONS.DOWNLOAD_MARIADB_INSTALLER;
    },
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
      return this.mode === 'express' ? this.done : this.testOk;
    },
  },
  async mounted() {
    await this.probeNextFreePort(3306);
  },
  beforeUnmount() {
    this.cleanupListeners();
  },
  methods: {
    t(str: TemplateStringsArray | string) {
      return typeof str === 'string' ? t(str) : t(str);
    },

    cleanupListeners() {
      if (typeof ipc !== 'undefined' && ipc.removeMariaDBProgressListener) {
        ipc.removeMariaDBProgressListener(this.downloadChannel);
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

    async probeNextFreePort(start: number) {
      let candidate = start;
      while (candidate < start + 20) {
        const check = await ipc.isPortAvailable(candidate);
        if (check.available) {
          this.port = candidate;
          this.portMessage =
            candidate === start
              ? ''
              : `${t`Port`} ${start} ${t`was in use; allocated port`} ${candidate}.`;
          return;
        }
        candidate += 1;
      }
      this.portMessage = `${t`No free port found between`} ${start} ${t`and`} ${
        start + 19
      }.`;
    },

    async advancedTest() {
      this.testing = true;
      this.testOk = false;
      this.testDone = false;
      this.testError = '';
      try {
        const ping = await ipc.pingMariaDB({
          host: this.host,
          port: this.port,
          user: this.user,
          password: this.password,
        });
        this.testOk = ping.ok;
        this.testError = ping.ok ? '' : ping.error || '';
      } catch (err) {
        this.testOk = false;
        this.testError = (err as Error).message || String(err);
      } finally {
        this.testing = false;
        this.testDone = true;
      }
    },

    async expressInstall() {
      this.installing = true;
      this.isDownloading = false;
      this.installStage = t`Preparing installation…`;
      this.errorMsg = '';
      this.cleanupListeners();

      try {
        await this.probeNextFreePort(this.port);
        const portCheck = await ipc.isPortAvailable(this.port);
        if (!portCheck.available) {
          this.errorMsg = `${t`Port`} ${
            this.port
          } ${t`is in use. Free it and retry.`}`;
          return;
        }

        this.rootPassword = genPassword();
        this.appPassword = genPassword();
        const database = this.database.trim() || 'sotrama';

        const env = await ipc.getEnv();
        if (env.platform === 'win32') {
          this.isDownloading = true;
          this.installStage = t`Downloading MariaDB installer…`;
          ipc.registerMariaDBProgressListener(
            this.downloadChannel,
            (e: ProgressPayload) => {
              this.progressPercent = e.percent;
            }
          );
          await ipc.downloadMariaDBInstaller(true);
          this.isDownloading = false;
        }

        this.installStage = t`Installing MariaDB (admin privileges required)…`;
        ipc.registerMariaDBProgressListener(
          this.installChannel,
          (e: ProgressPayload) => {
            this.progressPercent = e.percent;
          }
        );

        const result = (await ipc.installMariaDB({
          rootPassword: this.rootPassword,
          appPassword: this.appPassword,
          database,
          port: this.port,
          platform: undefined,
          hostMode: true,
        })) as { ok: boolean; error?: string; log?: string };

        if (!result.ok) {
          this.errorMsg = result.error || t`Installation failed.`;
          if (result.log) {
            this.installStage = `Log: ${result.log.slice(0, 240)}`;
          }
          return;
        }

        this.installStage = t`Verifying application user…`;
        const ping = await ipc.pingMariaDB({
          host: '127.0.0.1',
          port: this.port,
          user: 'sotrama_app',
          password: this.appPassword,
        });

        if (!ping.ok) {
          this.errorMsg =
            ping.error || t`Application user cannot reach the server.`;
          return;
        }

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
      const config: ConnectionConfig =
        this.mode === 'express'
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

      // Emit typed configuration object directly
      this.$emit('host-ready', config);
    },
  },
});
</script>
