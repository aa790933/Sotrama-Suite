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
    :class="{
      'pointer-events-none': loadingDatabase,
      'window-drag': platform !== 'Windows',
    }"
  >
    <div
      class="
        w-full
        max-w-xl max-h-[90vh]
        shadow-xl
        rounded-xl
        border border-gray-200
        dark:border-gray-800
        relative
        bg-white
        dark:bg-gray-850
        flex flex-col
        overflow-hidden
      "
    >
      <!-- Header Section -->
      <div class="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
        <h1
          class="
            text-2xl
            font-bold
            select-none
            text-gray-900
            dark:text-gray-100
          "
        >
          {{ t`Welcome to Sotrama Suite` }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400 text-sm select-none mt-1">
          {{ t`Create a new company or select an existing one` }}
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="p-2 space-y-1">
        <!-- New Company (Blue Icon) -->
        <div
          data-testid="create-new-file"
          class="
            px-4
            py-3
            rounded-lg
            flex flex-row
            items-center
            gap-4
            transition-colors
          "
          :class="
            creatingDemo
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
          "
          @click="newDatabase"
        >
          <div
            class="
              w-9
              h-9
              rounded-full
              bg-blue-500
              flex
              items-center
              justify-center
              flex-shrink-0
            "
          >
            <feather-icon name="plus" class="text-white w-5 h-5" />
          </div>

          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100 text-sm">
              {{ t`New Company` }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {{ t`Create a new company and store it on your computer` }}
            </p>
          </div>
        </div>

        <!-- Create Demo (Pink Icon - Top Action if no files) -->
        <div
          v-if="!files?.length"
          class="
            px-4
            py-3
            rounded-lg
            flex flex-row
            items-center
            gap-4
            transition-colors
          "
          :class="
            creatingDemo
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
          "
          @click="createDemo"
        >
          <div
            class="
              w-9
              h-9
              rounded-full
              bg-pink-500
              dark:bg-pink-600
              flex
              items-center
              justify-center
              flex-shrink-0
            "
          >
            <feather-icon name="monitor" class="w-4 h-4 text-white" />
          </div>
          <div>
            <p class="font-medium text-gray-900 dark:text-gray-100 text-sm">
              {{ t`Create Demo` }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {{ t`Create a demo company to try out Sotrama Suite` }}
            </p>
          </div>
        </div>
      </div>

      <hr class="border-gray-200 dark:border-gray-800" />

      <!-- Database File List -->
      <div
        class="
          flex-1
          overflow-y-auto
          p-2
          space-y-1
          divide-y divide-gray-100
          dark:divide-gray-800/50
        "
      >
        <div
          v-for="(file, i) in files"
          :key="file.dbPath"
          class="
            px-4
            py-3
            rounded-lg
            flex
            gap-4
            items-center
            transition-colors
            group
          "
          :class="
            creatingDemo
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
          "
          :title="`${file.companyName} (${file.dbPath})`"
          @click="selectFile(file)"
        >
          <div
            class="
              w-8
              h-8
              rounded-full
              flex
              justify-center
              items-center
              bg-gray-200
              dark:bg-gray-700
              text-gray-700
              dark:text-gray-300
              font-semibold
              flex-shrink-0
              text-xs
            "
          >
            {{ i + 1 }}
          </div>
          <div class="w-full min-w-0">
            <div class="flex justify-between items-baseline gap-2">
              <h2
                class="
                  font-medium
                  text-sm text-gray-900
                  dark:text-gray-100
                  truncate
                "
              >
                {{ file.companyName }}
              </h2>
              <span
                class="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0"
              >
                {{ formatDate(file.modified) }}
              </span>
            </div>
            <p
              class="
                text-xs text-gray-500
                dark:text-gray-400
                truncate
                mt-0.5
                font-mono
              "
            >
              {{ truncate(file.dbPath) }}
            </p>
          </div>
          <button
            type="button"
            class="
              p-1.5
              opacity-0
              group-hover:opacity-100
              hover:bg-red-100
              dark:hover:bg-red-900/40
              rounded-full
              text-gray-400
              hover:text-red-600
              dark:hover:text-red-300
              transition-all
            "
            :title="t`Remove from list`"
            @click.stop="deleteDb(i)"
          >
            <feather-icon name="x" class="w-4 h-4" />
          </button>
        </div>
      </div>

      <hr class="border-gray-200 dark:border-gray-800" />

      <!-- Footer Bar -->
      <div
        class="
          px-6
          py-4
          bg-gray-50
          dark:bg-gray-850
          flex
          justify-between
          items-center
        "
      >
        <LanguageSelector v-show="!creatingDemo" class="text-sm w-32" />
        <button
          v-if="files?.length"
          type="button"
          class="
            text-xs
            font-medium
            bg-white
            dark:bg-gray-800
            hover:bg-gray-100
            dark:hover:bg-gray-700
            text-gray-700
            dark:text-gray-200
            border border-gray-300
            dark:border-gray-700
            rounded-lg
            px-3.5
            py-2
            transition-all
            disabled:opacity-50
          "
          :disabled="creatingDemo"
          @click="createDemo"
        >
          {{ creatingDemo ? t`Please Wait…` : t`Create Demo` }}
        </button>
      </div>
    </div>

    <!-- Progress Modal -->
    <Loading
      v-if="creatingDemo"
      :open="creatingDemo"
      :show-x="false"
      :full-width="true"
      :percent="creationPercent"
      :message="creationMessage"
    />

    <!-- Dev Modal for Custom Base Count -->
    <Modal :open-modal="openModal" @closemodal="openModal = false">
      <div class="p-6 text-gray-900 dark:text-gray-100 max-w-md w-full">
        <h2 class="text-lg font-bold select-none">{{ t`Set Base Count` }}</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mt-2">
          {{
            t`Base Count is a lower bound on the number of entries made when creating the dummy instance.`
          }}
        </p>
        <div class="my-6 flex items-center justify-center gap-4">
          <label
            for="basecount"
            class="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {{ t`Base Count` }}
          </label>
          <input
            id="basecount"
            v-model.number="baseCount"
            type="number"
            min="1"
            class="
              bg-gray-100
              dark:bg-gray-800
              border border-gray-300
              dark:border-gray-700
              rounded-lg
              px-3
              py-1.5
              text-sm
              w-28
              focus:ring-2 focus:ring-blue-500
              outline-none
            "
          />
        </div>
        <div class="flex justify-end gap-3">
          <Button @click="openModal = false">{{ t`Cancel` }}</Button>
          <Button
            type="primary"
            @click="
              () => {
                openModal = false;
                startDummyInstanceSetup();
              }
            "
          >
            {{ t`Create` }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { DateTime } from 'luxon';
import { setupDummyInstance } from 'dummy';
import { t } from 'fyo';
import { Verb } from 'fyo/telemetry/types';
import Button from 'src/components/Button.vue';
import LanguageSelector from 'src/components/Controls/LanguageSelector.vue';
import FeatherIcon from 'src/components/FeatherIcon.vue';
import Loading from 'src/components/Loading.vue';
import Modal from 'src/components/Modal.vue';
import { fyo } from 'src/initFyo';
import { showDialog } from 'src/utils/interactive';
import { updateConfigFiles } from 'src/utils/misc';
import { deleteDb as performDeleteDb } from 'src/utils/ui';
import type { ConnectionConfig } from 'src/setup/types';
import type { ConfigFilesWithModified } from 'utils/types';

import type { IPC } from 'main/preload';

declare const ipc: IPC;

export default defineComponent({
  name: 'DatabaseSelector',
  components: {
    LanguageSelector,
    Loading,
    FeatherIcon,
    Modal,
    Button,
  },
  emits: ['file-selected', 'new-database'],
  data() {
    return {
      openModal: false,
      baseCount: 100,
      creationMessage: '',
      creationPercent: 0,
      creatingDemo: false,
      loadingDatabase: false,
      files: [] as ConfigFilesWithModified[],
      currentPlatform: 'Windows',
    };
  },
  computed: {
    platform(): string {
      return this.currentPlatform;
    },
  },
  async mounted() {
    await this.detectPlatform();
    await this.setFiles();

    if (fyo?.store?.isDevelopment) {
      (window as unknown as Record<string, unknown>).ds = this;
    }
  },
  methods: {
    t(str: TemplateStringsArray | string) {
      return typeof str === 'string' ? t(str) : t(str);
    },

    async detectPlatform() {
      try {
        if (typeof ipc !== 'undefined' && ipc.getEnv) {
          const env = await ipc.getEnv();
          this.currentPlatform =
            env?.platform === 'win32' ? 'Windows' : env?.platform || 'Windows';
        } else if (navigator.userAgent.includes('Mac')) {
          this.currentPlatform = 'Darwin';
        } else if (navigator.userAgent.includes('Linux')) {
          this.currentPlatform = 'Linux';
        }
      } catch {
        this.currentPlatform = 'Windows';
      }
    },

    truncate(value: string): string {
      if (!value) return '';
      return value.length < 65 ? value : '…' + value.slice(value.length - 65);
    },

    formatDate(isoDate: string): string {
      if (!isoDate) return '';
      try {
        const dt = DateTime.fromISO(isoDate);
        return dt.isValid ? dt.toRelative() ?? '' : '';
      } catch {
        return '';
      }
    },

    async deleteDb(i: number) {
      const file = this.files[i];
      if (!file) return;

      const confirmed = await showDialog({
        title: t`Delete ${file.companyName}?`,
        detail: t`Database location: ${file.dbPath}`,
        type: 'warning',
        buttons: [
          {
            label: t`Yes`,
            action: () => true,
            isPrimary: true,
          },
          {
            label: t`No`,
            action: () => false,
            isEscape: true,
          },
        ],
      });

      if (confirmed) {
        await performDeleteDb(file.dbPath);
        await this.setFiles();
      }
    },

    async createDemo() {
      if (!fyo?.store?.isDevelopment) {
        await this.startDummyInstanceSetup();
      } else {
        this.openModal = true;
      }
    },

    async startDummyInstanceSetup() {
      const persisted = fyo?.config?.get('lastSelectedFilePath', null) as
        | string
        | null;
      if (!persisted) {
        this.$emit('new-database');
        return;
      }

      let filePath: string;
      try {
        const cfg = JSON.parse(persisted) as ConnectionConfig;
        filePath = JSON.stringify({ ...cfg, database: 'demo' });
      } catch {
        this.$emit('new-database');
        return;
      }

      this.creatingDemo = true;
      this.creationPercent = 0;
      this.creationMessage = t`Initializing demo setup…`;

      try {
        await setupDummyInstance(
          filePath,
          fyo,
          1,
          this.baseCount,
          (message: string, percent: number) => {
            this.creationMessage = message;
            this.creationPercent = percent;
          }
        );

        updateConfigFiles(fyo);
        await fyo.purgeCache();
        await this.setFiles();

        if (fyo?.telemetry?.log) {
          fyo.telemetry.log(Verb.Created, 'dummy-instance');
        }

        this.$emit('file-selected', filePath);
      } catch (err) {
        await showDialog({
          title: t`Demo Creation Failed`,
          detail: (err as Error)?.message || String(err),
          type: 'error',
        });
      } finally {
        this.creatingDemo = false;
      }
    },

    async setFiles() {
      try {
        if (typeof ipc !== 'undefined' && ipc.getDbList) {
          const dbList = (await ipc.getDbList()) as ConfigFilesWithModified[];
          if (Array.isArray(dbList)) {
            this.files = dbList.sort(
              (a, b) =>
                (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0)
            );
          }
        }
      } catch {
        this.files = [];
      }
    },

    newDatabase() {
      if (this.creatingDemo) return;
      this.$emit('new-database');
    },

    selectFile(file: ConfigFilesWithModified) {
      if (this.creatingDemo || !file?.dbPath) return;
      this.$emit('file-selected', file.dbPath);
    },
  },
});
</script>
